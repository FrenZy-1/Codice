/**
 * PDF cover-page rendering (§42 — PDF extension).
 *
 * The DOCX exporter splices the imported cover's OOXML in verbatim (see
 * coverPages.ts), which is impossible in PDF. This module instead
 * FLOW-RENDERS the cover's captured first-page body XML onto the first
 * page of a jsPDF document — a documented best-effort re-creation:
 *
 * The DOM→paragraph PARSING half of this module (parseCoverBodyDom /
 * parseParagraph and the CoverParagraph model below) is format-agnostic
 * and SHARED: the ODT cover renderer (coverOdt.ts) reuses it to translate
 * the same parsed model into ODF.
 *
 *   Supported (rendered):
 *     - paragraphs (w:p) with alignment (w:jc: left/center/right) and
 *       spacing before/after (w:spacing, twips),
 *     - runs (w:r) with direct character formatting: bold (w:b), italic
 *       (w:i), underline (w:u), font size (w:sz half-points), color
 *       (w:color #RRGGBB) and font family (w:rFonts → closest of the
 *       PDF standard-14 helvetica/times/courier),
 *     - text (w:t, honoring xml:space="preserve"), line breaks (w:br)
 *       and tabs (w:tab, rendered as a four-space gap),
 *     - images: inline drawings (w:drawing → a:blip @r:embed → captured
 *       media bytes → PNG/JPEG placed in their own line box, aligned
 *       with the paragraph's jc; legacy w:pict → v:imagedata too),
 *       sized from wp:extent (EMU → mm),
 *     - tables (w:tbl): linearized — each row becomes one text line
 *       with its cells joined by " | " (layout grids lose their grid,
 *       but the text survives).
 *
 *   Degraded (skipped silently, never thrown at):
 *     - styles (w:pStyle/w:rStyle definitions are not resolved — only
 *       direct formatting counts), numbering/bullets, hyperlinks
 *       (rendered as plain text without link decoration),
 *     - shapes, text boxes, SmartArt, charts (wps:*, v:shape text, …),
 *     - exotic image formats (EMF/WMF/TIFF/GIF/SVG bytes are dropped),
 *     - field codes, footnotes, comments, SDT wrappers.
 *
 *   Layout rules:
 *     - the cover is ONE page by definition: content starts below the
 *       top margin, wraps at the right margin (measured with the real
 *       jsPDF font metrics) and anything past the bottom margin — or
 *       after an explicit page break (w:br type="page") — is DROPPED,
 *     - the caller sizes the page: pdfExporter gives the cover its own
 *       captured geometry when available (coverPageGeometry()), else
 *       the export's geometry.
 *
 * Failure mode: a cover whose body cannot be parsed — or contains
 * nothing renderable — throws; the pdfExporter call site catches that
 * and falls back to an export WITHOUT the cover page (signalled via
 * ExportResult.coverSkipped so the UI can warn).
 */

import { jsPDF } from 'jspdf';
import type { CoverPageAsset } from '@/types';

/* ------------------------------------------------------------------ */
/* Unit conversions (pure, exported for tests)                         */
/* ------------------------------------------------------------------ */

/** Twips (twentieths of a point) → millimetres. */
export function twipsToMm(twips: number): number {
  return (twips / 20) * (25.4 / 72);
}

/** EMU (English Metric Units, 914400 per inch) → millimetres. */
export function emuToMm(emu: number): number {
  return (emu / 914400) * 25.4;
}

/** Word's default body size (half of w:sz val="22"). */
const DEFAULT_SIZE_PT = 11;

/** Default page margins when the cover did not capture any (1 inch). */
const DEFAULT_MARGIN_MM = 25.4;

/** Line leading factor (fraction of the font size per line box). */
const LINE_LEADING = 1.25;

/** Baseline offset within a line box (fraction of the font size). */
const LINE_BASELINE = 0.8;

/** Namespace declarations so prefixed OOXML parses as valid XML. */
const WRAPPER_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml"';

/** Prefixes the wrapper root already declares (never re-declared). */
const WRAPPER_PREFIXES = new Set(['w', 'a', 'wp', 'r', 'v']);

