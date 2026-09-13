'use client';

/**
 * Codice Template Preview.
 *
 * A realistic, content-rich, MULTI-PAGE document preview that consumes the
 * SAME canonical `DocumentPreset` (+ metadata) as the exporters — there is
 * no preview-only style state (spec §13).
 *
 * Pagination and the element model live in the SHARED module
 * `@/lib/preview/documentPagination` — the main document preview packs pages
 * with the very same code (spec §11: one pagination system, not two).
 *
 * Design goals (see spec):
 *   - Every meaningful setting has preview content that visibly responds.
 *   - Real pagination: page-break settings actually move content to another
 *     simulated page (not just a divider line).
 *   - Orientation changes the page box dimensions; margins recalculate.
 *   - Vertical alignment repositions under-filled isolated pages.
 *   - The title page is ONE coherent group: horizontal alignment applies to
 *     the whole group, vertical alignment positions the whole group (§9).
 *   - Header/footer layouts (single/dual/triple + slots) render per page.
 *   - Changing a setting briefly highlights ONLY the affected preview region
 *     (spec §8/§30 — see computeHighlightIds diffing).
 *   - Unicode box-drawing characters (├ └ │ ─) are preserved everywhere and
 *     rely on glyph-level font fallback in the browser (§23/§24).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Minus, Plus } from '@/components/common/Icons';
import type { DocumentPreset } from '@/lib/presets/documentPreset';
import type {
  DocumentMetadata,
  FooterSlotType,
  HighlightedFile,
} from '@/types';
import { highlightFile, getThemeColors } from '@/lib/highlight/highlighter';
import { resolveSyntaxTheme } from '@/lib/themes/syntaxThemeRegistry';
import { fontStack } from '@/lib/fonts/fontCatalog';
import { formatBytes } from '@/lib/fileDiscovery';
import { expandTokens } from '@/lib/tokens';
import {
  buildDocumentElements,
  paginateDocument,
  pageBoxPx,
  MM_TO_PX,
  PT_TO_PX,
  WEIGHT_MAP,
  type PaginationProject,
  type PreviewElement,
  type PreviewPage,
} from '@/lib/preview/documentPagination';

/* ------------------------------------------------------------------ */
/* Sample content — intentionally rich so every setting is visible.    */
/* ------------------------------------------------------------------ */

const MAIN_KT = `/*
 * Project layout:
 *
 *  sample-app/
 *  ├── build.gradle.kts
 *  ├── src/
 *  │   └── main/
 *  │       └── kotlin/
 *  │           └── Main.kt
 *  └── README.md
 */
package com.example

data class User(val name: String, val age: Int)

fun main() {
    val users = listOf(User("Ada", 36), User("Alan", 41), User("Grace", 45))
    val averageAge = users.map { it.age }.average()
    println("Hello from Codice! Average age: $averageAge")
    // A deliberately long line used to demonstrate how the preview wraps (or clips) very long code lines depending on the current Wrap-long-lines template setting, so the difference is clearly visible in the generated document.
}`;

const UTILS_KT = `package com.example

object Utils {
    fun formatBytes(bytes: Long): String =
        if (bytes < 1024) "$bytes B" else "\${bytes / 1024} KB"

    fun slugify(value: String): String =
        value.trim().lowercase().replace(Regex("[^a-z0-9]+"), "-")
}`;

const README_MD = `# Sample App

A tiny Kotlin sample used by the Codice template preview.

## Build

\`\`\`
./gradlew build
\`\`\`

## Layout

- \`src/main/kotlin\` — application sources
- \`src/test/kotlin\` — unit tests
`;

const DEPLOY_SH = `#!/usr/bin/env bash
set -euo pipefail

# Bundle layout:
# ├── config/
# │   └── production.env
# └── deploy.sh

ENVIRONMENT="\${1:-staging}"
echo "Deploying to $ENVIRONMENT…"
rsync -a build/ "server:/srv/app/$ENVIRONMENT/"`;

interface SampleFile {
  name: string;
  path: string;
  language: string;
  size: number;
  code: string;
}

interface SampleProject {
  label: string;
  path: string;
  structure: string[];
  files: SampleFile[];
}

const SAMPLE_PROJECTS: SampleProject[] = [
  {
    label: 'sample-app',
    path: '/home/dev/projects/sample-app',
    structure: [
      'build.gradle.kts',
      'README.md',
      'settings.gradle.kts',
      'src/main/kotlin/com/example/Main.kt',
      'src/main/kotlin/com/example/Utils.kt',
      'src/main/resources/application.conf',
      'src/test/kotlin/com/example/MainTest.kt',
    ],
    files: [
      { name: 'Main.kt', path: 'src/main/kotlin/com/example/Main.kt', language: 'kotlin', size: 1124, code: MAIN_KT },
      { name: 'Utils.kt', path: 'src/main/kotlin/com/example/Utils.kt', language: 'kotlin', size: 612, code: UTILS_KT },
      { name: 'README.md', path: 'README.md', language: 'markdown', size: 226, code: README_MD },
    ],
  },
  {
    label: 'deploy-tools',
    path: '/home/dev/projects/deploy-tools',
    structure: [
      'config/production.env',
      'deploy.sh',
      'README.md',
    ],
    files: [
      { name: 'deploy.sh', path: 'deploy.sh', language: 'shell', size: 384, code: DEPLOY_SH },
    ],
  },
];

