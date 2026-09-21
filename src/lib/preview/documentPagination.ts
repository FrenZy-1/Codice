/**
 * Shared document pagination model — ONE canonical element model + paginator
 * consumed by BOTH the template-settings preview and the main document
 * preview (spec §11/§13: do not maintain two pagination systems).
 *
 * The model is pure (no React): it turns a `DocumentPreset` + a list of
 * projects/files into an ordered element list, then packs that list into
 * pages using the preset's page geometry, density and page-break settings.
 *
 * Page-break settings produce REAL page separation (content moves to the
 * next page) — never divider-only simulation.
 */

import type { DocumentPreset, FontWeight } from '@/lib/presets/documentPreset';
import type { DocumentImage, FileDetails } from '@/types';

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

export const PAGE_DIMENSIONS_PX: Record<string, [number, number]> = {
  A4: [794, 1123],
  Letter: [816, 1056],
  Legal: [816, 1344],
  A3: [1123, 1587],
};

export const MM_TO_PX = 3.78; // 96 dpi
export const PT_TO_PX = 4 / 3; // 96 dpi

export function pageBoxPx(preset: DocumentPreset): { pageW: number; pageH: number } {
  const [baseW, baseH] = PAGE_DIMENSIONS_PX[preset.page.size] ?? PAGE_DIMENSIONS_PX.A4;
  return {
    pageW: preset.page.landscape ? baseH : baseW,
    pageH: preset.page.landscape ? baseW : baseH,
  };
}

/* ------------------------------------------------------------------ */
/* Input model                                                         */
/* ------------------------------------------------------------------ */

export interface PaginationFile {
  /** Bare file name ("Main.kt"). */
  name: string;
  /** Relative path ("src/main/kotlin/Main.kt"). */
  path: string;
  language: string;
  size: number;
  /** Outline anchor id for the file block (main preview: outline-file-<fileId>). */
  outlineFileId?: string;
  /**
   * Raw source text — used ONLY as a fallback line count while syntax
   * highlighting loads. May be empty.
   */
  code?: string;
  /** User-defined per-file details (spec §6/§9). */
  details?: FileDetails;
  /** Images attached to this file, in attachment order (spec §10/§12). */
  images?: DocumentImage[];
}

export interface PaginationProject {
  label: string;
  path: string;
  /** Paths that make up the project-structure tree. */
  structure: string[];
  files: PaginationFile[];
  /** Stable outline anchor id segment (main preview: the project entry id). */
  outlineProjectId?: string;
}

export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4';

/**
 * §12/§46 — presentation overrides carried from the canonical resolved
 * stream (custom-layout text blocks) onto preview elements. Every field is
 * optional: undefined means "use the preset style for this element".
 */