/* ------------------------------------------------------------------ */
/* Geometry resolution                                                 */
/* ------------------------------------------------------------------ */

/** Fully resolved page geometry for rendering a cover (millimetres). */
export interface CoverPageGeometry {
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
}

function finitePositive(v: number | undefined): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * The cover's OWN captured page geometry, when the imported .docx
 * declared one (first w:sectPr — see importCoverDocx). Margins fall
 * back to Word's 1-inch defaults when only the page size was captured.
 * Returns null when no usable page size exists (older assets).
 */
export function coverPageGeometry(cover: CoverPageAsset): CoverPageGeometry | null {
  if (!finitePositive(cover.pageWidthMm) || !finitePositive(cover.pageHeightMm)) return null;
  return {
    widthMm: cover.pageWidthMm as number,
    heightMm: cover.pageHeightMm as number,
    marginTopMm: finitePositive(cover.marginTopMm) ? (cover.marginTopMm as number) : DEFAULT_MARGIN_MM,
    marginRightMm: finitePositive(cover.marginRightMm) ? (cover.marginRightMm as number) : DEFAULT_MARGIN_MM,
    marginBottomMm: finitePositive(cover.marginBottomMm) ? (cover.marginBottomMm as number) : DEFAULT_MARGIN_MM,
    marginLeftMm: finitePositive(cover.marginLeftMm) ? (cover.marginLeftMm as number) : DEFAULT_MARGIN_MM,
  };
}

/* ------------------------------------------------------------------ */
/* Parsed model (pure DOM → paragraphs) — shared with coverOdt.ts      */
/* ------------------------------------------------------------------ */

export interface RunStyle {
  font: 'helvetica' | 'times' | 'courier';
  style: 'normal' | 'bold' | 'italic' | 'bolditalic';
  sizePt: number;
  color: { r: number; g: number; b: number };
  underline: boolean;
}

export interface TextPiece {
  kind: 'text';
  text: string;
  style: RunStyle;
}

export interface ImagePiece {
  kind: 'image';
  dataUrl: string;
  format: 'PNG' | 'JPEG';
  widthMm: number;
  heightMm: number;
}

export interface LineBreakPiece {
  kind: 'break';
}

export interface PageBreakPiece {
  kind: 'pageBreak';
}

export type CoverPiece = TextPiece | ImagePiece | LineBreakPiece | PageBreakPiece;

export interface CoverParagraph {
  align: 'left' | 'center' | 'right';
  spacingBeforePt: number;
  spacingAfterPt: number;
  pieces: CoverPiece[];
}

const DEFAULT_RUN_STYLE: RunStyle = {
  font: 'helvetica',
  style: 'normal',
  sizePt: DEFAULT_SIZE_PT,
  color: { r: 0, g: 0, b: 0 },
  underline: false,
};

/** First DIRECT child element with the given tag name. */
function directChild(el: Element, tag: string): Element | null {
  for (const child of Array.from(el.children)) {
    if (child.tagName === tag) return child;
  }
  return null;
}

/** On/off toggle value — bare element or val="1|true|on" means ON. */
function toggleOn(el: Element | null): boolean {
  if (!el) return false;
  const val = el.getAttribute('w:val');
  if (val == null) return true;
  return ['1', 'true', 'on'].includes(val.trim().toLowerCase());
}

/** Map an OOXML font family to the closest PDF standard-14 font. */
function familyToPdfFont(family: string | null): 'helvetica' | 'times' | 'courier' {
  const f = (family ?? '').toLowerCase();
  if (f.includes('times') || f.includes('serif') || f.includes('georgia') || f.includes('garamond') || f.includes('cambria')) {
    return 'times';
  }
  if (f.includes('mono') || f.includes('courier') || f.includes('consolas') || f.includes('menlo')) {
    return 'courier';
  }
  return 'helvetica';
}

/** Parse #RRGGBB (with or without '#'); null for auto/invalid. */
function parseHexColor(val: string | null): { r: number; g: number; b: number } | null {
  if (!val) return null;
  const v = val.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(v)) return null;
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