/** Sample projects in the shared pagination-model shape. */
const PAGINATION_PROJECTS: PaginationProject[] = SAMPLE_PROJECTS.map((p) => ({
  label: p.label,
  path: p.path,
  structure: p.structure,
  files: p.files.map((f) => ({
    name: f.name,
    path: f.path,
    language: f.language,
    size: f.size,
    code: f.code,
  })),
}));

/* ------------------------------------------------------------------ */
/* Highlight regions                                                   */
/* ------------------------------------------------------------------ */

export interface HighlightSignal {
  ids: string[];
  nonce: number;
}

function HighlightRegion({
  id,
  highlight,
  className,
  style,
  children,
  as = 'div',
}: {
  id: string;
  highlight: HighlightSignal;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  as?: 'div' | 'section';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const active = highlight.ids.includes(id);
  const prevNonce = useRef<number>(-1);

  useEffect(() => {
    if (active && highlight.nonce !== prevNonce.current && ref.current) {
      prevNonce.current = highlight.nonce;
      // Restart the CSS animation.
      const el = ref.current;
      el.classList.remove('codice-highlight');
      // Force reflow to restart the animation.
      void el.offsetWidth;
      el.classList.add('codice-highlight');
      const t = window.setTimeout(() => el.classList.remove('codice-highlight'), 1100);
      // jsdom (and some older engines) don't implement scrollIntoView.
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      return () => window.clearTimeout(t);
    }
  }, [active, highlight.nonce, id]);

  const Tag = as;
  return (
    <Tag ref={ref as any} data-highlight={id} className={className} style={style}>
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function TemplatePreview({
  preset,
  metadata,
  highlight,
}: {
  preset: DocumentPreset;
  metadata: DocumentMetadata;
  highlight: HighlightSignal;
}) {
  const resolvedTheme = resolveSyntaxTheme(preset.syntaxTheme);
  const [highlighted, setHighlighted] = useState<Record<string, HighlightedFile>>({});
  const [themeColors, setThemeColors] = useState({ background: '#0d1117', foreground: '#e6edf3' });
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(640);
  // Zoom: 'fit' or a percentage (30–200).
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [currentPage, setCurrentPage] = useState(1);

  // Measure the scroll viewport to compute the fit-to-width scale.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Highlight sample sources with the selected Shiki theme (cached by theme).
  useEffect(() => {
    let cancelled = false;
    getThemeColors(resolvedTheme).then((c) => {
      if (!cancelled) setThemeColors(c);
    });
    (async () => {
      for (const project of SAMPLE_PROJECTS) {
        for (const file of project.files) {
          const key = `${file.path}::${resolvedTheme}`;
          try {
            const h = await highlightFile(file.path, file.path, file.language, file.code, resolvedTheme);
            if (!cancelled) {
              setHighlighted((prev) => ({ ...prev, [key]: h }));
            }
          } catch {
            // ignore sample highlight failures
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolvedTheme]);

  const getHl = useCallback(
    (path: string): HighlightedFile | null =>
      highlighted[`${path}::${resolvedTheme}`] ?? null,
    [highlighted, resolvedTheme],
  );

  /* ---------------- Sample document elements (shared model) ---------------- */

  const elements = useMemo(
    () => buildDocumentElements(preset, PAGINATION_PROJECTS, { includeNotesBlock: true }),
    [preset],
  );

  /* ---------------- Pagination (shared paginator) ---------------- */

  const pages = useMemo(
    () =>
      paginateDocument(elements, preset, PAGINATION_PROJECTS, {
        getLineCount: (file) => {
          const hl = getHl(file.path);
          if (hl) return hl.lines.length;
          return file.code ? file.code.split('\n').length : 1;
        },
        getLineText: (file, lineIdx) => {
          const hl = getHl(file.path);
          return hl?.lines[lineIdx]?.text ?? '';
        },
      }),
    [elements, preset, getHl],
  );

  /* ---------------- Page box ---------------- */

  const { pageW, pageH } = pageBoxPx(preset);
  const fitScale = Math.min(1, Math.max(0.3, (containerWidth - 48) / pageW));
  const scale =
    zoom === 'fit' ? fitScale : Math.min(2, Math.max(0.3, zoom / 100));

  const marginTop = preset.page.marginTopMm * MM_TO_PX;
  const marginBottom = preset.page.marginBottomMm * MM_TO_PX;
  const marginLeft = preset.page.marginLeftMm * MM_TO_PX;
  const marginRight = preset.page.marginRightMm * MM_TO_PX;

  const headerReserve = preset.page.pageHeaderShow ? Math.max(28, preset.page.headerSpacingMm * MM_TO_PX) : 0;
  const footerReserve = preset.page.pageFooterShow ? Math.max(28, preset.page.footerSpacingMm * MM_TO_PX) : 0;

  const effectiveBg = preset.code.useSyntaxThemeBackground ? themeColors.background : preset.code.backgroundColor;
  const fallbackFg = preset.code.useSyntaxThemeBackground ? themeColors.foreground : preset.code.textColor;

  const codeBorderCss =
    preset.code.borderStyle === 'none' || !preset.code.borderColor
      ? 'none'
      : `${Math.max(0.5, preset.code.borderWidthPt)}px ${preset.code.borderStyle} ${preset.code.borderColor}`;

  /* ---------------- Header / footer slot values ---------------- */

  const today = new Date().toLocaleDateString();
  const nowDate = new Date();
  const sampleFileCount = SAMPLE_PROJECTS.reduce(
    (acc, pr) => acc + pr.files.length,
    0,
  );
  const sampleFirstFileName =
    SAMPLE_PROJECTS[0]?.files[0]?.path.split('/').pop() ?? '';

  function headerText(slot: string | null): string | null {
    if (slot == null || slot === '') return null;
    return expandTokens(slot, {
      title: metadata.title ?? '',
      author: metadata.author ?? '',
      date: metadata.date || today,
      time: nowDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      files: sampleFileCount,
      projectName: SAMPLE_PROJECTS[0]?.label ?? '',
      fileName: sampleFirstFileName,
      now: nowDate,
    });
  }

  function footerValue(type: FooterSlotType, page: PreviewPage, pageNo: number): string {
    switch (type) {
      case 'none':
        return '';
      case 'text':
        return expandTokens(preset.page.pageFooterText ?? '', {
          page: String(pageNo),
          pages: String(pages.length),
          lines: String(page.linesOnPage),
          fileName: page.fileName ?? '',
          projectName: page.projectName ?? '',
          date: metadata.date || today,
          time: nowDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
          title: metadata.title ?? '',
          author: metadata.author ?? '',
          files: sampleFileCount,
          now: nowDate,
        });
      case 'pageNumber':
        return String(pageNo);
      case 'pageCount':
        return String(pages.length);
      case 'linesOnPage':
        return `${page.linesOnPage} lines`;
      case 'fileName':
        return page.fileName ?? '';
      case 'projectName':
        return page.projectName ?? '';
      case 'date':
        return metadata.date || today;
      default:
        return '';
    }
  }

  const headerFont = fontStack(preset.typography.bodyFont);
  const headerFontSize = 9;

  function renderHeaderRow() {
    if (!preset.page.pageHeaderShow) return null;
    const layout = preset.page.pageHeaderLayout;
    const left = preset.page.pageHeaderLeft;
    const center = preset.page.pageHeaderCenter;
    const right = preset.page.pageHeaderRight;
    const align = preset.page.pageHeaderAlign;

    const slotEl = (text: string | null, key: string, textAlign: React.CSSProperties['textAlign']) =>
      text ? (
        <span key={key} style={{ textAlign }}>{headerText(text)}</span>
      ) : null;

    let content: React.ReactNode = null;
    if (layout === 'single') {
      content = slotEl(center ?? left ?? right, 'c', align);
    } else if (layout === 'dual') {
      content = (
        <>
          {slotEl(left, 'l', 'left')}
          {slotEl(right, 'r', 'right')}
        </>
      );
    } else {
      content = (
        <>
          {slotEl(left, 'l', 'left')}
          {slotEl(center, 'c', 'center')}
          {slotEl(right, 'r', 'right')}
        </>
      );
    }
    if (!content) return null;
    return (
      <div
        data-codice-region="page-header"
        style={{
          display: 'flex',
          justifyContent: layout === 'single' ? (align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center') : layout === 'dual' ? 'space-between' : 'space-between',
          gap: 12,
          color: preset.colors.mutedText,
          fontFamily: headerFont,
          fontSize: headerFontSize,
          borderBottom: `0.5px solid ${preset.colors.borders}`,
          paddingBottom: 4,
          marginBottom: Math.max(6, preset.page.headerSpacingMm * MM_TO_PX - 18),
        }}
      >
        {content}
      </div>
    );
  }

  function renderFooterRow(page: PreviewPage, pageNo: number) {
    if (!preset.page.pageFooterShow) return null;
    const layout = preset.page.pageFooterLayout;
    const align = preset.page.pageFooterAlign;

    const slots: FooterSlotType[] =
      layout === 'single'
        ? [preset.page.pageFooterCenter]
        : layout === 'dual'
          ? [preset.page.pageFooterLeft, preset.page.pageFooterRight]
          : [preset.page.pageFooterLeft, preset.page.pageFooterCenter, preset.page.pageFooterRight];

    const values = slots.map((s) => footerValue(s, page, pageNo));
    if (values.every((v) => v === '')) return null;

    const justifyContent =
      layout === 'single'
        ? align === 'left'
          ? 'flex-start'
          : align === 'right'
            ? 'flex-end'
            : 'center'
        : layout === 'dual'
          ? 'space-between'
          : 'space-between';

    return (
      <div
        data-codice-region="page-footer"
        style={{
          display: 'flex',
          justifyContent,
          gap: 12,
          color: preset.colors.mutedText,
          fontFamily: headerFont,
          fontSize: headerFontSize,
          borderTop: `0.5px solid ${preset.colors.borders}`,
          paddingTop: 4,
          marginTop: Math.max(6, preset.page.footerSpacingMm * MM_TO_PX - 18),
        }}
      >
        {values.map((v, i) => (
          <span key={i} style={{ flex: layout === 'triple' && i === 1 ? '1 1 auto' : '0 0 auto', textAlign: layout === 'triple' && i === 1 ? 'center' : layout === 'dual' ? (i === 0 ? 'left' : 'right') : undefined }}>
            {v}
          </span>
        ))}
      </div>
    );
  }

  /* ---------------- Element rendering ---------------- */

  function renderElement(el: PreviewElement, key: string): React.ReactNode {
    switch (el.type) {
      case 'titlePage':
        return renderTitlePage(key);
      case 'toc':
        return renderToc(key);
      case 'projectHeader':
        return renderProjectHeader(el.projectIdx, key);
      case 'structure':
        return renderStructure(el.projectIdx, key);
      case 'heading':
        return renderHeading(el, key);
      case 'paragraph':
        return (
          <p
            key={key}
            data-codice-region="body"
            style={{
              color: preset.typography.bodyColor,
              fontSize: preset.typography.bodyFontSizePt * PT_TO_PX,
              fontWeight: WEIGHT_MAP[preset.typography.bodyWeight],
              lineHeight: preset.typography.lineSpacing,
              margin: `0 0 ${preset.typography.paragraphSpacingPt}pt 0`,
              fontFamily: fontStack(preset.typography.bodyFont),
            }}
          >
            {el.rich
              ? el.rich.map((run, i) => (
                  <span
                    key={i}
                    style={run.colorRole === 'link' ? { color: preset.colors.links } : undefined}
                  >
                    {run.text}
                  </span>
                ))
              : el.text}
          </p>
        );
      case 'statusCard':
        return renderStatusCard(key);
      case 'fileHeader':
        return renderFileHeader(el.projectIdx, el.fileIdx, key);
      case 'code':
        return renderCodeBlock(el, key, effectiveBg, fallbackFg, codeBorderCss);
      case 'spacer':
        return <div key={key} style={{ height: el.height }} />;
      default:
        return null;
    }
  }

  /**
   * Title page — ONE coherent content group (spec §9).
   * Horizontal alignment applies to the WHOLE group (including the title —
   * the title is not a special element that ignores the alignment setting);
   * the group is moved vertically as a unit via the page's justify-content.
   */
  function renderTitlePage(key: string) {
    const tp = preset.titlePage;
    const title = metadata.title || 'Sample Project Report';
    const subtitle = metadata.subtitle || 'A Practical Guide to Codice Document Templates';
    const author = metadata.author || 'Ada Lovelace';
    const course = metadata.course || 'CS 402 — Software Engineering';
    const university = metadata.university || 'Sample State University';
    const date = metadata.date || today;
    const version = metadata.version || 'v1.0.0';
    const description =
      metadata.description ||
      'This sample document demonstrates every template control: typography, spacing, colors, page behavior, and code presentation.';

    const titleH = preset.headings.title;
    // The description keeps a readable measure; it follows the group
    // alignment (margin auto centers it only in center mode).
    const descriptionMargin =
      tp.alignment === 'center' ? '24px auto 0' : tp.alignment === 'right' ? '24px 0 0 auto' : '24px 0 0';
    return (
      <HighlightRegion
        key={key}
        id="title-page"
        highlight={highlight}
        style={{
          textAlign: tp.alignment,
          // verticalOffsetPt nudges the group down from the top (top mode).
          // In center/bottom modes the group is positioned by the page's
          // justify-content so Center/Center truly centers it (spec §9/§29);
          // bottom mode uses the offset as an upward nudge from the bottom.
          marginTop: tp.verticalAlignment === 'top' ? tp.verticalOffsetPt * PT_TO_PX : undefined,
          transform:
            tp.verticalAlignment === 'bottom'
              ? `translateY(-${tp.verticalOffsetPt * PT_TO_PX}px)`
              : undefined,
        }}
      >
        {tp.showTitle && (
          <div
            data-codice-region="heading-title"
            style={{
              fontFamily: fontStack(titleH.font),
              fontSize: titleH.sizePt * PT_TO_PX,
              fontWeight: WEIGHT_MAP[titleH.weight],
              fontStyle: titleH.italic ? 'italic' : 'normal',
              color: titleH.color,
              lineHeight: titleH.lineHeight,
              textIndent: titleH.indentPt,
            }}
          >
            {title}
          </div>
        )}
        {tp.showSubtitle && (
          <div
            style={{
              fontFamily: fontStack(preset.typography.bodyFont),
              fontSize: (preset.typography.bodyFontSizePt + 2) * PT_TO_PX,
              color: preset.colors.secondaryText,
              marginTop: 10,
            }}
          >
            {subtitle}
          </div>
        )}
        {tp.showAuthor && (
          <div style={{ fontSize: preset.typography.bodyFontSizePt * PT_TO_PX + 2, color: preset.colors.secondaryText, marginTop: 18 }}>
            by {author}
          </div>
        )}
        {tp.showCourse && (
          <div style={{ fontSize: 12, color: preset.colors.mutedText, marginTop: 8 }}>
            {course}
          </div>
        )}
        {tp.showUniversity && (
          <div style={{ fontSize: 12, color: preset.colors.mutedText, marginTop: 4 }}>
            {university}
          </div>
        )}
        {tp.showDate && (
          <div style={{ fontSize: 11, color: preset.colors.mutedText, marginTop: 28 }}>
            {date}
          </div>
        )}
        {tp.showVersion && (
          <div style={{ marginTop: 6 }}>
            <span
              style={{
                // Accent chip on a surface — coherent targets for the Accent
                // and Surface document colors (spec §10).
                display: 'inline-block',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.4,
                color: preset.colors.accent,
                background: preset.colors.surface,
                border: `0.5px solid ${preset.colors.borders}`,
                borderRadius: 999,
                padding: '2px 10px',
              }}
            >
              Version: {version}
            </span>
          </div>
        )}
        {tp.showDescription && (
          <div
            style={{
              fontSize: 12,
              color: preset.colors.secondaryText,
              maxWidth: 400,
              margin: descriptionMargin,
            }}
          >
            {description}
          </div>
        )}
      </HighlightRegion>
    );
  }

  function tocEntries(): Array<{ level: 'h1' | 'h2' | 'h3' | 'h4'; text: string; numberPrefix: string; meta?: string }> {
    const entries: Array<{ level: 'h1' | 'h2' | 'h3' | 'h4'; text: string; numberPrefix: string; meta?: string }> = [];
    const n = (level: 'h1' | 'h2' | 'h3' | 'h4', p: number, f: number, s: number) => {
      if (!preset.misc.numberHeadings) return '';
      const h = preset.headings[level];
      if (!h.numbered) return '';
      if (level === 'h1') return `${p}. `;
      if (level === 'h2') return `${p}.${f} `;
      if (level === 'h3') return `${p}.${f}.${s} `;
      return `${p}.${f}.${s}.1 `;
    };
    SAMPLE_PROJECTS.forEach((project, p) => {
      entries.push({
        level: 'h1',
        text: project.label,
        numberPrefix: n('h1', p + 1, 0, 0),
        meta: `${project.files.length} files`,
      });
      project.files.forEach((file, f) => {
        entries.push({
          level: 'h2',
          text: file.name,
          numberPrefix: n('h2', p + 1, f + 1, 0),
          meta: preset.misc.showFileMetadata ? `${file.language} · ${formatBytes(file.size)}` : undefined,
        });
      });
      entries.push({ level: 'h3', text: 'Notes', numberPrefix: n('h3', 1, 1, 1) });
      entries.push({ level: 'h4', text: 'Implementation Notes', numberPrefix: n('h4', 1, 1, 1) });
    });
    return entries;
  }

  function renderToc(key: string) {
    const h1 = preset.headings.h1;
    return (
      <HighlightRegion key={key} id="toc" highlight={highlight}>
        <div
          style={{
            fontFamily: fontStack(h1.font),
            fontSize: h1.sizePt * PT_TO_PX,
            fontWeight: WEIGHT_MAP[h1.weight],
            fontStyle: h1.italic ? 'italic' : 'normal',
            color: h1.color,
            marginBottom: 12,
          }}
        >
          Table of Contents
        </div>
        {tocEntries().map((entry, i) => {
          const hs = preset.headings[entry.level];
          const depth = entry.level === 'h1' ? 0 : entry.level === 'h2' ? 16 : entry.level === 'h3' ? 32 : 48;
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 6,
                marginLeft: depth,
                marginTop: entry.level === 'h1' ? 10 : 2,
                fontFamily: entry.level === 'h1' ? fontStack(hs.font) : fontStack(preset.typography.bodyFont),
                fontWeight: entry.level === 'h1' ? WEIGHT_MAP[hs.weight] : 400,
                fontStyle: entry.level === 'h1' && hs.italic ? 'italic' : 'normal',
                fontSize: entry.level === 'h1' ? 12 : entry.level === 'h2' ? 11 : 10,
                // Project-level TOC lines are headings-in-context — they use
                // the Headings document color (spec §10).
                color: entry.level === 'h1' ? preset.colors.headings : preset.colors.secondaryText,
              }}
            >
              <span>
                <span style={{ color: preset.colors.accent }}>{entry.numberPrefix}</span>
                {entry.text}
              </span>
              {entry.meta && (
                <span style={{ fontSize: 9, color: preset.colors.mutedText }}>— {entry.meta}</span>
              )}
            </div>
          );
        })}
      </HighlightRegion>
    );
  }

  function renderProjectHeader(projectIdx: number, key: string) {
    const ph = preset.projectHeaders;
    const project = SAMPLE_PROJECTS[projectIdx];
    const totalSize = project.files.reduce((a, f) => a + f.size, 0);
    return (
      <HighlightRegion key={key} id="project-header" highlight={highlight}>
        {ph.showTitle && (
          <div
            style={{
              fontFamily: fontStack(ph.font),
              fontSize: ph.sizePt * PT_TO_PX,
              fontWeight: WEIGHT_MAP[ph.weight],
              color: ph.color,
              textTransform: ph.uppercase ? 'uppercase' : 'none',
              textAlign: ph.alignment,
              marginTop: ph.spaceBeforePt,
              marginBottom: ph.spaceAfterPt,
            }}
          >
            <span style={{ color: preset.colors.accent }}>{projectIdx + 1}. </span>
            {project.label}
          </div>
        )}
        {ph.showPath && (
          <div style={{ fontSize: 10, color: preset.colors.mutedText, marginBottom: 4 }}>
            Path: {project.path}
          </div>
        )}
        {ph.showMetadata && (
          <div style={{ fontSize: 10, color: preset.colors.mutedText, marginBottom: ph.spaceAfterPt }}>
            Files: {project.files.length} · Size: {formatBytes(totalSize)}
          </div>
        )}
      </HighlightRegion>
    );
  }

  function structureLines(projectIdx: number): string[] {
    const project = SAMPLE_PROJECTS[projectIdx];
    interface Node {
      name: string;
      children: Map<string, Node>;
      isFile: boolean;
      size?: number;
    }
    const root: Node = { name: '', children: new Map(), isFile: false };
    for (const path of project.structure) {
      const parts = path.split('/');
      let node = root;
      parts.forEach((part, i) => {
        const isLast = i === parts.length - 1;
        if (!node.children.has(part)) {
          node.children.set(part, { name: part, children: new Map(), isFile: isLast });
        }
        node = node.children.get(part)!;
        if (isLast) {
          node.isFile = true;
          const file = project.files.find((f) => f.path === path);
          node.size = file?.size ?? 128;
        }
      });
    }
    const out: string[] = [];
    const walk = (node: Node, prefix: string, isRoot: boolean) => {
      let entries = Array.from(node.children.values());
      if (preset.projectStructure.dirsFirst) {
        entries.sort((a, b) => {
          if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
          return a.name.localeCompare(b.name);
        });
      } else {
        entries.sort((a, b) => a.name.localeCompare(b.name));
      }
      entries.forEach((entry, i) => {
        const isLast = i === entries.length - 1;
        const connector = isRoot ? '' : isLast ? '└── ' : '├── ';
        const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
        const sizeSuffix =
          preset.projectStructure.showFileSizes && entry.isFile && entry.size != null
            ? `  (${formatBytes(entry.size)})`
            : '';
        out.push(`${prefix}${connector}${entry.name}${sizeSuffix}`);
        if (!entry.isFile) walk(entry, childPrefix, false);
      });
    };
    walk(root, '', true);
    return out;
  }

  function renderStructure(projectIdx: number, key: string) {
    const ps = preset.projectStructure;
    const h2 = preset.headings.h2;
    const lines = structureLines(projectIdx);
    return (
      <HighlightRegion key={key} id="structure" highlight={highlight} style={{ marginBottom: preset.layout.sectionSpacingPt }}>
        <div
          style={{
            fontFamily: fontStack(h2.font),
            fontSize: h2.sizePt * PT_TO_PX,
            fontWeight: WEIGHT_MAP[h2.weight],
            fontStyle: h2.italic ? 'italic' : 'normal',
            color: h2.color,
            marginBottom: 8,
          }}
        >
          <span style={{ color: preset.colors.accent }}>
            {preset.misc.numberHeadings && h2.numbered ? `${projectIdx + 1}.${SAMPLE_PROJECTS[projectIdx].files.length + 1} ` : ''}
          </span>
          Project Structure
        </div>
        <div
          style={{
            fontFamily: `${fontStack(ps.font)}, "DejaVu Sans Mono", monospace`,
            fontSize: ps.fontSizePt * PT_TO_PX,
            color: ps.color,
            whiteSpace: 'pre',
            lineHeight: ps.lineHeight,
          }}
        >
          {lines.join('\n')}
        </div>
      </HighlightRegion>
    );
  }

  function renderHeading(el: Extract<PreviewElement, { type: 'heading' }>, key: string) {
    const h = preset.headings[el.level];
    return (
      <HighlightRegion
        key={key}
        id={el.level === 'h1' ? 'heading-h1' : el.level === 'h2' ? 'heading-h2' : el.level === 'h3' ? 'heading-h3' : 'heading-h4'}
        highlight={highlight}
        style={{
          fontFamily: fontStack(h.font),
          fontSize: h.sizePt * PT_TO_PX,
          fontWeight: WEIGHT_MAP[h.weight],
          fontStyle: h.italic ? 'italic' : 'normal',
          color: h.color,
          textAlign: h.alignment,
          marginTop: h.spaceBeforePt,
          marginBottom: h.spaceAfterPt,
          lineHeight: h.lineHeight,
          textIndent: h.indentPt,
        }}
      >
        <span style={{ color: preset.colors.accent }}>{el.numberPrefix}</span>
        {el.text}
      </HighlightRegion>
    );
  }

  /** Success / Warning / Error rows on a Surface card with a Borders border. */
  function renderStatusCard(key: string) {
    const rows: Array<{ glyph: string; text: string; color: string }> = [
      { glyph: '✓', text: '128 checks passed — all selected files parsed', color: preset.colors.success },
      { glyph: '⚠', text: '2 deprecation warnings in build scripts', color: preset.colors.warning },
      { glyph: '✗', text: '1 unresolved import flagged for review', color: preset.colors.error },
    ];
    return (
      <div
        key={key}
        data-codice-region="status-card"
        style={{
          background: preset.colors.surface,
          border: `0.5px solid ${preset.colors.borders}`,
          borderRadius: 6,
          padding: '10px 12px',
          marginBottom: preset.typography.paragraphSpacingPt,
          fontFamily: fontStack(preset.typography.bodyFont),
          fontSize: 11,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: preset.colors.mutedText, marginBottom: 6 }}>
          Validation summary
        </div>
        {rows.map((row) => (
          <div key={row.text} style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 3 }}>
            <span style={{ color: row.color, fontWeight: 700 }}>{row.glyph}</span>
            <span style={{ color: row.color }}>{row.text}</span>
          </div>
        ))}
      </div>
    );
  }

  function renderFileHeader(projectIdx: number, fileIdx: number, key: string) {
    const fh = preset.fileHeaders;
    const file = SAMPLE_PROJECTS[projectIdx].files[fileIdx];
    const hl = getHl(file.path);
    const lineCount = hl ? hl.lines.length : file.code.split('\n').length;
    const metaBits: string[] = [];
    if (fh.showLanguageLabel) metaBits.push(languageLabelOf(file.language));
    if (fh.showFileSize) metaBits.push(formatBytes(file.size));
    if (fh.showLineCount) metaBits.push(`${lineCount} lines`);
    return (
      <HighlightRegion
        key={key}
        id="file-header"
        highlight={highlight}
        style={{
          fontFamily: fontStack(fh.font),
          fontSize: fh.fontSizePt * PT_TO_PX,
          color: fh.textColor,
          background: fh.background === 'transparent' ? undefined : fh.background,
          borderBottom: fh.borderBottom ? `1px solid ${fh.borderColor}` : undefined,
          padding: '4px 0',
          marginBottom: preset.fileHeaders.spacingAfterPt,
        }}
      >
        {fh.showFileName && (
          <div style={{ fontWeight: fh.bold ? 700 : 400 }}>{file.name}</div>
        )}
        {fh.showRelativePath && (
          <div style={{ fontSize: fh.fontSizePt * PT_TO_PX - 1, opacity: 0.85, fontWeight: fh.bold ? 700 : 400 }}>
            {file.path}
          </div>
        )}
        {metaBits.length > 0 && (
          <div style={{ fontSize: fh.fontSizePt * PT_TO_PX - 1, color: preset.colors.mutedText, marginTop: 2 }}>
            {metaBits.join('  ·  ')}
          </div>
        )}
      </HighlightRegion>
    );
  }

  function renderCodeBlock(
    el: Extract<PreviewElement, { type: 'code' }>,
    key: string,
    bg: string,
    fg: string,
    borderCss: string,
  ) {
    const c = preset.code;
    const file = SAMPLE_PROJECTS[el.projectIdx].files[el.fileIdx];
    const hl = getHl(file.path);
    const lines = hl ? hl.lines.slice(el.fromLine, el.toLine) : null;
    const lineNumberWidth = c.lineNumberWidthChars > 0
      ? c.lineNumberWidthChars
      : hl
        ? String(hl.lines.length).length
        : 2;
    return (
      <HighlightRegion
        key={key}
        id="code"
        highlight={highlight}
        style={{
          background: bg,
          fontFamily: `${fontStack(c.font)}, "DejaVu Sans Mono", monospace`,
          fontSize: c.fontSizePt * PT_TO_PX,
          fontWeight: WEIGHT_MAP[c.fontWeight],
          lineHeight: c.lineHeight,
          padding: c.paddingPt,
          borderRadius: c.borderRadiusPt,
          border: borderCss,
          overflow: 'hidden',
          marginTop: preset.code.blockSpacingBeforePt,
          marginBottom: preset.code.blockSpacingAfterPt,
        }}
      >
        {lines ? (
          lines.map((line) => (
            <div key={`${key}-${line.lineNumber}`} style={{ display: 'flex' }}>
              {c.showLineNumbers && (
                <span
                  style={{
                    color: c.lineNumberColor,
                    background: c.lineNumberBackground ?? undefined,
                    width: `${lineNumberWidth + 1}ch`,
                    marginRight: 8,
                    textAlign: 'right',
                    userSelect: 'none',
                    flexShrink: 0,
                  }}
                >
                  {el.startLineNumber + line.lineNumber - (el.fromLine + 1) + 1}
                </span>
              )}
              <span
                style={{
                  whiteSpace: c.wrapLongLines ? 'pre-wrap' : 'pre',
                  wordBreak: c.wrapLongLines ? 'break-word' : 'normal',
                  overflow: c.wrapLongLines ? 'hidden' : 'auto',
                  color: fg,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {line.tokens.length === 0
                  ? '\u00A0'
                  : line.tokens.map((tok, i) => (
                      <span
                        key={i}
                        style={{
                          color: tok.color ?? undefined,
                          fontWeight: tok.bold ? 700 : undefined,
                          fontStyle: tok.italic ? 'italic' : undefined,
                        }}
                      >
                        {line.text.slice(tok.start, tok.start + tok.length)}
                      </span>
                    ))}
              </span>
            </div>
          ))
        ) : (
          <div style={{ opacity: 0.5, color: fg, minHeight: 40 }}>Highlighting…</div>
        )}
      </HighlightRegion>
    );
  }

  /* ---------------- Page rendering ---------------- */

  const stepZoom = (delta: number) => {
    const base = zoom === 'fit' ? Math.round(fitScale * 100) : zoom;
    setZoom(Math.min(200, Math.max(30, base + delta)));
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* ---------- Toolbar: zoom + page navigation ---------- */}
      <div className="flex flex-shrink-0 items-center gap-1 border-b border-app bg-surface/70 px-3 py-1.5 backdrop-blur">
        <div className="flex items-center gap-0.5">
          <ToolbarButton label="Zoom out" onClick={() => stepZoom(-10)}>
            <Minus size={13} />
          </ToolbarButton>
          <button
            onClick={() => setZoom('fit')}
            className={`rounded px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors ${
              zoom === 'fit'
                ? 'bg-[var(--color-accent)] text-[var(--color-accent-text)]'
                : 'text-secondary hover-surface'
            }`}
            title="Fit to width"
          >
            {zoom === 'fit' ? 'Fit' : `${zoom}%`}
          </button>
          <ToolbarButton label="Zoom in" onClick={() => stepZoom(10)}>
            <Plus size={13} />
          </ToolbarButton>
        </div>

        <div className="mx-2 h-4 w-px bg-[var(--color-border)]" aria-hidden />

        <div className="flex items-center gap-0.5">
          <ToolbarButton label="Previous page" onClick={() => scrollToPage(currentPage - 1)} disabled={currentPage <= 1}>
            <ChevronUp size={13} />
          </ToolbarButton>
          <span className="min-w-[64px] text-center text-[11px] tabular-nums text-secondary">
            Page {Math.min(currentPage, pages.length)} / {pages.length}
          </span>
          <ToolbarButton label="Next page" onClick={() => scrollToPage(currentPage + 1)} disabled={currentPage >= pages.length}>
            <ChevronDown size={13} />
          </ToolbarButton>
        </div>

        <div className="ml-auto text-[10px] text-muted">
          {pageW}×{pageH}px · {preset.page.landscape ? 'landscape' : 'portrait'}
        </div>
      </div>

      {/* ---------- Scrollable pages ---------- */}
      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-auto p-4">
        <div ref={containerRef} className="mx-auto flex flex-col items-center gap-6" style={{ width: pageW * scale }}>
          {pages.map((page, idx) => {
            const underFilled = page.kind !== 'content';
            const vAlign = preset.titlePage.verticalAlignment;
            const justify =
              underFilled && vAlign === 'center'
                ? 'center'
                : underFilled && vAlign === 'bottom'
                  ? 'flex-end'
                  : 'flex-start';
            const isCurrent = currentPage === idx + 1;
            return (
              <div key={idx} className="group/page" style={{ width: pageW * scale }}>
                <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', marginBottom: -(pageH - pageH * scale) }}>
                <div
                  data-page={idx + 1}
                  style={{
                    width: pageW,
                    minHeight: pageH,
                    background: preset.colors.background,
                    color: preset.colors.primaryText,
                    position: 'relative',
                    boxShadow: isCurrent
                      ? '0 4px 20px rgba(0,0,0,0.35), 0 0 0 1px color-mix(in srgb, var(--color-accent) 25%, transparent)'
                      : '0 2px 12px rgba(0,0,0,0.25)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: justify,
                    paddingTop: marginTop,
                    paddingBottom: marginBottom,
                    paddingLeft: marginLeft,
                    paddingRight: marginRight,
                    transition: 'box-shadow 200ms ease',
                  }}
                >
                  {/* Header — positioned at the very top of the page */}
                  {preset.page.pageHeaderShow && (
                    <div style={{ position: 'absolute', top: Math.max(8, marginTop - headerReserve / 2 - 10), left: marginLeft, right: marginRight }}>
                      {renderHeaderRow()}
                    </div>
                  )}

                  {/* Content */}
                  <div style={{ flex: '0 0 auto' }}>
                    {page.elements.map((el, i) => renderElement(el, `${idx}-${i}`))}
                  </div>

                  {/* Footer — positioned at the very bottom */}
                  {preset.page.pageFooterShow && (
                    <div style={{ position: 'absolute', bottom: Math.max(8, marginBottom - footerReserve / 2 - 10), left: marginLeft, right: marginRight }}>
                      {renderFooterRow(page, idx + 1)}
                    </div>
                  )}
                </div>
                </div>
                {/* Page caption chip — natural size, centered under the page */}
                <div className="flex justify-center">
                  <span
                    className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] tabular-nums transition-colors ${
                      isCurrent
                        ? 'border-[var(--color-accent)] text-accent'
                        : 'border-app text-muted'
                    }`}
                  >
                    {idx + 1} / {pages.length}
                    {page.kind !== 'content' && (
                      <span className="opacity-70">· {page.kind}</span>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  function scrollToPage(n: number) {
    const sc = scrollRef.current;
    if (!sc) return;
    const target = n < 1 ? 1 : n > pages.length ? pages.length : n;
    const el = sc.querySelector(`[data-page="${target}"]`) as HTMLElement | null;
    if (el) {
      // jsdom (and some engines) don't implement scrollIntoView.
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
      setCurrentPage(target);
    }
  }

  function handleScroll() {
    const sc = scrollRef.current;
    if (!sc) return;
    const scTop = sc.getBoundingClientRect().top;
    let current = 1;
    sc.querySelectorAll('[data-page]').forEach((el) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.top - scTop <= 80) {
        current = Number((el as HTMLElement).dataset.page);
      }
    });
    setCurrentPage(current);
  }
}

/** Small icon button used in the preview toolbar. */
function ToolbarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-6 w-6 items-center justify-center rounded text-secondary transition-colors hover-surface disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function languageLabelOf(id: string): string {
  const map: Record<string, string> = {
    kotlin: 'Kotlin',
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    markdown: 'Markdown',
    shell: 'Shell',
    java: 'Java',
    python: 'Python',
    go: 'Go',
    rust: 'Rust',
  };
  return map[id] ?? id;
}
