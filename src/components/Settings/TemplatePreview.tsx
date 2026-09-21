'use client';

/**
 * Codice Template Preview.
 *
 * §15/§46 — renders the REAL user document (same state projection the main
 * preview uses), not a private dummy model:
 *
 *   state (projects/files/details/images) + preset + metadata
 *     → shared element builder / custom-layout resolver
 *     → shared paginator → these pages.
 *
 * When NO files are selected at all (new users), it falls back to a tiny
 * built-in SAMPLE project (clearly captioned) so the template editor is
 * never blank.
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
import { ToolbarButton } from '@/components/common/PreviewControls';
import type { DocumentPreset } from '@/lib/presets/documentPreset';
import type {
  DocumentImage,
  DocumentMetadata,
  DocumentProject,
  FileDetails,
  FooterSlotType,
  HighlightedFile,
  ImageAsset,
} from '@/types';
import { highlightFile, getThemeColors, plainHighlightedFile } from '@/lib/highlight/highlighter';
import { resolveSyntaxTheme } from '@/lib/themes/syntaxThemeRegistry';
import { fontStack } from '@/lib/fonts/fontCatalog';
import { formatBytes } from '@/lib/fileDiscovery';
import { languageLabel } from '@/lib/languageDetection';
import { expandTokens } from '@/lib/tokens';
import { useAppState } from '@/hooks/useAppState';
import { effectiveFileOrder } from '@/lib/documentOrder';
import { resolveCustomLayout, type ResolutionInputs } from '@/lib/customLayouts/resolver';
import {
  customLayoutToElements,
  buildLayoutIndexMaps,
} from '@/lib/customLayouts/previewElements';
import {
  buildDocumentElements,
  paginateDocument,
  pageBoxPx,
  pageContentAlignment,
  MM_TO_PX,
  PT_TO_PX,
  WEIGHT_MAP,
  type PaginationProject,
  type PreviewElement,
  type PreviewPage,
} from '@/lib/preview/documentPagination';

/* ------------------------------------------------------------------ */
/* Fallback sample — only used when the user has no files selected.    */
/* ------------------------------------------------------------------ */

const SAMPLE_KT = `package com.example

/*
 * A tiny sample document so the template editor is never blank.
 * Add files to your project to preview YOUR document here.
 */
fun main() {
    val users = listOf("Ada", "Alan", "Grace")
    println("Hello from Codice! Users: " + users.joinToString())
}`;

/** §15 — minimal ONE-file fallback, clearly labeled in the toolbar caption. */
const SAMPLE_PROJECTS: PaginationProject[] = [
  {
    label: 'sample',
    path: 'sample/',
    structure: [
      'README.md',
      'src/main/kotlin/com/example/Main.kt',
    ],
    files: [
      {
        name: 'Main.kt',
        path: 'src/main/kotlin/com/example/Main.kt',
        language: 'kotlin',
        size: 412,
        code: SAMPLE_KT,
        outlineFileId: 'sample-main',
        details: {
          description: 'A tiny sample file — the template preview falls back to this when no files are selected.',
        },
      },
    ],
  },
];

/** Cache key that includes the syntax theme so theme changes invalidate it. */
function cacheKey(fileId: string, theme: string): string {
  return `${fileId}::${theme}`;
}

/** Preview file limit — mirrors the main preview's documented window. */
const PREVIEW_LIMIT = 25;

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
  outlineId,
}: {
  id: string;
  highlight: HighlightSignal;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  as?: 'div' | 'section';
  /** §39 — optional outline anchor for landmark regions (panel/columns/…). */
  outlineId?: string;
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
      // Scrolling is performed ONCE for the whole change batch by the
      // preview-level effect below (spec §3) — per-region scrolls would
      // compound and fight each other's smooth animations.
      return () => window.clearTimeout(t);
    }
  }, [active, highlight.nonce, id]);

  const Tag = as;
  return (
    <Tag
      ref={ref as any}
      data-highlight={id}
      data-outline-id={outlineId}
      className={className}
      style={style}
    >
      {children}
    </Tag>
  );
}