/** Parse a run's direct character formatting (w:rPr), best-effort. */
function parseRunStyle(run: Element): RunStyle {
  const rPr = directChild(run, 'w:rPr');
  if (!rPr) return { ...DEFAULT_RUN_STYLE, color: { ...DEFAULT_RUN_STYLE.color } };

  let font: RunStyle['font'] = DEFAULT_RUN_STYLE.font;
  let bold = false;
  let italic = false;
  let underline = false;
  let sizePt = DEFAULT_SIZE_PT;
  let color = { ...DEFAULT_RUN_STYLE.color };

  const rFonts = directChild(rPr, 'w:rFonts');
  if (rFonts) {
    font = familyToPdfFont(
      rFonts.getAttribute('w:ascii') ?? rFonts.getAttribute('w:hAnsi') ?? rFonts.getAttribute('w:cs'),
    );
  }
  if (toggleOn(directChild(rPr, 'w:b'))) bold = true;
  if (toggleOn(directChild(rPr, 'w:i'))) italic = true;
  const u = directChild(rPr, 'w:u');
  if (u) {
    const val = (u.getAttribute('w:val') ?? '').trim().toLowerCase();
    underline = val !== '' && val !== 'none' && val !== '0';
  }
  const sz = directChild(rPr, 'w:sz') ?? directChild(rPr, 'w:szCs');
  if (sz) {
    const halfPoints = Number(sz.getAttribute('w:val'));
    if (Number.isFinite(halfPoints) && halfPoints > 0) sizePt = halfPoints / 2;
  }
  const hex = parseHexColor(directChild(rPr, 'w:color')?.getAttribute('w:val') ?? null);
  if (hex) color = hex;

  return {
    font,
    style: bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal',
    sizePt,
    color,
    underline,
  };
}

/* ----------------------------- images ---------------------------- */

/** Sniff PNG/JPEG magic bytes; anything else is skipped. */
function sniffImage(bytes: Uint8Array): { dataUrl: string; format: 'PNG' | 'JPEG' } | null {
  const isPng =
    bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPng && !isJpeg) return null;
  return { dataUrl: `data:image/${isPng ? 'png' : 'jpeg'};base64,${bytesToBase64(bytes)}`, format: isPng ? 'PNG' : 'JPEG' };
}

/** Base64 of raw bytes (chunked — safe for large images). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Parse "width:123.4pt;height:56.7pt" from a VML shape style attribute. */
function vmlStyleExtent(shape: Element | null): { widthMm: number; heightMm: number } | null {
  const style = shape?.getAttribute('style');
  if (!style) return null;
  const w = /(?:^|;)\s*width\s*:\s*([\d.]+)pt/i.exec(style)?.[1];
  const h = /(?:^|;)\s*height\s*:\s*([\d.]+)pt/i.exec(style)?.[1];
  if (!w || !h) return null;
  const widthMm = (Number(w) / 72) * 25.4;
  const heightMm = (Number(h) / 72) * 25.4;
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) return null;
  return { widthMm, heightMm };
}

/** Fallback image size when no extent is declared (1in × 1in). */
const FALLBACK_IMAGE_MM = 25.4;

/**
 * Collect the image piece(s) of a w:drawing / w:pict element. Skips
 * silently when the drawing has no blip we can resolve (shapes, charts,
 * unsupported formats, external links).
 */
function collectImagePieces(container: Element, cover: CoverPageAsset, pieces: CoverPiece[]): void {
  // DrawingML: extent (EMU) + a:blip @r:embed.
  const blip = container.getElementsByTagName('a:blip')[0] ?? null;
  // Legacy VML: v:imagedata @r:id (+ extent from the v:shape style).
  const vmlData = container.getElementsByTagName('v:imagedata')[0] ?? null;
  if (!blip && !vmlData) return; // shape / text box / chart → skipped

  const relId = blip?.getAttribute('r:embed') ?? vmlData?.getAttribute('r:id');
  if (!relId) return;
  const media = cover.media.find((m) => m.relId === relId);
  if (!media) return; // externally linked image → skipped
  const sniffed = sniffImage(media.bytes);
  if (!sniffed) return; // EMF/WMF/TIFF/GIF/SVG… → skipped

  let widthMm = 0;
  let heightMm = 0;
  const extent = container.getElementsByTagName('wp:extent')[0] ?? null;
  if (extent) {
    widthMm = emuToMm(Number(extent.getAttribute('cx')) || 0);
    heightMm = emuToMm(Number(extent.getAttribute('cy')) || 0);
  } else {
    const vml = vmlStyleExtent(container.getElementsByTagName('v:shape')[0] ?? null);
    if (vml) {
      widthMm = vml.widthMm;
      heightMm = vml.heightMm;
    }
  }
  if (!(widthMm > 0) || !(heightMm > 0)) {
    widthMm = FALLBACK_IMAGE_MM;
    heightMm = FALLBACK_IMAGE_MM;
  }
  pieces.push({ kind: 'image', dataUrl: sniffed.dataUrl, format: sniffed.format, widthMm, heightMm });
}

