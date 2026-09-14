/**
 * PDF exporter using jsPDF.
 *
 * jsPDF is a pure-JavaScript PDF generator that works in the browser. We
 * render code by manually placing colored text runs at calculated positions
 * — this preserves syntax highlighting while keeping the text selectable.
 *
 * Unicode handling: the standard PDF fonts cannot encode the box-drawing
 * glyphs used by project trees (├ └ │ ─). We embed "DejaVu Sans Mono"
 * (served from /fonts) and split every text run at glyph boundaries via
 * splitRuns() — normal characters keep the user's selected font, only the
 * unsupported glyph instances switch to the embedded Unicode font. The
 * original characters are never replaced with ASCII.
 *
 * Page layout: code is laid out inside the configured margins as pre-planned
 * VISUAL ROWS distributed over per-page CHUNKS (see the code-block geometry
 * section). Every chunk draws its own background+border rect sized exactly to
 * the rows it carries, and no row is ever placed past the bottom margin, so
 * split blocks keep their border and never overlap the footer/page number.
 * Headers and footers support the structured single/dual/triple layouts.
 */

import { jsPDF } from 'jspdf';
import type {
  DocumentModel,
  DocumentOptions,
  ExportOptions,
  ExportResult,
  FooterSlotType,
  HighlightedFile,
  HighlightedLine,
} from '@/types';
import type { DocumentExporter } from './types';
import { parseHex, isLightColor } from './colors';
import { getThemeColors } from '@/lib/highlight/highlighter';
import { formatBytes } from '@/lib/fileDiscovery';
import { splitRuns, GLYPH_FALLBACK_FONT } from './unicodeFallback';
import {
  buildStaticTokenContext,
  expandTokens,
  type TokenContext,
} from '@/lib/tokens';

// GLYPH_FALLBACK_FONT is used via the registered GLYPH_FONT_* names.
void GLYPH_FALLBACK_FONT;

/** Page dimensions in points (1pt = 1/72 inch). */
const PAGE_DIMENSIONS_PT: Record<string, [number, number]> = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
  Legal: [612, 1008],
  A3: [841.89, 1190.55],
};

/** mm to pt conversion. */
const MM_TO_PT = 72 / 25.4;

/** Embedded Unicode font registered names. */
const GLYPH_FONT_NORMAL = 'DejaVuSansMono';
const GLYPH_FONT_BOLD = 'DejaVuSansMono-Bold';

/** Module-level cache for the font base64 payloads. */
let glyphFontCache: { normal: string; bold: string } | null = null;