/**
 * Scroll the preview's own scroll container so `el` sits ~1/4 from the top
 * of the viewport (spec §3):
 *   - never scrolls the page itself — only the closest preview scroller;
 *   - accounts for the scale transform on the page box (visual px vs layout
 *     px) by deriving the ratio from offsetWidth vs bounding width;
 *   - keeps the surrounding UI scroll state intact (no horizontal scrolling,
 *     no window scrolling).
 */
export function bringRegionIntoView(el: HTMLElement): void {
  const sc = el.closest('[data-preview-scroll]') as HTMLElement | null;
  if (!sc || typeof sc.scrollTop !== 'number') return;
  const scRect = sc.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  // Element already comfortably visible? Leave the scroll state untouched.
  const margin = 48;
  const fullyVisible =
    elRect.top >= scRect.top + margin &&
    elRect.bottom <= scRect.bottom - margin;
  if (fullyVisible) return;
  // The page boxes carry a scale transform, but their wrappers already
  // occupy the SCALED space in the scroller's layout — so getBoundingClientRect
  // minus the scroller rect is ALREADY in content/scroll coordinates. No
  // scale compensation is needed (dividing by the transform ratio would
  // overshoot by ~1.5× at typical fit scales).
  const current = typeof sc.scrollTop === 'number' ? sc.scrollTop : 0;
  const elTopInScroller = elRect.top - scRect.top + current;
  // Desired: element ~25% from the viewport top (or near-top if tall).
  const viewportH = sc.clientHeight || 400;
  const desiredOffsetRatio = elRect.height > viewportH * 0.6 ? 0.12 : 0.25;
  let target = Math.max(0, elTopInScroller - viewportH * desiredOffsetRatio);
  const maxScroll = Math.max(0, sc.scrollHeight - viewportH);
  target = Math.min(target, maxScroll);
  if (Math.abs(target - current) < 2) return;
  if (typeof sc.scrollTo === 'function') {
    sc.scrollTo({ top: target, behavior: 'smooth' });
  } else {
    sc.scrollTop = target; // jsdom fallback
  }
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
  // §15 — REAL user data: the same state projection the main preview uses.
  const { state, getSelectedFiles } = useAppState();
  const resolvedTheme = resolveSyntaxTheme(preset.syntaxTheme);
  const [highlighted, setHighlighted] = useState<Record<string, HighlightedFile>>({});
  const [themeColors, setThemeColors] = useState({ background: '#0d1117', foreground: '#e6edf3' });
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(640);
  // Zoom: 'fit' or a percentage (30–200) — this preview's OWN zoom state.
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [currentPage, setCurrentPage] = useState(1);

  // Gather all selected files across projects — in the CANONICAL document
  // order (§13/§36) with per-file details + images attached (§6/§10).
  const allSelected = useMemo(() => {
    const result: Array<{
      projectLabel: string;
      projectId: string;
      relativePath: string;
      language: string | null;
      sizeBytes: number;
      fileId: string;
      details?: FileDetails;
      images?: DocumentImage[];
    }> = [];
    for (const project of state.projects) {
      const selected = getSelectedFiles(project.id);
      const ordered = effectiveFileOrder(project.files, state.fileOrder[project.id]);
      for (const file of ordered) {
        if (selected.has(file.id)) {
          const details = state.fileDetails[file.id];
          const imageIds = state.fileImages[file.id] ?? [];
          const images = imageIds
            .map((id) => state.imageAssets.find((a) => a.id === id))
            .filter((a): a is ImageAsset => Boolean(a))
            .map((a) => ({
              id: a.id,
              name: a.name,
              dataUrl: a.dataUrl,
              mime: a.mime,
              width: a.width,
              height: a.height,
              caption: a.caption,
            }));
          result.push({
            projectLabel: project.label,
            projectId: project.id,
            relativePath: file.relativePath,
            language: file.language,
            sizeBytes: file.size,
            fileId: file.id,
            ...(details ? { details } : {}),
            ...(images.length > 0 ? { images } : {}),
          });
        }
      }
    }
    return result;
  }, [
    state.projects,
    state.fileOrder,
    state.fileDetails,
    state.fileImages,
    state.imageAssets,
    getSelectedFiles,
  ]);

  const filesToPreview = allSelected.slice(0, PREVIEW_LIMIT);
  /** §15 — no files selected → the clearly-captioned minimal sample. */
  const usingSample = allSelected.length === 0;

  // Prune stale theme entries when the theme changes.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setHighlighted((prev) => {
        const next: Record<string, HighlightedFile> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (k.endsWith(`::${resolvedTheme}`)) next[k] = v;
        }
        return next;
      });
    }, 0);
    return () => window.clearTimeout(t);
  }, [resolvedTheme]);

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

  // §15 — LAZY highlight of the real user files (or the fallback sample)
  // with the selected Shiki theme, cached per (fileId, theme).
  useEffect(() => {
    let cancelled = false;
    // .catch guard: a theme that fails to load must never leave stale
    // background/foreground colors behind (spec §6 — background stays in
    // lockstep with the selected Shiki theme).
    getThemeColors(resolvedTheme)
      .then((c) => {
        if (!cancelled) setThemeColors(c);
      })
      .catch(() => {
        if (!cancelled) setThemeColors({ background: '#0d1117', foreground: '#e6edf3' });
      });
    (async () => {
      const targets: Array<{
        id: string;
        path: string;
        language: string | null;
        load: () => Promise<string | null>;
      }> = usingSample
        ? SAMPLE_PROJECTS[0].files.map((f) => ({
            id: f.outlineFileId!,
            path: f.path,
            language: f.language,
            load: async () => f.code ?? '',
          }))
        : filesToPreview.map((item) => {
            const project = state.projects.find((p) => p.id === item.projectId);
            const file = project?.files.find((f) => f.id === item.fileId);
            const handle = file?.fileHandle;
            return {
              id: item.fileId,
              path: item.relativePath,
              language: item.language,
              load: async () => (handle ? await handle.getText() : null),
            };
          });
      for (const target of targets) {
        if (cancelled) return;
        const key = cacheKey(target.id, resolvedTheme);
        if (highlighted[key]) continue;
        try {
          const text = await target.load();
          if (text == null) continue;
          let hl: HighlightedFile;
          try {
            hl = await highlightFile(target.id, target.path, target.language, text, resolvedTheme);
          } catch {
            // spec §8: a file whose highlighting fails (unknown language,
            // grammar error) still renders — as plaintext.
            hl = plainHighlightedFile(target.id, target.path, text);
          }
          if (!cancelled) {
            setHighlighted((prev) => ({ ...prev, [key]: hl }));
          }
        } catch {
          // Unreadable file handle — nothing to render.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [usingSample, filesToPreview.map((f) => f.fileId).join(','), resolvedTheme]);

  // spec §3 — ONE scroll per change batch: bring the FIRST affected region
  // into the upper portion of the preview viewport (never the bottom edge).
  useEffect(() => {
    if (highlight.ids.length === 0 || highlight.nonce === 0) return;
    const raf = window.requestAnimationFrame(() => {
      const root = containerRef.current;
      if (!root) return;
      for (const id of highlight.ids) {
        const el = root.querySelector<HTMLElement>(`[data-highlight="${id}"]`);
        if (el) {
          bringRegionIntoView(el);
          break;
        }
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [highlight.nonce, highlight.ids]);

  const getHl = useCallback(
    (fileId: string | undefined): HighlightedFile | null =>
      fileId ? highlighted[cacheKey(fileId, resolvedTheme)] ?? null : null,
    [highlighted, resolvedTheme],
  );

  /* ---------------- Real document projection (shared model) ---------------- */

  const paginationProjects = useMemo<PaginationProject[]>(() => {
    if (usingSample) return SAMPLE_PROJECTS;
    const groups: PaginationProject[] = [];
    for (const item of filesToPreview) {
      let g = groups.find((g) => g.label === item.projectLabel && g.outlineProjectId === item.projectId);
      if (!g) {
        g = {
          label: item.projectLabel,
          path: `${item.projectLabel}/`,
          structure: [],
          files: [],
          outlineProjectId: item.projectId,
        };
        groups.push(g);
      }
      g.structure.push(item.relativePath);
      g.files.push({
        name: item.relativePath.split('/').pop() || item.relativePath,
        path: item.relativePath,
        language: item.language ?? 'plaintext',
        size: item.sizeBytes,
        outlineFileId: item.fileId,
        ...(item.details ? { details: item.details } : {}),
        ...(item.images ? { images: item.images } : {}),
      });
    }
    return groups;
  }, [usingSample, filesToPreview]);

  /* ---------------- Applied custom layout (§16-§33, same as main preview) ---------------- */

  const appliedLayout = useMemo(
    () => state.customLayouts.find((t) => t.id === state.appliedLayoutId) ?? null,
    [state.customLayouts, state.appliedLayoutId],
  );

  // DocumentProject-shaped projection of the pagination groups (the
  // resolver consumes the document model, not preview internals).
  const layoutProjects = useMemo<DocumentProject[]>(
    () =>
      paginationProjects.map((g) => ({
        id: g.outlineProjectId ?? g.label,
        label: g.label,
        folderName: g.label,
        structurePaths: [],
        files: g.files.map((f) => ({
          projectId: g.outlineProjectId ?? g.label,
          projectLabel: g.label,
          relativePath: f.path,
          language: null,
          highlighted: {
            fileId: f.outlineFileId ?? f.path,
            relativePath: f.path,
            language: null,
            lines: [],
          },
          sizeBytes: f.size,
          details: f.details,
          images: f.images,
        })),
      })),
    [paginationProjects],
  );

  const layoutResolution = useMemo(() => {
    if (!appliedLayout) return null;
    const inputs: ResolutionInputs = {
      projects: layoutProjects,
      fileDetails: state.fileDetails,
      fileFieldValues: state.fileFieldValues,
      sectionFieldValues: state.sectionFieldValues,
      documentFieldValues: state.documentFieldValues,
      fileOrder: state.fileOrder,
      assignments: state.layoutAssignments,
      imageAssets: Object.fromEntries(state.imageAssets.map((a) => [a.id, a])),
      metadata: state.metadata,
      fileCount: layoutProjects.reduce((acc, p) => acc + p.files.length, 0),
      // §12/§14 — preset panel text color is the resolver-level default.
      panelText: preset.colors.panelText,
    };
    return resolveCustomLayout(appliedLayout, inputs);
  }, [
    appliedLayout,
    layoutProjects,
    state.fileDetails,
    state.fileFieldValues,
    state.sectionFieldValues,
    state.documentFieldValues,
    state.fileOrder,
    state.layoutAssignments,
    state.imageAssets,
    state.metadata,
    preset.colors.panelText,
  ]);

  /* ---------------- Document elements (shared model) ---------------- */

  const elements = useMemo(
    () =>
      layoutResolution
        ? customLayoutToElements(
            layoutResolution,
            paginationProjects,
            buildLayoutIndexMaps(paginationProjects),
          )
        : // Real data mirrors the main preview exactly; ONLY the fallback
          // sample injects the notes/status showcase so every setting stays
          // visible for brand-new users (§15: no second fake model).
          buildDocumentElements(preset, paginationProjects, usingSample ? { includeNotesBlock: true } : {}),
    [layoutResolution, preset, paginationProjects, usingSample],
  );

  /* ---------------- Pagination (shared paginator) ---------------- */

  const pages = useMemo(
    () =>
      paginateDocument(elements, preset, paginationProjects, {
        getLineCount: (file) => {
          const hl = getHl(file.outlineFileId);
          if (hl) return hl.lines.length;
          return file.code ? file.code.split('\n').length : 1;
        },
        getLineText: (file, lineIdx) => {
          const hl = getHl(file.outlineFileId);
          return hl?.lines[lineIdx]?.text ?? '';
        },
      }),
    [elements, preset, paginationProjects, getHl],
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
  const totalFileCount = usingSample
    ? SAMPLE_PROJECTS.reduce((acc, pr) => acc + pr.files.length, 0)
    : allSelected.length;
  const firstProjectLabel = paginationProjects[0]?.label ?? '';
  const firstFileName = paginationProjects[0]?.files[0]?.name ?? '';

  function headerText(slot: string | null): string | null {
    if (slot == null || slot === '') return null;
    return expandTokens(slot, {
      title: metadata.title ?? '',
      author: metadata.author ?? '',
      date: metadata.date || today,
      time: nowDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      files: totalFileCount,
      projectName: firstProjectLabel,
      fileName: firstFileName,
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
          files: totalFileCount,
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
          <HighlightRegion
            key={key}
            id="body"
            highlight={highlight}
            style={{
              // §5/§46 — preset body style is the default; resolved props
              // override. Color falls back to INHERIT so panels (§12) tint
              // their children through the CSS cascade.
              color: el.color ?? 'inherit',
              fontSize: (el.fontSizePt ?? preset.typography.bodyFontSizePt) * PT_TO_PX,
              fontWeight:
                el.bold === true
                  ? WEIGHT_MAP.bold
                  : el.bold === false
                    ? WEIGHT_MAP.normal
                    : WEIGHT_MAP[preset.typography.bodyWeight],
              fontStyle: el.italic === true ? 'italic' : el.italic === false ? 'normal' : undefined,
              textAlign: el.align,
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
          </HighlightRegion>
        );
      case 'statusCard':
        return renderStatusCard(key);
      case 'fileHeader':
        return renderFileHeader(el.projectIdx, el.fileIdx, key);
      case 'fileDetail':
        return renderFileDetail(el, key);
      case 'code':
        return renderCodeBlock(el, key, effectiveBg, fallbackFg, codeBorderCss);
      case 'image':
        return renderImage(el, key);
      case 'spacer':
        return <div key={key} style={{ height: el.height }} />;
      case 'divider':
        return (
          <HighlightRegion
            key={key}
            id="divider"
            highlight={highlight}
            outlineId={el.outlineId}
            style={{
              height: Math.max(1, el.heightPx),
              background: el.fillColor ?? preset.colors.mutedText,
              borderRadius: Math.min(2, Math.max(1, el.heightPx / 2)),
              margin: `${preset.typography.paragraphSpacingPt}px 0`,
            }}
          />
        );
      case 'panel':
        return renderPanel(el, key);
      case 'columns':
        return renderColumns(el, key);
      case 'pageBreak':
        return null; // consumed by the paginator (real page separation)
      default:
        return null;
    }
  }

  /**
   * Title page — ONE coherent content group (spec §9).
   * §15 — REAL metadata first; the sample placeholders only apply to the
   * fallback sample so the title-page styling stays visible for new users.
   */
  function renderTitlePage(key: string) {
    const tp = preset.titlePage;
    const title = metadata.title || (usingSample ? 'Sample Project Report' : 'Untitled document');
    const subtitle = metadata.subtitle || (usingSample ? 'A Practical Guide to Codice Document Templates' : '');
    const author = metadata.author || (usingSample ? 'Ada Lovelace' : '');
    const course = metadata.course || (usingSample ? 'CS 402 — Software Engineering' : '');
    const university = metadata.university || (usingSample ? 'Sample State University' : '');
    const date = metadata.date || today;
    const version = metadata.version || (usingSample ? 'v1.0.0' : '');
    const description =
      metadata.description ||
      (usingSample
        ? 'This sample document demonstrates every template control: typography, spacing, colors, page behavior, and code presentation.'
        : '');

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
          <HighlightRegion id="heading-title" highlight={highlight}>
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
          </HighlightRegion>
        )}
        {tp.showSubtitle && subtitle && (
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
        {tp.showAuthor && author && (
          <div style={{ fontSize: preset.typography.bodyFontSizePt * PT_TO_PX + 2, color: preset.colors.secondaryText, marginTop: 18 }}>
            by {author}
          </div>
        )}
        {tp.showCourse && course && (
          <div style={{ fontSize: 12, color: preset.colors.mutedText, marginTop: 8 }}>
            {course}
          </div>
        )}
        {tp.showUniversity && university && (
          <div style={{ fontSize: 12, color: preset.colors.mutedText, marginTop: 4 }}>
            {university}
          </div>
        )}
        {tp.showDate && (
          <div style={{ fontSize: 11, color: preset.colors.mutedText, marginTop: 28 }}>
            {date}
          </div>
        )}
        {tp.showVersion && version && (
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
        {tp.showDescription && description && (
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
    paginationProjects.forEach((project, p) => {
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
    });
    if (usingSample) {
      // Only the fallback sample exercises H3/H4 TOC lines (§15).
      entries.push({ level: 'h3', text: 'Notes', numberPrefix: n('h3', 1, 1, 1) });
      entries.push({ level: 'h4', text: 'Implementation Notes', numberPrefix: n('h4', 1, 1, 1) });
    }
    return entries;
  }

  function renderToc(key: string) {
    const h1 = preset.headings.h1;
    const tocAlign = preset.toc.horizontalAlignment;
    const entryJustify =
      tocAlign === 'center' ? 'center' : tocAlign === 'right' ? 'flex-end' : 'flex-start';
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
            textAlign: tocAlign,
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
                justifyContent: entryJustify,
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
    const project = paginationProjects[projectIdx];
    if (!project) return null;
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
    const project = paginationProjects[projectIdx];
    if (!project) return [];
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
    const project = paginationProjects[projectIdx];
    if (!project) return null;
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
            {preset.misc.numberHeadings && h2.numbered ? `${projectIdx + 1}.${project.files.length + 1} ` : ''}
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
          // §46 — presentation overrides on top of the preset heading style.
          fontSize: (el.fontSizePt ?? h.sizePt) * PT_TO_PX,
          fontWeight:
            el.bold === true
              ? WEIGHT_MAP.bold
              : el.bold === false
                ? WEIGHT_MAP.normal
                : WEIGHT_MAP[h.weight],
          fontStyle:
            el.italic === true ? 'italic' : el.italic === false ? 'normal' : h.italic ? 'italic' : 'normal',
          color: el.color ?? h.color,
          textAlign: el.align ?? h.alignment,
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
      <HighlightRegion key={key} id="status-card" highlight={highlight}>
        <div
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
      </HighlightRegion>
    );
  }

  function renderFileHeader(projectIdx: number, fileIdx: number, key: string) {
    const fh = preset.fileHeaders;
    const file = paginationProjects[projectIdx]?.files[fileIdx];
    if (!file) return null;
    const hl = getHl(file.outlineFileId);
    const lineCount = hl ? hl.lines.length : file.code ? file.code.split('\n').length : 0;
    const metaBits: string[] = [];
    if (fh.showLanguageLabel) metaBits.push(languageLabel(file.language));
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

  /** §6 — a labeled detail paragraph (Description / Summary / Note / custom). */
  function renderFileDetail(
    el: Extract<PreviewElement, { type: 'fileDetail' }>,
    key: string,
  ) {
    return (
      <HighlightRegion
        key={key}
        id="file-detail"
        highlight={highlight}
        style={{ marginBottom: preset.typography.paragraphSpacingPt, textAlign: el.align }}
      >
        <div
          style={{
            fontSize: Math.max(9, (el.fontSizePt ?? preset.typography.bodyFontSizePt) * PT_TO_PX - 2),
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            color: preset.colors.mutedText,
            marginBottom: 3,
          }}
        >
          {el.label}
        </div>
        <p
          style={{
            // §12/§46 — resolved color wins; otherwise INHERIT so a panel's
            // text color reaches detail text that resolved no own color.
            color: el.color ?? 'inherit',
            fontSize: (el.fontSizePt ?? preset.typography.bodyFontSizePt) * PT_TO_PX,
            fontWeight:
              el.bold === true
                ? WEIGHT_MAP.bold
                : el.bold === false
                  ? WEIGHT_MAP.normal
                  : WEIGHT_MAP[preset.typography.bodyWeight],
            fontStyle: el.italic === true ? 'italic' : el.italic === false ? 'normal' : undefined,
            lineHeight: preset.typography.lineSpacing,
            margin: 0,
            fontFamily: fontStack(preset.typography.bodyFont),
            whiteSpace: 'pre-wrap',
          }}
        >
          {el.text}
        </p>
      </HighlightRegion>
    );
  }

  /** §10/§12 — an image (attached to a file or standalone from the layout). */
  function renderImage(el: Extract<PreviewElement, { type: 'image' }>, key: string) {
    const g = el.projectIdx !== undefined ? paginationProjects[el.projectIdx] : undefined;
    const file = el.fileIdx !== undefined ? g?.files[el.fileIdx] : undefined;
    const img = el.image ?? file?.images?.[el.imageIdx ?? 0];
    if (!img) return null;
    return (
      <figure
        key={key}
        data-codice-region="image"
        data-outline-id={el.outlineId}
        style={{
          margin: `${preset.typography.paragraphSpacingPt}pt 0`,
          textAlign: 'center',
        }}
      >
        <img
          src={img.dataUrl}
          alt={img.caption || img.name}
          style={{
            maxWidth: '62%',
            maxHeight: 420,
            height: 'auto',
            border: `0.5px solid ${preset.colors.borders}`,
            borderRadius: 2,
          }}
        />
        {img.caption && (
          <figcaption
            style={{
              fontSize: Math.max(9, preset.typography.bodyFontSizePt * PT_TO_PX - 3),
              color: preset.colors.secondaryText,
              marginTop: 4,
              fontStyle: 'italic',
            }}
          >
            {img.caption}
          </figcaption>
        )}
      </figure>
    );
  }

  /** §6 — visual container: fill/border/radius/padding around child blocks. */
  function renderPanel(el: Extract<PreviewElement, { type: 'panel' }>, key: string) {
    const hasChildren = el.children.length > 0;
    return (
      <HighlightRegion
        key={key}
        id="panel"
        highlight={highlight}
        outlineId={el.outlineId}
        style={{
          // §25 — panels fall back to the preset's panel colors when the
          // layout node declares none of its own.
          background: el.fillColor ?? preset.colors.panelFill ?? undefined,
          border:
            el.borderWidthPt && el.borderColor
              ? `${el.borderWidthPt}px solid ${el.borderColor}`
              : undefined,
          borderRadius: el.radiusPt ? el.radiusPt * PT_TO_PX : undefined,
          padding: el.paddingPt ? el.paddingPt * PT_TO_PX : undefined,
          height:
            !hasChildren && el.heightPt ? Math.max(1, el.heightPt * PT_TO_PX) : undefined,
          margin: `${preset.typography.paragraphSpacingPt}px 0`,
          // §12 — the panel's text color (node style → preset panelText) is
          // the DEFAULT for its content; children inherit through the CSS
          // cascade unless they resolved their own color.
          color: el.textColor ?? preset.colors.panelText,
        }}
      >
        {/* Key includes the child KIND — prevents DOM-node reuse across
            element kinds when the resolved stream shifts (React otherwise
            diffs removed shorthands against the new kind's longhands). */}
        {el.children.map((child, i) => renderElement(child, `${key}-${i}-${child.type}`))}
      </HighlightRegion>
    );
  }

  /** §6 — side-by-side regions; each column stacks its own children. */
  function renderColumns(el: Extract<PreviewElement, { type: 'columns' }>, key: string) {
    return (
      <HighlightRegion
        key={key}
        id="columns"
        highlight={highlight}
        outlineId={el.outlineId}
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
          margin: `${preset.typography.paragraphSpacingPt}px 0`,
        }}
      >
        {el.columns.map((col, i) => (
          <div key={i} style={{ flex: 1, minWidth: 0 }}>
            {col.map((child, j) => renderElement(child, `${key}-${i}-${j}-${child.type}`))}
          </div>
        ))}
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
    const file = paginationProjects[el.projectIdx]?.files[el.fileIdx];
    if (!file) return null;
    const hl = getHl(file.outlineFileId);
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
    // Functional update — a burst of clicks must each take effect (the
    // previous closure read a stale `zoom`, so rapid clicks only stepped
    // once). Call sites pass ±10.
    setZoom((z) => {
      const base = z === 'fit' ? Math.round(fitScale * 100) : z;
      return Math.min(200, Math.max(30, base + delta));
    });
  };

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      {/* ---------- Toolbar: zoom + page navigation + source caption ---------- */}
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

        {/* §15 — the preview source is explicit: real document vs sample. */}
        <span
          className="ml-auto rounded-full border border-app px-2 py-0.5 text-[10px] text-muted"
          data-preview-source={usingSample ? 'sample' : 'document'}
          title={
            usingSample
              ? 'No files selected yet — showing a built-in sample document. Add or select files to preview your own content.'
              : 'Rendering your currently selected files and custom layout.'
          }
        >
          {usingSample ? 'Preview source: sample (no files yet)' : 'Preview source: your document'}
        </span>

        <span className="ml-2 text-[10px] text-muted">
          {pageW}×{pageH}px · {preset.page.landscape ? 'landscape' : 'portrait'}
        </span>
      </div>

      {/* ---------- Scrollable pages ---------- */}
      <div ref={scrollRef} onScroll={handleScroll} data-preview-scroll className="min-h-0 flex-1 overflow-auto p-4">
        <div ref={containerRef} className="mx-auto flex flex-col items-center gap-6" style={{ width: pageW * scale }}>
          {pages.map((page, idx) => {
            // §4/§9/§10 — shared model: only the title page follows the title
            // alignment; the TOC page follows the TOC alignment; content and
            // project pages always start at the top.
            const justify = pageContentAlignment(
              page.kind,
              preset.titlePage.verticalAlignment,
              preset.toc.verticalAlignment,
            );
            const isCurrent = currentPage === idx + 1;
            return (
              <div key={idx} className="group/page" style={{ width: pageW * scale }}>
                {/* Explicit UNSCALED width: the transform maps this box to
                    exactly the slot width. Without it the wrapper stretches
                    to the slot width and is scaled twice — horizontal
                    overflow at zoom > 100% (spec §6). */}
                <div style={{ width: pageW, transform: `scale(${scale})`, transformOrigin: 'top left', marginBottom: -(pageH - pageH * scale) }}>
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
                    {/* Key includes the element KIND — same rationale as the
                        main preview: index-only keys let one element kind
                        inherit another kind's DOM node across rerenders. */}
                    {page.elements.map((el, i) => renderElement(el, `${idx}-${i}-${el.type}`))}
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

          {!usingSample && allSelected.length > PREVIEW_LIMIT && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                background: '#fef3c7',
                color: '#92400e',
                fontSize: 12,
                borderRadius: 4,
              }}
            >
              Preview limited to {PREVIEW_LIMIT} files. The exported document
              will contain all {allSelected.length} selected files.
            </div>
          )}
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