/* ---------------------------- paragraphs --------------------------- */

/** Walk a paragraph-level container, collecting run-level pieces.
 * Inline wrappers (w:hyperlink, inline SDT content controls) are
 * transparent — their runs render as plain text (no link decoration). */
function collectRunPieces(container: Element, cover: CoverPageAsset, pieces: CoverPiece[]): void {
  for (const child of Array.from(container.children)) {
    if (child.tagName === 'w:r') {
      collectRun(child, cover, pieces);
    } else if (
      child.tagName === 'w:hyperlink' ||
      child.tagName === 'w:sdt' ||
      child.tagName === 'w:sdtContent'
    ) {
      collectRunPieces(child, cover, pieces);
    }
    // Everything else (pPr, bookmarks, proof marks, field codes…) is skipped.
  }
}

/** Collect one run's text/break/tab/image pieces. */
function collectRun(run: Element, cover: CoverPageAsset, pieces: CoverPiece[]): void {
  const style = parseRunStyle(run);
  for (const child of Array.from(run.children)) {
    if (child.tagName === 'w:t') {
      const raw = child.textContent ?? '';
      // Without xml:space="preserve" OOXML strips leading/trailing
      // whitespace of each w:t (Word writes the attribute when the
      // spaces are meaningful).
      const text = child.getAttribute('xml:space') === 'preserve' ? raw : raw.trim();
      if (text !== '') pieces.push({ kind: 'text', text, style });
    } else if (child.tagName === 'w:br') {
      const type = child.getAttribute('w:type');
      pieces.push({ kind: type === 'page' ? 'pageBreak' : 'break' });
    } else if (child.tagName === 'w:tab') {
      pieces.push({ kind: 'text', text: '    ', style });
    } else if (child.tagName === 'w:drawing' || child.tagName === 'w:pict') {
      collectImagePieces(child, cover, pieces);
    }
    // Footnote references, field chars, sym… → skipped.
  }
}

/** Map a w:jc value to a horizontal alignment. */
function jcToAlign(val: string | null): 'left' | 'center' | 'right' {
  if (val === 'center') return 'center';
  if (val === 'right' || val === 'end') return 'right';
  // left/start/both/distribute… → left (justified flow is not supported).
  return 'left';
}

/** Parse one w:p into a renderable paragraph (shared with coverOdt.ts). */
export function parseParagraph(p: Element, cover: CoverPageAsset): CoverParagraph {
  let align: CoverParagraph['align'] = 'left';
  let spacingBeforePt = 0;
  let spacingAfterPt = 0;
  const pPr = directChild(p, 'w:pPr');
  if (pPr) {
    align = jcToAlign(directChild(pPr, 'w:jc')?.getAttribute('w:val') ?? null);
    const spacing = directChild(pPr, 'w:spacing');
    if (spacing) {
      const before = Number(spacing.getAttribute('w:before'));
      const after = Number(spacing.getAttribute('w:after'));
      if (Number.isFinite(before) && before > 0) spacingBeforePt = before / 20;
      if (Number.isFinite(after) && after > 0) spacingAfterPt = after / 20;
    }
  }
  const pieces: CoverPiece[] = [];
  collectRunPieces(p, cover, pieces);
  return { align, spacingBeforePt, spacingAfterPt, pieces };
}

/** Visible text of a paragraph (all runs concatenated). */
function paragraphText(p: Element): string {
  return Array.from(p.getElementsByTagName('w:t'))
    .map((t) => t.textContent ?? '')
    .join('');
}