export interface PreviewTextProps {
  align?: 'left' | 'center' | 'right';
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

export type PreviewElement =
  | { type: 'titlePage'; outlineId?: string }
  | { type: 'toc'; outlineId?: string }
  | { type: 'projectHeader'; projectIdx: number; outlineId?: string }
  | { type: 'structure'; projectIdx: number; outlineId?: string }
  | {
      type: 'heading';
      level: HeadingLevel;
      text: string;
      numberPrefix: string;
      breakBefore: boolean;
      outlineId?: string;
      /** Presentation overrides on top of the preset heading style (§46). */
      align?: 'left' | 'center' | 'right';
      fontSizePt?: number;
      bold?: boolean;
      italic?: boolean;
      color?: string;
    }
  | {
      type: 'paragraph';
      text: string;
      rich?: ParagraphRichRun[];
      /** Presentation overrides on top of the preset body style (§46). */
      align?: 'left' | 'center' | 'right';
      fontSizePt?: number;
      bold?: boolean;
      italic?: boolean;
      color?: string;
    }
  | { type: 'statusCard' }
  | { type: 'fileHeader'; projectIdx: number; fileIdx: number; outlineId?: string }
  | {
      /** A labeled detail paragraph — file details or custom-layout labels (§6). */
      type: 'fileDetail';
      projectIdx?: number;
      fileIdx?: number;
      label: string;
      text: string;
      /** Presentation overrides on top of the preset body style (§46). */
      align?: 'left' | 'center' | 'right';
      fontSizePt?: number;
      bold?: boolean;
      italic?: boolean;
      color?: string;
    }
  | {
      /** An attached image (embedded data URL — never a temp URL, §12). */
      type: 'image';
      projectIdx?: number;
      fileIdx?: number;
      imageIdx?: number;
      /** Standalone image (custom layout) — takes precedence when set. */
      image?: DocumentImage;
      /** §39 — outline anchor for standalone layout images. */
      outlineId?: string;
    }
  | { type: 'pageBreak' }
  | {
      /** A visual container (§26) — children render inside the box. */
      type: 'panel';
      fillColor?: string | null;
      borderColor?: string | null;
      borderWidthPt?: number;
      radiusPt?: number;
      paddingPt?: number;
      /** Explicit box height (pt) for EMPTY panels — filled boxes/dividers. */
      heightPt?: number;
      /** §25 — default text color for the panel's content. */
      textColor?: string;
      /** §39 — outline anchor (panels are navigable landmarks). */
      outlineId?: string;
      children: PreviewElement[];
    }
  | {
      /** A horizontal rule (§6): a filled bar separating content areas. */
      type: 'divider';
      heightPx: number;
      fillColor?: string;
      /** §39 — outline anchor (dividers are navigable landmarks). */
      outlineId?: string;
    }
  | {
      /** Side-by-side regions (§25) — HTML preview renders them truly side by side. */
      type: 'columns';
      count: 2 | 3;
      /** §39 — outline anchor (columns are panel-family landmarks). */
      outlineId?: string;
      columns: PreviewElement[][];
    }
  | {
      type: 'code';
      projectIdx: number;
      fileIdx: number;
      fromLine: number;
      toLine: number;
      startLineNumber: number;
      breakBefore?: boolean;
      outlineId?: string;
    }
  | { type: 'spacer'; height: number };

/** A body-paragraph fragment with its own color semantics (links etc.). */
export interface ParagraphRichRun {
  text: string;
  colorRole?: 'link' | 'success' | 'warning' | 'error';
}

export interface PreviewPage {
  elements: PreviewElement[];
  kind: 'title' | 'toc' | 'project-intro' | 'content';
  linesOnPage: number;
  fileName: string | null;
  projectName: string | null;
}

/** Approximate the number of wrapped display lines for a code line. */
export function wrappedLineCount(text: string, charsPerLine: number): number {
  if (text.length === 0) return 1;
  if (!Number.isFinite(charsPerLine) || charsPerLine <= 0) return 1;
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

function headingNumberPrefix(
  preset: DocumentPreset,
  level: HeadingLevel,
  p: number,
  f: number,
  s: number,
): string {
  if (!preset.misc.numberHeadings) return '';
  const h = preset.headings[level];
  if (!h.numbered) return '';
  if (level === 'h1') return `${p}. `;
  if (level === 'h2') return `${p}.${f} `;
  if (level === 'h3') return `${p}.${f}.${s} `;
  return `${p}.${f}.${s}.1 `;
}

/* ------------------------------------------------------------------ */
/* Element builder                                                     */
/* ------------------------------------------------------------------ */

export interface BuildElementsOptions {
  /**
   * Extra content appended after the FIRST project's files — used by the
   * template preview to exercise H3/H4 + links + status colors. The main
   * preview passes no extras (it renders real user content only).
   */
  includeNotesBlock?: boolean;
}

/**
 * Build the ordered element list that mirrors the exported document:
 * title page → TOC → per project (header → structure → files).
 */
export function buildDocumentElements(
  preset: DocumentPreset,
  projects: PaginationProject[],
  opts: BuildElementsOptions = {},
): PreviewElement[] {
  const els: PreviewElement[] = [];

  if (preset.titlePage.enabled) {
    els.push({ type: 'titlePage', outlineId: 'outline-title' });
  }

  if (preset.misc.includeToc) {
    els.push({ type: 'toc', outlineId: 'outline-toc' });
  }

  projects.forEach((project, p) => {
    const pid = project.outlineProjectId ?? String(p);
    els.push({ type: 'projectHeader', projectIdx: p, outlineId: `outline-project-${pid}` });
    if (preset.projectStructure.enabled) {
      els.push({ type: 'structure', projectIdx: p, outlineId: `outline-structure-${pid}` });
    }
    els.push({
      type: 'heading',
      level: 'h1',
      text: 'Source Files',
      numberPrefix: headingNumberPrefix(preset, 'h1', p + 1, 0, 0),
      breakBefore: p > 0 && (preset.pageBreaks.beforeProject || preset.pageBreaks.beforeH1),
      outlineId: `outline-files-${pid}`,
    });

    project.files.forEach((file, f) => {
      els.push({
        type: 'heading',
        level: 'h2',
        text: file.name,
        numberPrefix: headingNumberPrefix(preset, 'h2', p + 1, f + 1, 0),
        breakBefore: preset.pageBreaks.beforeFile && !(p === 0 && f === 0),
        outlineId: file.outlineFileId ? `outline-file-${file.outlineFileId}` : undefined,
      });
      els.push({ type: 'fileHeader', projectIdx: p, fileIdx: f });
      // §6 — semantic detail placement: Description BEFORE the code block.
      if (file.details?.description?.trim()) {
        els.push({
          type: 'fileDetail',
          projectIdx: p,
          fileIdx: f,
          label: 'Description',
          text: file.details.description,
        });
      }
      els.push({
        type: 'code',
        projectIdx: p,
        fileIdx: f,
        fromLine: 0,
        toLine: Number.MAX_SAFE_INTEGER,
        startLineNumber: 1,
      });
      // §10 — attached images after the code block.
      (file.images ?? []).forEach((_img, imgIdx) => {
        els.push({ type: 'image', projectIdx: p, fileIdx: f, imageIdx: imgIdx });
      });
      // §6 — Summary and Note AFTER the code block.
      if (file.details?.summary?.trim()) {
        els.push({
          type: 'fileDetail',
          projectIdx: p,
          fileIdx: f,
          label: 'Summary',
          text: file.details.summary,
        });
      }
      if (file.details?.note?.trim()) {
        els.push({
          type: 'fileDetail',
          projectIdx: p,
          fileIdx: f,
          label: 'Note',
          text: file.details.note,
        });
      }
    });

    if (p === 0 && opts.includeNotesBlock) {
      els.push({
        type: 'heading',
        level: 'h3',
        text: 'Notes',
        numberPrefix: headingNumberPrefix(preset, 'h3', 1, 1, 1),
        breakBefore: false,
      });
      els.push({
        type: 'paragraph',
        text: 'Heading styles (H1 through H4) are configured per level under Fonts Settings → Headings. This paragraph demonstrates the body typography: font family, size, weight, color, line spacing, and paragraph spacing.',
      });
      els.push({
        type: 'paragraph',
        text: 'Reference material lives in docs/getting-started.md — links are tinted with the Links document color so they are easy to spot in print.',
        rich: [
          { text: 'Reference material lives in ' },
          { text: 'docs/getting-started.md', colorRole: 'link' },
          { text: ' — links are tinted with the Links document color so they are easy to spot in print.' },
        ],
      });
      els.push({
        type: 'heading',
        level: 'h4',
        text: 'Implementation Notes',
        numberPrefix: headingNumberPrefix(preset, 'h4', 1, 1, 1),
        breakBefore: preset.headings.h4.pageBreakBefore,
      });
      els.push({
        type: 'paragraph',
        text: 'Document density settings (paragraph spacing, section spacing, code spacing) control the vertical rhythm of this page. Page-break rules decide where each section begins — enable “Page break before each file” to push every file onto its own page.',
      });
      // Semantic color showcase: Success / Warning / Error on a Surface card
      // with a Borders border — each Document Color has a coherent target.
      els.push({ type: 'statusCard' });
    }
  });

  return els;
}

/* ------------------------------------------------------------------ */
/* Paginator                                                           */
/* ------------------------------------------------------------------ */

export interface PaginateAccessors {
  /** Current highlighted line count for a file (fallback: file.code lines). */
  getLineCount: (file: PaginationFile) => number;
  /** Raw text of one highlighted line (for wrap estimation). */
  getLineText: (file: PaginationFile, lineIdx: number) => string;
}

export function paginateDocument(
  elements: PreviewElement[],
  preset: DocumentPreset,
  projects: PaginationProject[],
  accessors: PaginateAccessors,
): PreviewPage[] {
  const { pageW, pageH } = pageBoxPx(preset);

  const marginTop = preset.page.marginTopMm * MM_TO_PX;
  const marginBottom = preset.page.marginBottomMm * MM_TO_PX;
  const marginLeft = preset.page.marginLeftMm * MM_TO_PX;
  const marginRight = preset.page.marginRightMm * MM_TO_PX;

  const headerReserve = preset.page.pageHeaderShow ? Math.max(24, preset.page.headerSpacingMm * MM_TO_PX) : 0;
  const footerReserve = preset.page.pageFooterShow ? Math.max(24, preset.page.footerSpacingMm * MM_TO_PX) : 0;

  const contentH = Math.max(
    120,
    pageH - marginTop - marginBottom - headerReserve - footerReserve,
  );
  const contentW = Math.max(120, pageW - marginLeft - marginRight);

  // Code metrics for estimation.
  const codeFontSizePx = preset.code.fontSizePt * PT_TO_PX;
  const codeLineHeightPx = codeFontSizePx * preset.code.lineHeight;
  const charW = codeFontSizePx * 0.6; // monospace approximation
  const charsPerLine = Math.max(8, Math.floor((contentW - preset.code.paddingPt * 2) / charW));

  const bodyFontSizePx = preset.typography.bodyFontSizePt * PT_TO_PX;
  const bodyCharsPerLine = Math.max(8, Math.floor(contentW / (bodyFontSizePx * 0.5)));

  const pages: PreviewPage[] = [];
  let current: PreviewPage = {
    elements: [],
    kind: 'content',
    linesOnPage: 0,
    fileName: null,
    projectName: null,
  };
  let used = 0;

  const flush = () => {
    if (current.elements.length > 0) {
      pages.push(current);
    }
    current = { elements: [], kind: 'content', linesOnPage: 0, fileName: null, projectName: null };
    used = 0;
  };

  const push = (el: PreviewElement, height: number, kind?: PreviewPage['kind']) => {
    current.elements.push(el);
    used += height;
    if (kind) current.kind = kind;
  };

  const fileAt = (el: { projectIdx?: number; fileIdx?: number }): PaginationFile | undefined =>
    el.projectIdx !== undefined && el.fileIdx !== undefined
      ? projects[el.projectIdx]?.files[el.fileIdx]
      : undefined;

  /**
   * Approximate height of one element WITHOUT pagination state — used for
   * container children (panel/columns) whose content is measured as a whole.
   */
  const estimateHeight = (el: PreviewElement): number => {
    switch (el.type) {
      case 'paragraph':
      case 'fileDetail': {
        const lines = Math.max(1, Math.ceil(el.text.length / bodyCharsPerLine));
        return (
          (el.type === 'fileDetail' ? 14 : 0) +
          lines * bodyFontSizePx * preset.typography.lineSpacing +
          preset.typography.paragraphSpacingPt
        );
      }
      case 'image': {
        const img =
          el.image ??
          (el.projectIdx !== undefined && el.fileIdx !== undefined
            ? projects[el.projectIdx]?.files[el.fileIdx]?.images?.[el.imageIdx ?? 0]
            : undefined);
        const maxW = contentW * 0.62;
        const maxH = contentH * 0.55;
        let drawH = 120;
        if (img && img.width > 0 && img.height > 0) {
          drawH =
            img.height * Math.min(maxW / img.width, maxH / img.height, 1);
        }
        return drawH + (img?.caption ? 18 : 0) + 12;
      }
      case 'spacer':
        return el.height;
      case 'divider':
        return el.heightPx;
      case 'heading': {
        const h = preset.headings[el.level];
        return h.sizePt * h.lineHeight * PT_TO_PX + h.spaceBeforePt + h.spaceAfterPt;
      }
      case 'panel': {
        const pad = (el.paddingPt ?? 6) * PT_TO_PX * 2;
        if (el.children.length === 0 && el.heightPt) {
          return Math.max(el.heightPt * PT_TO_PX, pad);
        }
        return pad + el.children.reduce((acc, c) => acc + estimateHeight(c), 0);
      }
      case 'columns': {
        const heights = el.columns.map((col) =>
          col.reduce((acc, c) => acc + estimateHeight(c), 0),
        );
        return Math.max(40, ...heights);
      }
      default:
        return 0;
    }
  };

  for (const el of elements) {
    // Explicit page breaks — content actually moves to a new page.
    let explicitBreak = false;
    if (el.type === 'heading') {
      explicitBreak = el.breakBefore || preset.headings[el.level].pageBreakBefore || (el.level === 'h1' && preset.pageBreaks.beforeH1);
    } else if (el.type === 'code' && el.breakBefore) {
      explicitBreak = true;
    }

    if (explicitBreak && current.elements.length > 0) flush();

    switch (el.type) {
      case 'titlePage': {
        const height = 380 + preset.titlePage.verticalOffsetPt * PT_TO_PX;
        if (current.elements.length > 0) flush();
        push(el, height, 'title');
        if (preset.pageBreaks.afterTitlePage) flush();
        break;
      }
      case 'toc': {
        if (current.elements.length > 0) flush();
        push(el, 320, 'toc');
        break;
      }
      case 'projectHeader': {
        if (current.elements.length > 0) flush();
        push(el, 90, 'project-intro');
        break;
      }
      case 'structure': {
        const project = projects[el.projectIdx];
        const lines = project?.structure.length ?? 0;
        const height =
          34 + lines * preset.projectStructure.fontSizePt * preset.projectStructure.lineHeight * PT_TO_PX;
        if (used + height > contentH && current.elements.length > 0) flush();
        push(el, height);
        break;
      }
      case 'heading': {
        const h = preset.headings[el.level];
        const height = h.sizePt * h.lineHeight * PT_TO_PX + h.spaceBeforePt + h.spaceAfterPt;
        if (used + height > contentH && current.elements.length > 0) flush();
        push(el, height);
        break;
      }
      case 'paragraph': {
        const lines = Math.max(1, Math.ceil(el.text.length / bodyCharsPerLine));
        const height =
          lines * bodyFontSizePx * preset.typography.lineSpacing + preset.typography.paragraphSpacingPt;
        if (used + height > contentH && current.elements.length > 0) flush();
        push(el, height);
        break;
      }
      case 'statusCard': {
        const height = 118;
        if (used + height > contentH && current.elements.length > 0) flush();
        push(el, height);
        break;
      }
      case 'fileHeader': {
        const file = fileAt(el);
        if (file) {
          current.fileName = file.name;
          current.projectName = projects[el.projectIdx]?.label ?? null;
        }
        const rows =
          1 +
          (preset.fileHeaders.showRelativePath ? 1 : 0) +
          (preset.fileHeaders.showLanguageLabel || preset.fileHeaders.showFileSize || preset.fileHeaders.showLineCount ? 1 : 0);
        const height = rows * (preset.fileHeaders.fontSizePt * PT_TO_PX + 4) + preset.fileHeaders.spacingAfterPt + 8;
        if (used + height > contentH && current.elements.length > 0) flush();
        push(el, height);
        break;
      }
      case 'fileDetail': {
        // §6 — labeled detail paragraph (Description/Summary/Note/custom).
        const file = fileAt(el);
        if (file) {
          current.fileName = file.name;
          current.projectName = projects[el.projectIdx ?? 0]?.label ?? null;
        }
        const lines = Math.max(1, Math.ceil(el.text.length / bodyCharsPerLine));
        const height =
          14 +
          lines * bodyFontSizePx * preset.typography.lineSpacing +
          preset.typography.paragraphSpacingPt;
        if (used + height > contentH && current.elements.length > 0) flush();
        push(el, height);
        break;
      }
      case 'pageBreak': {
        // §19 — explicit page break element (custom layouts).
        flush();
        break;
      }
      case 'image': {
        // §12 — images respect page boundaries and never overflow the page:
        // they are aspect-fit into a box of 62% content width / 55% height.
        const file = fileAt(el);
        const img =
          el.image ??
          file?.images?.[el.imageIdx ?? 0];
        if (file) {
          current.fileName = file.name;
          current.projectName = projects[el.projectIdx ?? 0]?.label ?? null;
        }
        const maxW = contentW * 0.62;
        const maxH = contentH * 0.55;
        let drawH = 120;
        if (img && img.width > 0 && img.height > 0) {
          const scale = Math.min(maxW / img.width, maxH / img.height, 1);
          drawH = img.height * scale;
        }
        const height = drawH + (img?.caption ? 18 : 0) + 12;
        if (used + height > contentH && current.elements.length > 0) flush();
        push(el, height);
        break;
      }
      case 'panel': {
        // §26 — container measured as a whole; moved to its own page if it
        // does not fit (its content is capped by construction).
        const height = estimateHeight(el);
        if (used + height > contentH && current.elements.length > 0) flush();
        push(el, height);
        break;
      }
      case 'columns': {
        const height = estimateHeight(el);
        if (used + height > contentH && current.elements.length > 0) flush();
        push(el, height);
        break;
      }
      case 'code': {
        const file = fileAt(el);
        if (file) {
          current.fileName = file.name;
          current.projectName = projects[el.projectIdx]?.label ?? null;
        }
        const totalLines = file ? accessors.getLineCount(file) : 0;
        const start = el.fromLine;
        const end = Math.min(totalLines, el.toLine);

        let idx = start;
        while (idx < end) {
          const remaining = contentH - used - preset.code.paddingPt * 2;
          const fitLines = Math.max(1, Math.floor(remaining / codeLineHeightPx));

          // Compute wrapped lines per source line to know real consumption.
          let consume = 0;
          let lastFittingSourceLine = idx;
          for (let li = idx; li < end; li++) {
            const text = accessors.getLineText(file as PaginationFile, li);
            const w = preset.code.wrapLongLines ? wrappedLineCount(text, charsPerLine) : 1;
            if (consume + w > fitLines && li > idx) break;
            consume += w;
            lastFittingSourceLine = li + 1;
          }

          const chunkHeight = consume * codeLineHeightPx + preset.code.paddingPt * 2;
          const isFirstChunk = idx === start;

          if (!isFirstChunk || chunkHeight > contentH - used) {
            if (used > 0) {
              flush();
              continue;
            }
          }

          push(
            {
              type: 'code',
              projectIdx: el.projectIdx,
              fileIdx: el.fileIdx,
              fromLine: idx,
              toLine: lastFittingSourceLine,
              startLineNumber: idx + 1,
              ...(el.outlineId ? { outlineId: el.outlineId } : {}),
            },
            chunkHeight,
          );
          current.linesOnPage += lastFittingSourceLine - idx;
          idx = lastFittingSourceLine;
          if (idx < end) {
            flush();
          }
        }
        break;
      }
      case 'spacer': {
        if (used + el.height > contentH) flush();
        push(el, el.height);
        break;
      }
      case 'divider': {
        // §6 — horizontal rule: a small filled bar; never splits across pages.
        if (used + el.heightPx > contentH && current.elements.length > 0) flush();
        push(el, el.heightPx);
        break;
      }
      default:
        break;
    }
  }
  flush();
  return pages.length > 0 ? pages : [{ elements: [], kind: 'content', linesOnPage: 0, fileName: null, projectName: null }];
}

/** FontWeight map shared by both preview renderers. */
export const WEIGHT_MAP: Record<FontWeight, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

/**
 * Vertical flex justification for ONE preview page (spec §4/§9/§10):
 *   - title pages follow the title page's vertical alignment;
 *   - TOC pages follow the TOC's own vertical alignment (spec §4);
 *   - content and project-intro pages ALWAYS start at the top of the usable
 *     area — a page break resets normal flow and the title/TOC alignment
 *     must never leak into a new project's page (spec §10).
 */
export function pageContentAlignment(
  kind: PreviewPage['kind'],
  titleVertical: 'top' | 'center' | 'bottom',
  tocVertical: 'top' | 'center' | 'bottom',
): 'flex-start' | 'center' | 'flex-end' {
  const toJustify = (v: 'top' | 'center' | 'bottom') =>
    v === 'center' ? 'center' : v === 'bottom' ? 'flex-end' : 'flex-start';
  if (kind === 'title') return toJustify(titleVertical);
  if (kind === 'toc') return toJustify(tocVertical);
  return 'flex-start';
}