async function fetchFontBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font fetch failed: ${url}`);
  const buf = await res.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Load (and cache) the Unicode fallback fonts. Returns null when unavailable. */
async function loadGlyphFonts(): Promise<{ normal: string; bold: string } | null> {
  if (glyphFontCache) return glyphFontCache;
  try {
    const [normal, bold] = await Promise.all([
      fetchFontBase64('/fonts/DejaVuSansMono.ttf'),
      fetchFontBase64('/fonts/DejaVuSansMono-Bold.ttf'),
    ]);
    glyphFontCache = { normal, bold };
  } catch {
    glyphFontCache = null;
  }
  return glyphFontCache;
}

/**
 * Map a CSS font-family value to the closest jsPDF standard font.
 * The catalog's user-selected families (e.g. "JetBrains Mono") are not
 * built into PDF — we pick the closest standard 14 font by category.
 */
function pdfFontName(fontFamily: string | undefined | null): 'courier' | 'times' | 'helvetica' {
  const f = (fontFamily ?? '').toLowerCase();
  if (f.includes('mono') || f.includes('courier') || f.includes('consolas') || f.includes('menlo') || f.includes('code')) {
    return 'courier';
  }
  if (f.includes('times') || f.includes('georgia') || f.includes('garamond') || f.includes('cambria') || f.includes('serif')) {
    return 'times';
  }
  return 'helvetica';
}

interface PageMeta {
  linesOnPage: number;
  fileName: string | null;
  projectName: string | null;
}

interface LayoutState {
  doc: jsPDF;
  pageW: number;
  pageH: number;
  margin: { top: number; right: number; bottom: number; left: number };
  cursorY: number;
  page: number;
  options: DocumentOptions;
  defaultColor: { r: number; g: number; b: number };
  /** Fallback font availability. */
  glyphFonts: boolean;
  /** Per-page metadata captured while content is laid out. */
  pageMeta: Map<number, PageMeta>;
  currentFileName: string | null;
  currentProjectName: string | null;
  /** Shared header/footer token context (page-independent part). */
  hfCtx: TokenContext;
}

function snapshotPageMeta(state: LayoutState) {
  const existing = state.pageMeta.get(state.page);
  if (existing) {
    existing.fileName = state.currentFileName;
    existing.projectName = state.currentProjectName;
  } else {
    state.pageMeta.set(state.page, {
      linesOnPage: 0,
      fileName: state.currentFileName,
      projectName: state.currentProjectName,
    });
  }
}

function countCodeLine(state: LayoutState) {
  const meta = state.pageMeta.get(state.page) ?? {
    linesOnPage: 0,
    fileName: state.currentFileName,
    projectName: state.currentProjectName,
  };
  meta.linesOnPage += 1;
  state.pageMeta.set(state.page, meta);
}

/** Build the jsPDF document with all content. */
async function buildPdf(model: DocumentModel): Promise<jsPDF> {
  const opts = model.options;
  const [w, h] = PAGE_DIMENSIONS_PT[opts.pageSize] ?? PAGE_DIMENSIONS_PT.A4;
  const orientation = opts.landscape ? 'landscape' : 'portrait';
  const doc = new jsPDF({
    orientation,
    unit: 'pt',
    format: opts.pageSize.toLowerCase(),
  });

  // Embed the Unicode fallback font (used ONLY for box-drawing runs).
  let glyphFonts = false;
  try {
    const fonts = await loadGlyphFonts();
    if (fonts) {
      doc.addFileToVFS('DejaVuSansMono.ttf', fonts.normal);
      doc.addFont('DejaVuSansMono.ttf', GLYPH_FONT_NORMAL, 'normal');
      doc.addFileToVFS('DejaVuSansMono-Bold.ttf', fonts.bold);
      doc.addFont('DejaVuSansMono-Bold.ttf', GLYPH_FONT_BOLD, 'bold');
      glyphFonts = true;
    }
  } catch {
    // Without the embedded font the tree glyphs would not render; we still
    // export (viewer-side fallback may save us) — never ASCII-substitute.
  }

  // Pull theme foreground for the default code color.
  let defaultColor = { r: 36, g: 41, b: 46 };
  try {
    const tc = await getThemeColors(opts.syntaxTheme);
    defaultColor = parseHex(tc.foreground);
  } catch {
    // ignore
  }

  const state: LayoutState = {
    doc,
    pageW: opts.landscape ? h : w,
    pageH: opts.landscape ? w : h,
    margin: {
      top: opts.margins.top * MM_TO_PT,
      right: opts.margins.right * MM_TO_PT,
      bottom: opts.margins.bottom * MM_TO_PT,
      left: opts.margins.left * MM_TO_PT,
    },
    cursorY: opts.margins.top * MM_TO_PT,
    page: 1,
    options: opts,
    defaultColor,
    glyphFonts,
    pageMeta: new Map(),
    currentFileName: null,
    currentProjectName: null,
    hfCtx: {
      ...buildStaticTokenContext({
        metadata: model.metadata,
        firstProjectLabel: model.projects[0]?.label ?? null,
        fileCount: model.projects.reduce((acc, p) => acc + p.files.length, 0),
        now: new Date(model.generatedAt),
      }),
      fileName: model.projects[0]?.files[0]?.relativePath.split('/').pop() ?? '',
    },
  };

  // Front matter
  if (opts.includeFrontMatter) {
    renderFrontMatter(state, model);
    state.doc.addPage();
    state.page += 1;
    state.cursorY = state.margin.top;
  }

  // Table of contents (simple static version)
  if (opts.includeToc) {
    renderToc(state, model);
    state.doc.addPage();
    state.page += 1;
    state.cursorY = state.margin.top;
  }

  // Per-project sections
  let projectN = 0;
  for (const project of model.projects) {
    projectN += 1;
    state.currentProjectName = project.label;
    if (projectN > 1) {
      snapshotPageMeta(state);
      state.doc.addPage();
      state.page += 1;
      state.cursorY = state.margin.top;
    }
    renderHeading1(state, `${projectN}. ${project.label}`);

    if (opts.includeProjectStructure) {
      renderProjectStructure(state, project);
    }

    renderHeading2(state, 'Source Files');

    let fileN = 0;
    for (const file of project.files) {
      fileN += 1;
      state.currentFileName = file.relativePath;
      if (opts.pageBreakBetweenFiles && !(projectN === 1 && fileN === 1)) {
        snapshotPageMeta(state);
        state.doc.addPage();
        state.page += 1;
        state.cursorY = state.margin.top;
      }
      renderHeading3(state, `${projectN}.${fileN}  ${file.relativePath}`);
      if (opts.showFileHeaders) {
        renderFileHeader(state, file, project.label);
      }
      renderCodeBlock(state, file.highlighted);
    }
  }
  snapshotPageMeta(state);

  // Page header / footer
  applyHeaderFooter(state, model);

  return doc;
}

// ---------------------------------------------------------------------------
// Title page (front matter) — rendered as ONE coherent group.
//
// The lines (title, subtitle, author, course, university, then a gap, then
// date/version/description) are collected with their typography FIRST, the
// group's total height is computed, and the group's top Y is derived from the
// configured vertical alignment. Horizontal alignment applies to every line.
// The date/version/description block flows WITH the group (it is no longer
// pinned to pageH - 200). The geometry helpers below are pure and unit-tested
// in pdfLayout.test.ts.
// ---------------------------------------------------------------------------

/** One line of the title-page group with its full typography. */
export interface TitlePageLine {
  text: string;
  font: 'courier' | 'times' | 'helvetica';
  style: 'normal' | 'bold' | 'italic';
  size: number;
  color: [number, number, number];
  /** Baseline advance from the previous line's baseline (ignored on line 0). */
  gapBefore: number;
}

/** Approximate ascent/descent shares of a font size (for group height math). */
const TITLE_ASCENT_FACTOR = 0.8;
const TITLE_DESCENT_FACTOR = 0.2;

export interface TitlePageLinesInput {
  metadata: DocumentModel['metadata'];
  options: DocumentOptions;
  /** Wrap width for the description paragraph (content width). */
  descriptionWidth: number;
  /** Multi-line wrap function (real exporter: jsPDF splitTextToSize). */
  wrapText: (text: string, width: number) => string[];
  /** Used when metadata.date is absent. */
  fallbackDate: string;
}

/**
 * Collect the title-page lines (typography + baseline gaps) in draw order.
 * Pure — no jsPDF instance required.
 */
export function buildTitlePageLines(input: TitlePageLinesInput): TitlePageLine[] {
  const { metadata: md, options, descriptionWidth, wrapText, fallbackDate } = input;
  const lines: TitlePageLine[] = [];
  const headingFont = pdfFontName(options.headingFont);
  const bodyFont = pdfFontName(options.bodyFont);

  // The title is followed by a wide gap; further meta lines follow at the
  // tighter rhythm of the original layout.
  let nextGap = 44;
  const pushMeta = (
    text: string,
    style: 'normal' | 'italic',
    size: number,
    color: [number, number, number],
  ) => {
    lines.push({ text, font: bodyFont, style, size, color, gapBefore: nextGap });
    nextGap = 24;
  };

  const toRgbTuple = (hex: string): [number, number, number] => {
    const c = parseHex(hex);
    return [c.r, c.g, c.b];
  };
  const titleColorRgb: [number, number, number] = options.headingColor
    ? toRgbTuple(options.headingColor)
    : [20, 20, 20];
  const secondaryRgb: [number, number, number] = options.secondaryColor
    ? toRgbTuple(options.secondaryColor)
    : [80, 80, 80];

  lines.push({
    text: md.title ?? 'Project Report',
    font: headingFont,
    style: 'bold',
    size: 32,
    color: titleColorRgb,
    gapBefore: 0,
  });

  if (md.subtitle) pushMeta(md.subtitle, 'italic', 14, secondaryRgb);
  if (md.author) pushMeta(md.author, 'normal', 14, secondaryRgb);
  if (md.course) pushMeta(md.course, 'normal', 14, secondaryRgb);
  if (md.university) pushMeta(md.university, 'normal', 14, secondaryRgb);

  // A visible gap, then date / version / description as part of the group.
  nextGap = Math.max(nextGap, 36);
  pushMeta(md.date || fallbackDate, 'normal', 10, [120, 120, 120]);
  if (md.version) {
    lines.push({
      text: `Version: ${md.version}`,
      font: bodyFont,
      style: 'normal',
      size: 10,
      color: [120, 120, 120],
      gapBefore: 16,
    });
  }
  if (md.description) {
    const wrapped = wrapText(md.description, Math.max(descriptionWidth, 1));
    wrapped.forEach((part, i) => {
      lines.push({
        text: part,
        font: bodyFont,
        style: 'normal',
        size: 11,
        color: [60, 60, 60],
        gapBefore: i === 0 ? (md.version ? 20 : 36) : 11 * 1.2,
      });
    });
  }

  return lines;
}

export interface TitlePageLayoutInput {
  lines: TitlePageLine[];
  margin: { top: number; bottom: number };
  pageH: number;
  vAlign: 'top' | 'center' | 'bottom';
  offset: number;
}

export interface TitlePageLayout {
  /** Visual top of the group. */
  groupTop: number;
  /** Baseline of the first line. */
  firstBaseline: number;
  /** Visual height of the whole group. */
  totalHeight: number;
}

/**
 * Position the title-page group inside the content region according to the
 * vertical alignment: top → margin.top + offset; center → centered (+ half
 * offset nudge); bottom → bottom-aligned minus offset * 0.5. The result is
 * always clamped so the whole group stays within the content region.
 * Pure — no jsPDF instance required.
 */
export function planTitlePageLayout(input: TitlePageLayoutInput): TitlePageLayout {
  const { lines, margin, pageH, vAlign, offset } = input;
  const contentTop = margin.top;
  const contentBottom = pageH - margin.bottom;
  const contentH = contentBottom - contentTop;

  if (lines.length === 0) {
    return { groupTop: contentTop + offset, firstBaseline: contentTop + offset, totalHeight: 0 };
  }

  const firstAscent = lines[0].size * TITLE_ASCENT_FACTOR;
  let lastBaseline = firstAscent;
  for (let i = 1; i < lines.length; i++) lastBaseline += lines[i].gapBefore;
  const totalHeight = lastBaseline + lines[lines.length - 1].size * TITLE_DESCENT_FACTOR;

  let groupTop: number;
  if (vAlign === 'center') {
    // Center/Center must place the group AT the center (spec §9/§29) — the
    // offset is a top-mode nudge and does not skew centering.
    groupTop = contentTop + (contentH - totalHeight) / 2;
  } else if (vAlign === 'bottom') {
    // Bottom = the group's bottom edge sits AT the content-area bottom
    // (spec §17). The offset applies only in top mode.
    groupTop = contentBottom - totalHeight;
  } else {
    groupTop = contentTop + offset;
  }
  groupTop = Math.min(
    Math.max(groupTop, contentTop),
    Math.max(contentBottom - totalHeight, contentTop),
  );

  return { groupTop, firstBaseline: groupTop + firstAscent, totalHeight };
}

function renderFrontMatter(state: LayoutState, model: DocumentModel) {
  const { doc, pageW, pageH, options } = state;

  const hAlign = options.titlePageHorizontalAlignment ?? 'center';
  const vAlign = options.titlePageVerticalAlignment ?? 'top';
  const offset = options.titlePageVerticalOffsetPt ?? 100;

  // splitTextToSize measures with the current font — set the body font first.
  const bodyFont = pdfFontName(options.bodyFont);
  doc.setFont(bodyFont, 'normal');
  doc.setFontSize(11);
  const descriptionWidth = Math.max(pageW - state.margin.left - state.margin.right, 1);

  // 1. Collect the whole group's lines (typography + gaps) first.
  const lines = buildTitlePageLines({
    metadata: model.metadata,
    options,
    descriptionWidth,
    wrapText: (text, width) => doc.splitTextToSize(text, width) as string[],
    fallbackDate: `Generated: ${new Date(model.generatedAt).toLocaleString()}`,
  });

  // 2. Position the group according to the vertical alignment.
  const layout = planTitlePageLayout({ lines, margin: state.margin, pageH, vAlign, offset });

  // 3. Draw each line honoring the horizontal alignment.
  const x =
    hAlign === 'left'
      ? state.margin.left
      : hAlign === 'right'
        ? pageW - state.margin.right
        : pageW / 2;

  let baseline = layout.firstBaseline;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i > 0) baseline += line.gapBefore;
    doc.setFont(line.font, line.style);
    doc.setFontSize(line.size);
    doc.setTextColor(line.color[0], line.color[1], line.color[2]);
    doc.text(line.text, x, baseline, { align: hAlign });
  }
}

function renderToc(state: LayoutState, model: DocumentModel) {
  const { doc, options } = state;

  // spec §4 — the TOC is a page-level CONTENT GROUP with its own
  // horizontal + vertical alignment (independent of text alignment of the
  // individual lines, which the group alignment positions).
  const hAlign = options.tocHorizontalAlignment ?? 'left';
  const pdfAlign: 'left' | 'center' | 'right' = hAlign;
  const xFor = () =>
    hAlign === 'center'
      ? (state.margin.left + state.pageW - state.margin.right) / 2
      : hAlign === 'right'
        ? state.pageW - state.margin.right
        : state.margin.left;

  // Vertical: estimate the block height first, then offset the group inside
  // the usable page area (top / center / bottom) exactly like the title
  // page group.
  const perProject = 52; // label line + spacing
  const perFile = 18;
  const blockH =
    40 +
    model.projects.reduce(
      (acc, p) => acc + perProject + p.files.length * perFile,
      0,
    );
  const contentTop = state.margin.top;
  const contentBottom = state.pageH - state.margin.bottom;
  const vAlign = options.tocVerticalAlignment ?? 'top';
  let startY = contentTop;
  if (vAlign === 'center') {
    startY = contentTop + Math.max(0, (contentBottom - contentTop - blockH) / 2);
  } else if (vAlign === 'bottom') {
    startY = Math.max(contentTop, contentBottom - blockH);
  }
  state.cursorY = startY;

  renderHeading1(state, 'Table of Contents', hAlign);
  const headingColor = options.headingColor ? parseHex(options.headingColor) : { r: 20, g: 20, b: 20 };
  const secondary = options.secondaryColor ? parseHex(options.secondaryColor) : { r: 60, g: 60, b: 60 };
  let n = 1;
  for (const project of model.projects) {
    doc.setFont(pdfFontName(options.headingFont), 'bold');
    doc.setFontSize(13);
    doc.setTextColor(headingColor.r, headingColor.g, headingColor.b);
    ensureSpace(state, 30);
    doc.text(`${n}. ${project.label}`, xFor(), state.cursorY,
      hAlign === 'left' ? undefined : { align: pdfAlign });
    state.cursorY += 22;
    let m = 1;
    doc.setFont(pdfFontName(options.bodyFont), 'normal');
    doc.setFontSize(11);
    doc.setTextColor(secondary.r, secondary.g, secondary.b);
    for (const file of project.files) {
      ensureSpace(state, 18);
      const meta = options.showFileMetadata
        ? `   ${n}.${m}  ${file.relativePath}  ·  ${languageLabel(file.language)} · ${formatBytes(file.sizeBytes)}`
        : `   ${n}.${m}  ${file.relativePath}`;
      doc.text(meta, xFor(), state.cursorY,
        hAlign === 'left' ? undefined : { align: pdfAlign });
      state.cursorY += 16;
      m += 1;
    }
    n += 1;
  }
}

/**
 * Draw a single text run, splitting at box-drawing glyph boundaries so only
 * those instances use the embedded Unicode font. Returns the x position
 * after the full text has been drawn.
 *
 * When `maxWidth` is provided it is the ABSOLUTE right boundary: text is
 * clipped character-by-character so nothing is drawn beyond it (used by
 * no-wrap code mode to clip long lines at the block's right edge).
 */
function drawUnicodeAwareText(
  state: LayoutState,
  text: string,
  x: number,
  y: number,
  baseFont: 'courier' | 'times' | 'helvetica',
  style: 'normal' | 'bold' | 'italic' = 'normal',
  maxWidth?: number,
): number {
  const { doc } = state;
  if (!text) return x;

  const runs = splitRuns(text);
  let cursor = x;
  for (const run of runs) {
    const needsFallback = run.fallback && state.glyphFonts;
    if (needsFallback) {
      doc.setFont(GLYPH_FONT_NORMAL, 'normal');
    } else {
      doc.setFont(baseFont, style);
    }
    let runText = run.text;
    if (maxWidth != null) {
      const available = maxWidth - cursor;
      if (available <= 0) break;
      // Clip the run to the available width.
      while (runText.length > 0 && doc.getTextWidth(runText) > available) {
        runText = runText.slice(0, -1);
      }
      if (runText.length === 0) break;
    }
    doc.text(runText, cursor, y);
    cursor += doc.getTextWidth(runText);
  }
  // Restore the base font so subsequent draws are unaffected.
  doc.setFont(baseFont, style);
  return cursor;
}

function renderProjectStructure(
  state: LayoutState,
  project: DocumentModel['projects'][number],
) {
  renderHeading2(state, `Project Structure: ${project.label}`);
  const { options } = state;

  const root = buildTree(project.structurePaths);
  const lines: string[] = [];
  renderTree(root, '', true, lines);

  const font = pdfFontName(options.codeFont);
  for (const line of lines) {
    ensureSpace(state, options.codeFontSize + 2);
    state.doc.setFontSize(options.codeFontSize - 1);
    state.doc.setTextColor(60, 60, 60);
    drawUnicodeAwareText(state, line, state.margin.left, state.cursorY, font, 'normal');
    state.cursorY += options.codeFontSize + 2;
  }
}

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  isFile: boolean;
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: '', children: new Map(), isFile: false };
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          children: new Map(),
          isFile: isLast,
        });
      }
      node = node.children.get(part)!;
      if (isLast) node.isFile = true;
    }
  }
  return root;
}

function renderTree(
  node: TreeNode,
  prefix: string,
  isRoot: boolean,
  out: string[],
): void {
  const entries = Array.from(node.children.values()).sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isRoot ? '' : isLast ? '└── ' : '├── ';
    const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
    out.push(`${prefix}${connector}${entry.name}`);
    if (!entry.isFile) {
      renderTree(entry, childPrefix, false, out);
    }
  }
}

function renderHeading1(state: LayoutState, text: string, align: 'left' | 'center' | 'right' = 'left') {
  const { doc, options } = state;
  ensureSpace(state, 40);
  if (state.cursorY > state.margin.top + 1) {
    state.cursorY += 12;
  }
  doc.setFont(pdfFontName(options.headingFont), 'bold');
  doc.setFontSize(20);
  // Headings document color drives H1 (spec §5); falls back to the
  // historical near-black when the option is absent (old tests/models).
  const c = options.headingColor ? parseHex(options.headingColor) : { r: 15, g: 23, b: 42 };
  doc.setTextColor(c.r, c.g, c.b);
  const x =
    align === 'center'
      ? (state.margin.left + state.pageW - state.margin.right) / 2
      : align === 'right'
        ? state.pageW - state.margin.right
        : state.margin.left;
  doc.text(text, x, state.cursorY + 20, align === 'left' ? undefined : { align });
  state.cursorY += 32;
}

function renderHeading2(state: LayoutState, text: string) {
  const { doc, options } = state;
  ensureSpace(state, 32);
  state.cursorY += 8;
  doc.setFont(pdfFontName(options.headingFont), 'bold');
  doc.setFontSize(15);
  const c = options.headingColor ? parseHex(options.headingColor) : { r: 15, g: 23, b: 42 };
  doc.setTextColor(c.r, c.g, c.b);
  doc.text(text, state.margin.left, state.cursorY + 16);
  state.cursorY += 24;
}

function renderHeading3(state: LayoutState, text: string) {
  const { doc, options } = state;
  ensureSpace(state, 28);
  state.cursorY += 6;
  doc.setFont(pdfFontName(options.headingFont), 'bold');
  doc.setFontSize(12);
  const c = options.headingColor ? parseHex(options.headingColor) : { r: 30, g: 41, b: 59 };
  doc.setTextColor(c.r, c.g, c.b);
  doc.text(text, state.margin.left, state.cursorY + 14);
  state.cursorY += 22;
}

function renderFileHeader(
  state: LayoutState,
  file: DocumentModel['projects'][number]['files'][number],
  _projectLabel: string,
) {
  const { doc, options } = state;
  ensureSpace(state, 20);
  const font = pdfFontName(options.codeFont);
  doc.setFont(font, options.showFileHeaderBold ? 'bold' : 'normal');
  doc.setFontSize(options.codeFontSize - 1);
  doc.setTextColor(88, 96, 105);

  // File name and relative path are independent outputs (spec §5).
  const name = options.showFileName === false ? null : file.relativePath.split('/').pop() ?? file.relativePath;
  const showPath = options.showRelativePath ?? true;
  const parts: string[] = [];
  if (name) parts.push(name);
  if (showPath && options.showRelativePath !== false) parts.push(file.relativePath);
  if (options.showLanguageLabel !== false) parts.push(languageLabel(file.language));
  if (options.showFileSize !== false) parts.push(formatBytes(file.sizeBytes));
  if (options.showLineCount === true) parts.push(`${file.highlighted.lines.length} lines`);

  const text = parts.join('    ·    ');
  doc.text(text, state.margin.left, state.cursorY + 10);
  // Bottom border
  const lineY = state.cursorY + 14;
  doc.setDrawColor(208, 215, 222);
  doc.setLineWidth(0.5);
  doc.line(state.margin.left, lineY, state.pageW - state.margin.right, lineY);
  state.cursorY += 18;
}

function languageLabel(id: string | null): string {
  if (!id) return 'Plain text';
  const map: Record<string, string> = {
    java: 'Java',
    kotlin: 'Kotlin',
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    python: 'Python',
    go: 'Go',
    rust: 'Rust',
    c: 'C',
    cpp: 'C++',
    csharp: 'C#',
    php: 'PHP',
    ruby: 'Ruby',
    bash: 'Shell',
    shell: 'Shell',
    json: 'JSON',
    yaml: 'YAML',
    toml: 'TOML',
    xml: 'XML',
    html: 'HTML',
    css: 'CSS',
    sql: 'SQL',
    markdown: 'Markdown',
    md: 'Markdown',
    docker: 'Dockerfile',
    makefile: 'Makefile',
    cmake: 'CMake',
    groovy: 'Groovy',
    properties: 'Properties',
    ini: 'INI',
  };
  return map[id] ?? id;
}

/** Apply the configured border dash pattern for the given style. */
function applyBorderStyle(doc: jsPDF, style: 'solid' | 'dotted' | 'dashed' | undefined) {
  if (style === 'dotted') {
    doc.setLineDashPattern([0.6, 1.4], 0);
  } else if (style === 'dashed') {
    doc.setLineDashPattern([3, 2], 0);
  } else {
    doc.setLineDashPattern([], 0);
  }
}

// ---------------------------------------------------------------------------
// Code-block geometry — pure helpers, unit-tested in pdfLayout.test.ts.
//
// The code block is laid out in two pure passes before anything is drawn:
//
//   1. wrapSourceLineToRows / buildCodeRows — each source line becomes one or
//      more VISUAL ROWS (wrap mode splits token text at character granularity
//      to the available code width; no-wrap mode keeps one row per line and
//      clipping happens at draw time).
//   2. planCodeChunks — the rows are distributed over per-page CHUNKS. Every
//      row is page-overflow-checked (a row is only placed when its full
//      baseline area plus the block padding fits above the bottom margin),
//      and each chunk carries the exact rect (background + border) for the
//      rows it holds — so continuation pages get their own border too.
// ---------------------------------------------------------------------------

/** Float epsilon for geometry comparisons. */
const GEOM_EPS = 1e-6;

/** A styled run inside a code row. */
export interface CodeRun {
  text: string;
  /** Token hex color, or null → theme default color. */
  color: string | null;
  bold: boolean;
  italic: boolean;
}

/** One visual row of a code block (a source line, possibly wrapped). */
export interface CodeRow {
  runs: CodeRun[];
  /** Source line number on the FIRST row of a line; null on continuation rows. */
  lineNumber: number | null;
}

export interface CodeWrapOptions {
  /** Wrap long lines at character granularity (false → one row per source line). */
  wrap: boolean;
  /** Available width for code text (block width minus paddings / number column). */
  codeWidth: number;
  /** Text measurer for the code font at the configured code font size. */
  measure: (text: string) => number;
}

function tokenRuns(line: HighlightedLine): CodeRun[] {
  return line.tokens
    .map((tok) => ({
      text: line.text.slice(tok.start, tok.start + tok.length),
      color: tok.color ?? null,
      bold: tok.bold ?? false,
      italic: tok.italic ?? false,
    }))
    .filter((run) => run.text.length > 0);
}

/**
 * Convert one highlighted source line into visual rows.
 *
 * Wrap mode: token text is wrapped at character granularity so every row fits
 * `codeWidth` when measured with the code font. The first row carries the
 * 1-based line number; continuation rows carry lineNumber = null. Every
 * source line yields at least one row (empty lines yield a single empty row).
 * No-wrap mode: exactly one row per source line — tokens are never split.
 * Pure — no jsPDF instance required.
 */
export function wrapSourceLineToRows(line: HighlightedLine, o: CodeWrapOptions): CodeRow[] {
  if (!o.wrap) {
    return [{ lineNumber: line.lineNumber, runs: tokenRuns(line) }];
  }

  const rows: CodeRow[] = [];
  let runs: CodeRun[] = [];
  let width = 0;
  let haveRow = false;

  const flush = () => {
    rows.push({ runs, lineNumber: haveRow ? null : line.lineNumber });
    haveRow = true;
    runs = [];
    width = 0;
  };

  for (const tok of line.tokens) {
    const style = {
      color: tok.color ?? null,
      bold: tok.bold ?? false,
      italic: tok.italic ?? false,
    };
    let rest = line.text.slice(tok.start, tok.start + tok.length);
    while (rest.length > 0) {
      const remaining = o.codeWidth - width;
      const whole = o.measure(rest);
      if (whole <= remaining + GEOM_EPS) {
        // The rest of the token fits on the current row.
        runs.push({ text: rest, ...style });
        width += whole;
        rest = '';
        break;
      }
      // Character-level fit for the overflowing remainder. On an EMPTY row
      // the first char is always taken (even when it alone exceeds the
      // width) so the loop always makes progress; on a row that already has
      // content we flush and retry on a fresh row instead of overflowing.
      const chars = Array.from(rest);
      let fit = 0;
      let fitW = 0;
      for (const ch of chars) {
        const cw = o.measure(ch);
        if (fitW + cw > remaining + GEOM_EPS && (fit > 0 || runs.length > 0)) break;
        fitW += cw;
        fit += 1;
      }
      if (fit === 0) {
        // Nothing fits on the current row → start a fresh row and retry.
        flush();
        continue;
      }
      runs.push({ text: chars.slice(0, fit).join(''), ...style });
      width += fitW;
      rest = chars.slice(fit).join('');
      flush();
    }
  }

  if (runs.length > 0 || !haveRow) flush();
  return rows;
}

/**
 * Build the visual rows for a whole file. Pure — no jsPDF instance required.
 */
export function buildCodeRows(file: HighlightedFile, o: CodeWrapOptions): CodeRow[] {
  const rows: CodeRow[] = [];
  for (const line of file.lines) {
    rows.push(...wrapSourceLineToRows(line, o));
  }
  return rows;
}

export interface CodeChunkInput {
  rowCount: number;
  lineHeight: number;
  codePadding: number;
  margin: { top: number; bottom: number };
  pageH: number;
  /** cursorY on the block's first page (rect top of the first chunk). */
  startCursorY: number;
}

/** A code block piece confined to one page. */
export interface CodeChunk {
  /** Page index relative to the block start (1 = the block's first page). */
  page: number;
  rectTop: number;
  rectHeight: number;
  /** Index of the chunk's first visual row within the global row list. */
  rowStart: number;
  rowCount: number;
  /** Absolute Y of the first row's top on this page. */
  firstRowTop: number;
}

/**
 * Distribute the visual rows over per-page chunks. A row is only placed on a
 * page when its whole baseline area (rowTop + lineHeight) PLUS the block's
 * bottom padding stays above the bottom margin — code can never spill past
 * the content region or overlap the footer. Each chunk's rect spans exactly
 * from (first row top - codePadding) to (last row bottom + codePadding),
 * clamped to the content region, i.e. rectHeight = rows * lineHeight +
 * 2 * codePadding in every non-degenerate case. Pure — no jsPDF instance.
 */
export function planCodeChunks(input: CodeChunkInput): CodeChunk[] {
  const { rowCount, lineHeight, codePadding, margin, pageH, startCursorY } = input;
  const contentTop = margin.top;
  const contentBottom = pageH - margin.bottom;

  // Empty block → keep the padding-only box (matches the historical rect).
  if (rowCount <= 0) {
    const rectBottom = Math.min(startCursorY + codePadding * 2, contentBottom);
    return [
      {
        page: 1,
        rectTop: startCursorY,
        rectHeight: Math.max(rectBottom - startCursorY, 0),
        rowStart: 0,
        rowCount: 0,
        firstRowTop: startCursorY + codePadding,
      },
    ];
  }

  const chunks: CodeChunk[] = [];
  let page = 1;
  let blockTop = Math.max(startCursorY, contentTop);
  let rowsInChunk = 0;
  let rowStart = 0;
  let rowIdx = 0;

  const closeChunk = () => {
    const firstRowTop = blockTop + codePadding;
    const rectTop = Math.max(blockTop, contentTop);
    const rectBottom = Math.min(
      firstRowTop + rowsInChunk * lineHeight + codePadding,
      contentBottom,
    );
    chunks.push({
      page,
      rectTop,
      rectHeight: Math.max(rectBottom - rectTop, 0),
      rowStart,
      rowCount: rowsInChunk,
      firstRowTop,
    });
    rowStart += rowsInChunk;
    rowsInChunk = 0;
  };

  const breakPage = () => {
    page += 1;
    blockTop = contentTop;
  };

  while (rowIdx < rowCount) {
    const rowTop = blockTop + codePadding + rowsInChunk * lineHeight;
    if (rowTop + lineHeight + codePadding <= contentBottom + GEOM_EPS) {
      rowsInChunk += 1;
      rowIdx += 1;
      continue;
    }
    if (rowsInChunk > 0) {
      closeChunk();
      breakPage();
      continue;
    }
    // Not even one row fits on this page.
    if (blockTop > contentTop + GEOM_EPS) {
      // Start the block on a fresh page instead of squeezing in an empty box.
      breakPage();
      continue;
    }
    // Fresh page and still no room → force one row (tiny-page safety).
    rowsInChunk = 1;
    rowIdx += 1;
    closeChunk();
    if (rowIdx < rowCount) breakPage();
  }
  if (rowsInChunk > 0) closeChunk();

  return chunks;
}

function renderCodeBlock(state: LayoutState, file: HighlightedFile) {
  const { doc, options, defaultColor } = state;
  const lineHeight = options.codeFontSize * options.codeLineHeight;
  const blockLeft = state.margin.left;
  const blockRight = state.pageW - state.margin.right;
  const blockWidth = blockRight - blockLeft;
  const codeFont = pdfFontName(options.codeFont);

  // Set the code font BEFORE measuring so widths match the drawn glyphs
  // (courier vs the DejaVu fallback have different metrics; planning with the
  // base font is deterministic).
  doc.setFont(codeFont, 'normal');
  doc.setFontSize(options.codeFontSize);

  // Line-number column width (digits + one trailing space).
  const maxNum = file.lines.length;
  const numWidth = options.showLineNumbers
    ? doc.getTextWidth('0'.repeat(String(maxNum).length + 1))
    : 0;
  const codeWidth = Math.max(blockWidth - options.codePadding * 2 - numWidth, 0);

  // 1. Pre-compute the visual rows (pure, see pdfLayout.test.ts).
  const rows = buildCodeRows(file, {
    wrap: options.wrapLongLines,
    codeWidth,
    measure: (t) => doc.getTextWidth(t),
  });

  // 2. Plan the per-page chunks (pure, see pdfLayout.test.ts).
  const chunks = planCodeChunks({
    rowCount: rows.length,
    lineHeight,
    codePadding: options.codePadding,
    margin: state.margin,
    pageH: state.pageH,
    startCursorY: state.cursorY,
  });

  const codeStartX = blockLeft + options.codePadding;
  const textX = codeStartX + numWidth;
  const maxX = blockRight - options.codePadding;

  // 3. Emit the chunks. Every page gets its own background+border rect sized
  //    exactly to the rows it carries, and every row has been page-overflow
  //    checked by planCodeChunks, so code never overlaps the footer.
  //    chunk.page is RELATIVE to the block start — anchor it ONCE, otherwise
  //    each emitted chunk re-bases on the already-advanced state.page and the
  //    block quadratically spawns blank pages.
  const blockStartPage = state.page;
  for (const chunk of chunks) {
    const targetPage = blockStartPage + chunk.page - 1;
    while (state.page < targetPage) {
      snapshotPageMeta(state);
      state.doc.addPage();
      state.page += 1;
      state.cursorY = state.margin.top;
    }

    if (options.codeBackground) {
      const { r, g, b } = parseHex(options.codeBackground);
      doc.setFillColor(r, g, b);
      doc.rect(blockLeft, chunk.rectTop, blockWidth, chunk.rectHeight, 'F');
    }
    if (options.codeBorderColor) {
      const { r, g, b } = parseHex(options.codeBorderColor);
      doc.setDrawColor(r, g, b);
      doc.setLineWidth(options.codeBorderWidth);
      applyBorderStyle(doc, options.codeBorderStyle);
      doc.rect(blockLeft, chunk.rectTop, blockWidth, chunk.rectHeight);
      applyBorderStyle(doc, 'solid');
    }

    state.cursorY = chunk.firstRowTop;
    for (let i = 0; i < chunk.rowCount; i++) {
      const row = rows[chunk.rowStart + i];
      const lineY = state.cursorY + lineHeight * 0.8;

      // Line number on the FIRST row of each source line only.
      if (options.showLineNumbers && row.lineNumber != null) {
        doc.setTextColor(150, 150, 150);
        doc.setFont(codeFont, 'normal');
        const numStr = String(row.lineNumber);
        doc.text(numStr, textX - doc.getTextWidth(numStr) - 2, lineY);
      }

      // Tokens — each run is split at box-glyph boundaries.
      let x = textX;
      for (const run of row.runs) {
        const color = run.color ? parseHex(run.color) : defaultColor;
        doc.setTextColor(color.r, color.g, color.b);
        const style = run.bold ? 'bold' : run.italic ? 'italic' : 'normal';
        x = drawUnicodeAwareText(
          state,
          run.text,
          x,
          lineY,
          codeFont,
          style,
          options.wrapLongLines ? undefined : maxX,
        );
      }
      doc.setFont(codeFont, 'normal');

      countCodeLine(state);
      state.cursorY += lineHeight;
    }
  }

  state.cursorY += options.codePadding + 4;
}

function ensureSpace(state: LayoutState, needed: number) {
  if (state.cursorY + needed > state.pageH - state.margin.bottom) {
    snapshotPageMeta(state);
    state.doc.addPage();
    state.page += 1;
    state.cursorY = state.margin.top;
  }
}

/** Compute the string value for a footer slot on a given page. */
function footerSlotValue(
  type: FooterSlotType,
  state: LayoutState,
  pageNo: number,
  totalPages: number,
): string {
  const meta = state.pageMeta.get(pageNo);
  switch (type) {
    case 'none':
      return '';
    case 'text':
      return expandPerPage(state.options.pageFooterText ?? '', state.hfCtx, state, pageNo, totalPages);
    case 'pageNumber':
      return String(pageNo);
    case 'pageCount':
      return String(totalPages);
    case 'linesOnPage':
      return `${meta?.linesOnPage ?? 0} lines`;
    case 'fileName':
      return meta?.fileName ?? '';
    case 'projectName':
      return meta?.projectName ?? '';
    case 'date':
      return new Date().toLocaleDateString();
    default:
      return '';
  }
}

/**
 * Expand a header/footer template for a specific page using the shared
 * token engine — identical values to the live preview.
 */
function expandPerPage(
  template: string,
  staticCtx: TokenContext,
  state: LayoutState,
  pageNo: number,
  totalPages: number,
): string {
  const meta = state.pageMeta.get(pageNo);
  return expandTokens(template, {
    ...staticCtx,
    page: pageNo,
    pages: totalPages,
    lines: meta?.linesOnPage ?? 0,
    fileName: meta?.fileName ?? '',
    projectName: meta?.projectName ?? staticCtx.projectName,
  });
}

function applyHeaderFooter(state: LayoutState, model: DocumentModel) {
  const { doc, options, pageW, pageH, margin } = state;
  const totalPages = doc.getNumberOfPages();
  const bodyFont = pdfFontName(options.bodyFont);

  // Shared token context — identical to the DOCX/ODT exporters and preview.
  const staticCtx = state.hfCtx;

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // ---- Header ----
    if (options.pageHeaderShow !== false && (options.pageHeaderLayout || options.pageHeader)) {
      const layout = options.pageHeaderLayout ?? 'single';
      doc.setFont(bodyFont, 'normal');
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      // §10 — spacing-derived header offset; floored at the historical
      // 8pt so every built-in preset renders exactly as before.
      const headerY = margin.top - Math.max(8, (options.headerSpacingMm ?? 0) * 0.8);
      if (layout === 'single') {
        const text = expandPerPage(
          options.pageHeaderCenter ?? options.pageHeader ?? '',
          staticCtx,
          state,
          i,
          totalPages,
        );
        if (text) {
          const align = options.pageHeaderAlign ?? 'right';
          const x = align === 'left' ? margin.left : align === 'center' ? pageW / 2 : pageW - margin.right;
          doc.text(text, x, headerY, { align: align as 'left' | 'center' | 'right' });
        }
      } else if (layout === 'dual') {
        const left = expandPerPage(options.pageHeaderLeft ?? '', staticCtx, state, i, totalPages);
        const right = expandPerPage(options.pageHeaderRight ?? '', staticCtx, state, i, totalPages);
        if (left) doc.text(left, margin.left, headerY);
        if (right) {
          doc.text(right, pageW - margin.right, headerY, { align: 'right' });
        }
      } else {
        const left = expandPerPage(options.pageHeaderLeft ?? '', staticCtx, state, i, totalPages);
        const center = expandPerPage(options.pageHeaderCenter ?? '', staticCtx, state, i, totalPages);
        const right = expandPerPage(options.pageHeaderRight ?? '', staticCtx, state, i, totalPages);
        if (left) doc.text(left, margin.left, headerY);
        if (center) doc.text(center, pageW / 2, headerY, { align: 'center' });
        if (right) doc.text(right, pageW - margin.right, headerY, { align: 'right' });
      }
    }

    // ---- Footer ----
    if (options.pageFooterShow !== false && (options.pageFooterLayout || options.pageFooter)) {
      const layout = options.pageFooterLayout ?? 'single';
      doc.setFont(bodyFont, 'normal');
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      // §10 — spacing-derived footer offset; floored at the historical 12pt.
      const footerY = pageH - margin.bottom + Math.max(12, (options.footerSpacingMm ?? 0) * 1.2);
      if (layout === 'single') {
        const value = options.pageFooterCenter
          ? footerSlotValue(options.pageFooterCenter, state, i, totalPages)
          : expandPerPage(options.pageFooter ?? '', staticCtx, state, i, totalPages);
        if (value) {
          const align = options.pageFooterAlign ?? 'center';
          const x = align === 'left' ? margin.left : align === 'center' ? pageW / 2 : pageW - margin.right;
          doc.text(value, x, footerY, { align: align as 'left' | 'center' | 'right' });
        }
      } else {
        const slots: FooterSlotType[] =
          layout === 'dual'
            ? [options.pageFooterLeft ?? 'none', options.pageFooterRight ?? 'none']
            : [options.pageFooterLeft ?? 'none', options.pageFooterCenter ?? 'none', options.pageFooterRight ?? 'none'];
        const values = slots.map((s) => footerSlotValue(s, state, i, totalPages));
        const [lv, cv, rv] = values;
        if (lv) doc.text(lv, margin.left, footerY);
        if (cv) doc.text(cv, pageW / 2, footerY, { align: 'center' });
        if (rv) doc.text(rv, pageW - margin.right, footerY, { align: 'right' });
      }
    }
  }
}

export const pdfExporter: DocumentExporter = {
  format: 'pdf',
  label: 'PDF Document (.pdf)',
  mimeType: 'application/pdf',
  extension: 'pdf',
  async export(model: DocumentModel, options: ExportOptions): Promise<ExportResult> {
    const start = performance.now();
    const doc = await buildPdf(model);
    const blob = doc.output('blob');
    const elapsed = performance.now() - start;
    return {
      blob,
      filename: `${options.filename || 'codice'}.pdf`,
      format: 'pdf',
      elapsedMs: elapsed,
    };
  },
};

// Keep isLightColor import used (re-exported for downstream color helpers).
export { isLightColor };