/**
 * Linearize a w:tbl: each row becomes ONE text line with its cells'
 * paragraph texts joined by " | " (documented best-effort — table grids
 * are layout, only the text survives).
 */
function linearizeTable(tbl: Element): CoverParagraph[] {
  const rows: CoverParagraph[] = [];
  for (const tr of Array.from(tbl.children)) {
    if (tr.tagName !== 'w:tr') continue;
    const cells: string[] = [];
    for (const tc of Array.from(tr.children)) {
      if (tc.tagName !== 'w:tc') continue;
      const text = Array.from(tc.getElementsByTagName('w:p'))
        .map(paragraphText)
        .map((t) => t.trim())
        .filter((t) => t !== '')
        .join(' ');
      cells.push(text);
    }
    const rowText = cells.filter((c) => c !== '').join(' | ');
    if (rowText !== '') {
      rows.push({
        align: 'left',
        spacingBeforePt: 0,
        spacingAfterPt: 3,
        pieces: [{ kind: 'text', text: rowText, style: { ...DEFAULT_RUN_STYLE, color: { ...DEFAULT_RUN_STYLE.color } } }],
      });
    }
  }
  return rows;
}

/**
 * Namespace prefixes used by the cover body but not declared inside it
 * (nor by the wrapper root). Real-world OOXML references a dozen auxiliary
 * namespaces (w14, mc, pic, …) that the wrapping root must declare for the
 * XML to be namespace-well-formed; they are auto-declared with dummy URIs
 * (matching is done on qualified tag names, so the URI is irrelevant). The
 * reserved xml / xmlns prefixes are excluded.
 */
function undeclaredPrefixes(bodyXml: string): string[] {
  const declared = new Set<string>(WRAPPER_PREFIXES);
  for (const m of bodyXml.matchAll(/xmlns:([A-Za-z_][\w.-]*)\s*=/g)) declared.add(m[1]);
  const used = new Set<string>();
  // Element names: <prefix:name …> and </prefix:name>.
  for (const m of bodyXml.matchAll(/<\/?([A-Za-z_][\w.-]*):[A-Za-z_][\w.-]*[\s/>]/g)) used.add(m[1]);
  // Prefixed attribute names (w:val, r:embed, xml:space, …).
  for (const m of bodyXml.matchAll(/\s([A-Za-z_][\w.-]*):[A-Za-z_][\w.-]*\s*=/g)) used.add(m[1]);
  const reserved = new Set(['xml', 'xmlns']);
  const out: string[] = [];
  for (const prefix of used) {
    if (!declared.has(prefix) && !reserved.has(prefix)) out.push(prefix);
  }
  return out;
}

/**
 * Parse the cover's body XML into the namespace-synthesized wrapper DOM
 * root (shared with coverOdt.ts). Throws only when the XML is unparseable
 * (callers fall back to no cover page).
 */
export function parseCoverBodyDom(cover: CoverPageAsset): Element {
  const extraNs = undeclaredPrefixes(cover.bodyXml)
    .map((prefix) => ` xmlns:${prefix}="urn:codice:cover:${prefix}"`)
    .join('');
  const xml = `<w:coverbody ${WRAPPER_NS}${extraNs}>${cover.bodyXml}</w:coverbody>`;
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Cover page body XML could not be parsed.');
  }
  const root = dom.documentElement;
  if (!root) throw new Error('Cover page body XML could not be parsed.');
  return root;
}

/**
 * Parse the cover's body XML into renderable paragraphs. Throws only
 * when the XML is unparseable (caller falls back to no cover page).
 */
function parseCoverBody(cover: CoverPageAsset): CoverParagraph[] {
  const root = parseCoverBodyDom(cover);
  const paragraphs: CoverParagraph[] = [];
  collectBlocks(root, cover, paragraphs);
  return paragraphs;
}

/**
 * Collect block-level paragraphs from a container's children. Block-level
 * SDT wrappers (Word's stock cover pages are built from content controls)
 * are transparent — their content is processed as if inline.
 */
function collectBlocks(parent: Element, cover: CoverPageAsset, out: CoverParagraph[]): void {
  for (const block of Array.from(parent.children)) {
    if (block.tagName === 'w:p') {
      out.push(parseParagraph(block, cover));
    } else if (block.tagName === 'w:tbl') {
      out.push(...linearizeTable(block));
    } else if (block.tagName === 'w:sdt') {
      const content = directChild(block, 'w:sdtContent');
      if (content) collectBlocks(content, cover, out);
    }
    // Unknown block constructs (shapes, text boxes…) are skipped
    // without throwing.
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/** One wrapped word/space token with its resolved style and width. */
interface Token {
  text: string;
  style: RunStyle;
  width: number;
  space: boolean;
}

/** Apply a run's font/size/color to the jsPDF instance. */
function applyFont(pdf: jsPDF, style: RunStyle): void {
  pdf.setFont(style.font, style.style);
  pdf.setFontSize(style.sizePt);
  pdf.setTextColor(style.color.r, style.color.g, style.color.b);
}

/**
 * Flow-render the imported cover page onto the CURRENT (first) page of
 * a jsPDF document (§42 — PDF extension, best effort).
 *
 * `pageOpts` describes the page the caller prepared (pdfExporter uses
 * the cover's own captured geometry when available, else the export's):
 * width/height are required, margins fall back to 1-inch defaults.
 * Works in any jsPDF unit (coordinates are converted via the document
 * scale factor); font sizes are always in points.
 */
export function renderCoverToPdf(
  pdf: jsPDF,
  cover: CoverPageAsset,
  pageOpts: {
    widthMm: number;
    heightMm: number;
    marginTopMm?: number;
    marginRightMm?: number;
    marginBottomMm?: number;
    marginLeftMm?: number;
  },
): void {
  const paragraphs = parseCoverBody(cover);
  if (paragraphs.length === 0) {
    // Nothing renderable was captured — signal an unusable cover so the
    // exporter falls back instead of emitting a blank first page.
    throw new Error('Cover page has no renderable content.');
  }

  // mm/pt → the document's coordinate unit (jsPDF scale factor is
  // points-per-unit: 1 for 'pt', 72/25.4 for 'mm').
  const ptPerUnit = pdf.internal.scaleFactor || 1;
  const mmToUnit = (mm: number) => (mm * (72 / 25.4)) / ptPerUnit;
  const ptToUnit = (pt: number) => pt / ptPerUnit;

  const pageH = mmToUnit(pageOpts.heightMm);
  const mTop = mmToUnit(pageOpts.marginTopMm ?? DEFAULT_MARGIN_MM);
  const mBottom = mmToUnit(pageOpts.marginBottomMm ?? DEFAULT_MARGIN_MM);
  const contentW = mmToUnit(
    pageOpts.widthMm - (pageOpts.marginLeftMm ?? DEFAULT_MARGIN_MM) - (pageOpts.marginRightMm ?? DEFAULT_MARGIN_MM),
  );
  const contentLeft = mmToUnit(pageOpts.marginLeftMm ?? DEFAULT_MARGIN_MM);
  const contentBottom = pageH - mBottom;
  if (contentW <= 0 || contentBottom <= mTop) return; // degenerate page box

  let y = mTop; // top of the next line box
  let stopped = false; // one page only — everything past it is dropped

  const leading = (sizePt: number) => ptToUnit(sizePt * LINE_LEADING);

  /** Split a too-wide word at character level via jsPDF metrics. */
  const charSplit = (token: Token): Token[] => {
    applyFont(pdf, token.style);
    const parts = pdf.splitTextToSize(token.text, contentW) as unknown as string[];
    if (!Array.isArray(parts)) return [token];
    return parts
      .filter((part) => part !== '')
      .map((part) => ({ text: part, style: token.style, width: pdf.getTextWidth(part), space: false }));
  };

  for (const para of paragraphs) {
    if (stopped) break;
    y += ptToUnit(para.spacingBeforePt);

    if (para.pieces.length === 0) {
      // Empty paragraph = one blank line (Word behavior).
      y += leading(DEFAULT_SIZE_PT);
      y += ptToUnit(para.spacingAfterPt);
      continue;
    }

    // Greedy word-wrap across mixed-format runs.
    let line: Token[] = [];
    let lineW = 0;
    let lineMaxSize = DEFAULT_SIZE_PT;
    const dropTrailingSpaces = () => {
      while (line.length > 0 && line[line.length - 1].space) line.pop();
      lineW = line.reduce((acc, t) => acc + t.width, 0);
    };
    const flushLine = () => {
      dropTrailingSpaces();
      if (line.length === 0) return;
      const lineH = leading(lineMaxSize);
      if (y + lineH > contentBottom) {
        stopped = true; // past the one-page boundary → drop the rest
        line = [];
        return;
      }
      const totalW = lineW;
      const x =
        para.align === 'center'
          ? contentLeft + Math.max(0, (contentW - totalW) / 2)
          : para.align === 'right'
            ? contentLeft + Math.max(0, contentW - totalW)
            : contentLeft;
      const baseline = y + ptToUnit(lineMaxSize * LINE_BASELINE);
      let cursor = x;
      for (const token of line) {
        applyFont(pdf, token.style);
        pdf.text(token.text, cursor, baseline);
        if (token.style.underline) {
          // jsPDF has no text-decoration API — draw a matching rule.
          pdf.setDrawColor(token.style.color.r, token.style.color.g, token.style.color.b);
          pdf.setLineWidth(Math.max(ptToUnit(0.3), ptToUnit(token.style.sizePt * 0.04)));
          const uy = baseline + ptToUnit(token.style.sizePt * 0.08);
          pdf.line(cursor, uy, cursor + token.width, uy);
        }
        cursor += token.width;
      }
      y += lineH;
      line = [];
      lineW = 0;
      lineMaxSize = DEFAULT_SIZE_PT;
    };

    const pushToken = (token: Token) => {
      if (token.space) {
        if (line.length === 0) return; // no leading spaces after a wrap
        line.push(token);
        lineW += token.width;
        return;
      }
      // A word wider than the content box is character-split; a single
      // character that still does not fit is placed (overflow tolerated —
      // never an infinite recursion).
      if (token.width > contentW && token.text.length > 1) {
        for (const part of charSplit(token)) pushToken(part);
        return;
      }
      if (lineW + token.width > contentW && line.length > 0) {
        flushLine();
        if (stopped) return;
      }
      line.push(token);
      lineW += token.width;
      lineMaxSize = Math.max(lineMaxSize, token.style.sizePt);
    };

    for (const piece of para.pieces) {
      if (piece.kind === 'text') {
        applyFont(pdf, piece.style);
        // Split into words and whitespace runs (tokens keep their style).
        const parts = piece.text.split(/(\s+)/).filter((s) => s !== '');
        for (const part of parts) {
          if (stopped) break;
          pushToken({ text: part, style: piece.style, width: pdf.getTextWidth(part), space: /^\s+$/.test(part) });
        }
      } else if (piece.kind === 'break') {
        flushLine();
        if (!stopped && line.length === 0) y += leading(DEFAULT_SIZE_PT);
      } else if (piece.kind === 'pageBreak') {
        // Explicit page break: the cover is ONE page — everything after
        // it is dropped.
        flushLine();
        stopped = true;
        break;
      } else {
        // Image: own line box, aligned with the paragraph.
        flushLine();
        if (stopped) break;
        let w = mmToUnit(piece.widthMm);
        let h = mmToUnit(piece.heightMm);
        if (w > contentW && w > 0) {
          const scale = contentW / w;
          w = contentW;
          h *= scale;
        }
        const remaining = contentBottom - y;
        if (h > remaining) {
          if (remaining < ptToUnit(24)) {
            stopped = true; // not enough room left — drop the rest
            break;
          }
          const scale = remaining / h;
          w *= scale;
          h = remaining;
        }
        if (w <= 0 || h <= 0) continue;
        const x =
          para.align === 'center'
            ? contentLeft + Math.max(0, (contentW - w) / 2)
            : para.align === 'right'
              ? contentLeft + Math.max(0, contentW - w)
              : contentLeft;
        pdf.addImage(piece.dataUrl, piece.format, x, y, w, h);
        y += h + ptToUnit(3);
      }
      if (stopped) break;
    }
    if (stopped) break;
    flushLine(); // remainder of the paragraph
    y += ptToUnit(para.spacingAfterPt);
  }
}
