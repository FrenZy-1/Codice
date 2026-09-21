/**
 * ODT cover-page rendering (§42 — ODT extension).
 *
 * The DOCX exporter splices the imported cover's OOXML in verbatim
 * (coverPages.ts) and the PDF exporter flow-renders it (coverPdf.ts); ODT's
 * flat XML content model gets the same flow-render treatment here: the
 * cover's captured first-page body XML is translated into a sequence of ODF
 * <text:p> / <table:table> elements plus the automatic styles they
 * reference, ready to be woven into the START of content.xml's
 * <office:text> by the odtExporter. The parsing model is SHARED with
 * coverPdf.ts (parseCoverBodyDom / parseParagraph), so both flow renderers
 * see exactly the same paragraphs, runs and images.
 *
 *   Supported (rendered):
 *     - paragraphs (w:p) with alignment (w:jc → fo:text-align) and spacing
 *       before/after (w:spacing twips → fo:margin-top/bottom cm),
 *     - runs (w:r) with direct character formatting: bold, italic,
 *       underline (w:u), font size (w:sz half-points → fo:font-size pt) and
 *       color (w:color → fo:color "#rrggbb"); the PDF font buckets map to
 *       the real family names Helvetica / Times New Roman / Courier New,
 *     - text (w:t, honoring xml:space="preserve") with ODF whitespace
 *       preservation (<text:s text:c="N"/> / <text:tab/> — the same
 *       encoding the code lines use), line breaks (w:br →
 *       <text:line-break/>) and tabs,
 *     - images: inline drawings (w:drawing → a:blip @r:embed → captured
 *       media bytes → <draw:frame text:anchor-type="as-char"> sized from
 *       wp:extent EMU → svg:width/height cm; legacy w:pict → v:imagedata
 *       too). PNG/JPEG only. Each frame carries an xlink:href Pictures/
 *       reference (the odtExporter adds the ZIP entry + manifest entry)
 *       AND an embedded <office:binary-data> copy of the same bytes,
 *     - tables (w:tbl): real <table:table> structures — one row per w:tr,
 *       one cell per w:tc, each cell's paragraphs rendered with full run
 *       formatting (grids lose their borders/widths, text survives).
 *
 *   Degraded (skipped silently, never thrown at):
 *     - styles (w:pStyle/w:rStyle definitions are not resolved — only
 *       direct formatting counts), numbering/bullets, hyperlinks (rendered
 *       as plain text without link decoration),
 *     - shapes, text boxes, SmartArt, charts (wps:*, v:shape text, …),
 *     - exotic image formats (EMF/WMF/TIFF/GIF/SVG bytes are dropped),
 *     - nested tables (a table inside a table cell is dropped),
 *     - field codes, footnotes, comments, SDT wrappers are transparent
 *       (their content renders).
 *
 *   Layout rules:
 *     - the cover is ONE page by definition: an explicit page break
 *       (w:br type="page") STOPS the translation — everything after it is
 *       dropped (same semantic as the PDF renderer; the importer normally
 *       already cut the XML there, this guards repaired bodies). Unlike
 *       the PDF flow renderer there is no bottom-margin overflow cutoff:
 *       ODT is a reflow format, the consumer paginates,
 *     - the odtExporter appends a hard page-break carrier paragraph after
 *       the cover body so the document content starts on a fresh page,
 *     - the export's running header/footer applies to the cover page too
 *       (ODF master pages are document-wide; a cover-specific page style
 *       would be a follow-up).
 *
 * The result needs NO <office:font-face-decls> entry: only well-known
 * family names are referenced via fo:font-family. Only the namespaces
 * that content.xml already declares (text / table / draw / svg / xlink /
 * office / style / fo) are used.
 *
 * Failure mode mirrors coverPdf.ts: a cover whose body cannot be parsed —
 * or contains nothing renderable — throws; the odtExporter call site
 * catches that and proceeds without the cover (signalled via
 * ExportResult.coverSkipped so the UI can warn).
 */

import type { CoverPageAsset } from '@/types';
import {
  parseCoverBodyDom,
  parseParagraph,
  type CoverParagraph,
  type ImagePiece,
  type RunStyle,
} from './coverPdf';

/* ------------------------------------------------------------------ */
/* Whitespace preservation (mirrors odtExporter.xmlEscapeWithSpaces)   */
/* ------------------------------------------------------------------ */

/** XML escape — escapes the 5 special characters. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * XML-escape text for ODF paragraph content while preserving whitespace.
 *
 * Byte-equivalent twin of odtExporter.xmlEscapeWithSpaces, kept LOCAL so
 * the renderer stays a leaf module (no renderer → exporter dependency
 * cycle): ODF collapses runs of literal spaces inside <text:p>, so a run
 * of 2+ spaces becomes <text:s text:c="N"/>, a single internal space stays
 * literal, a tab becomes <text:tab/>, and the 5 XML special characters are
 * escaped.
 */
function xmlEscapeWithSpaces(text: string): string {
  const chars = Array.from(text);
  let out = '';
  let plain = '';
  const flush = () => {
    if (plain.length > 0) {
      out += xmlEscape(plain);
      plain = '';
    }
  };
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (ch === '\t') {
      flush();
      out += '<text:tab/>';
      i++;
    } else if (ch === ' ') {
      flush();
      let count = 0;
      while (i < chars.length && chars[i] === ' ') {
        count++;
        i++;
      }
      out += count === 1 ? ' ' : `<text:s text:c="${count}"/>`;
    } else {
      plain += ch;
      i++;
    }
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------ */
/* Unit + value helpers                                                */
/* ------------------------------------------------------------------ */

/** pt → cm (1pt = 1/72in, 1in = 2.54cm). */
const PT_TO_CM = 2.54 / 72;

/** Millimetres → centimetres (coverPdf's image pieces carry mm). */
const MM_TO_CM = 0.1;

/** Format a centimetre length for an ODF attribute ("5.08cm"). */
function fmtCm(cm: number): string {
  const trimmed = cm.toFixed(3).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return `${trimmed}cm`;
}

/** Run color (parsed RGB) → ODF "#rrggbb". */
function hexColor(rgb: RunStyle['color']): string {
  const hex = ((rgb.r << 16) | (rgb.g << 8) | rgb.b).toString(16).padStart(6, '0');
  return `#${hex}`;
}

/** PDF-standard-14 buckets → real family names for fo:font-family. */
const FONT_FAMILY: Record<RunStyle['font'], string> = {
  helvetica: 'Helvetica',
  times: 'Times New Roman',
  courier: 'Courier New',
};

/** Decode base64 → raw bytes (for the Pictures/ ZIP entries). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/* ------------------------------------------------------------------ */
/* Result model                                                        */
/* ------------------------------------------------------------------ */

/** One cover image to embed: a ZIP entry under Pictures/ + manifest entry. */
export interface OdtCoverImage {
  /** Archive path ("Pictures/cover-1.png"). */
  path: string;
  /** Raw PNG/JPEG bytes. */
  bytes: Uint8Array;
  /** "image/png" | "image/jpeg". */
  mediaType: string;
}

/** Flow-rendered cover, ready to be woven into content.xml by odtExporter. */
export interface OdtCoverRender {
  /** Body XML: a sequence of <text:p>/<table:table> elements for the START
   *  of <office:text> (uses only namespaces the content.xml root declares
   *  once the exporter's picture/table flags are on). */
  bodyXml: string;
  /** Automatic style definitions (CovT/CovP/CovFrame) for content.xml's
   *  <office:automatic-styles>. */
  stylesXml: string;
  /** Images referenced via xlink:href — the exporter adds each as a
   *  Pictures/ ZIP entry plus a manifest file entry. */
  images: OdtCoverImage[];
  /** True when bodyXml contains <table:table> (the content.xml root needs
   *  the table: namespace declaration). */
  usesTables: boolean;
}

/* ------------------------------------------------------------------ */
/* Automatic-style registry (interned per format combination)          */
/* ------------------------------------------------------------------ */

/**
 * Self-contained interned style registry (the same pattern as the
 * odtExporter's span/layout registries, but traveling WITH the rendered
 * fragment so the exporter just splices one stylesXml blob in).
 */
class CoverStyleRegistry {
  private charIds = new Map<string, string>();
  private paraIds = new Map<string, string>();
  private defs: string[] = [];
  private frameUsed = false;

  /** Character style for one run format → "CovT<n>". */
  charStyle(fmt: {
    fontFamily: string;
    sizePt: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    colorHex: string;
  }): string {
    const key = JSON.stringify([
      fmt.fontFamily,
      fmt.sizePt,
      fmt.bold,
      fmt.italic,
      fmt.underline,
      fmt.colorHex,
    ]);
    const existing = this.charIds.get(key);
    if (existing) return existing;
    const name = `CovT${this.charIds.size + 1}`;
    this.charIds.set(key, name);
    const props = [
      `fo:font-family="${fmt.fontFamily}"`,
      `fo:font-size="${fmt.sizePt}pt"`,
      ...(fmt.bold ? ['fo:font-weight="bold"'] : []),
      ...(fmt.italic ? ['fo:font-style="italic"'] : []),
      ...(fmt.underline ? ['style:text-underline-style="solid"'] : []),
      `fo:color="${fmt.colorHex}"`,
    ];
    this.defs.push(
      `<style:style style:name="${name}" style:family="text">` +
        `<style:text-properties ${props.join(' ')} />` +
        `</style:style>`,
    );
    return name;
  }

  /** Paragraph style (alignment + spacing) → "CovP<n>". */
  paraStyle(fmt: {
    align: 'left' | 'center' | 'right';
    marginTopCm: number;
    marginBottomCm: number;
  }): string {
    const key = JSON.stringify([fmt.align, fmt.marginTopCm, fmt.marginBottomCm]);
    const existing = this.paraIds.get(key);
    if (existing) return existing;
    const name = `CovP${this.paraIds.size + 1}`;
    this.paraIds.set(key, name);
    const align = fmt.align === 'center' ? 'center' : fmt.align === 'right' ? 'end' : 'start';
    const props = [
      `fo:text-align="${align}"`,
      ...(fmt.marginTopCm > 0 ? [`fo:margin-top="${fmtCm(fmt.marginTopCm)}"`] : []),
      ...(fmt.marginBottomCm > 0 ? [`fo:margin-bottom="${fmtCm(fmt.marginBottomCm)}"`] : []),
    ];
    this.defs.push(
      `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="TextBody">` +
        `<style:paragraph-properties ${props.join(' ')} />` +
        `</style:style>`,
    );
    return name;
  }

  /** Mark that an inline image frame was emitted (adds the graphic style). */
  useFrame(): void {
    this.frameUsed = true;
  }

  /** All collected automatic style definitions ("" when none). */
  build(): string {
    const frame = this.frameUsed
      ? '<style:style style:name="CovFrame" style:family="graphic">' +
        '<style:graphic-properties style:vertical-pos="top" style:vertical-rel="baseline" ' +
        'fo:margin-top="0.1cm" fo:margin-bottom="0.1cm" />' +
        '</style:style>'
      : '';
    return this.defs.join('') + frame;
  }
}

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */

/**
 * Flow-render the imported cover page's first-page OOXML into ODF body XML
 * (§42 — ODT extension, best effort; see the module comment for the exact
 * fidelity contract). Pure function — no ZIP, no side effects.
 *
 * Throws only when the body XML is unparseable or contains nothing
 * renderable (the odtExporter catches that and falls back to an export
 * WITHOUT the cover, signalled via ExportResult.coverSkipped).
 */
export function renderCoverToOdt(cover: CoverPageAsset): OdtCoverRender {
  // Parse exactly like the PDF renderer (namespace-synthesized wrapper).
  const root = parseCoverBodyDom(cover);

  const styles = new CoverStyleRegistry();
  const images: OdtCoverImage[] = [];
  const imageEntries = new Map<string, { path: string; mediaType: string }>();
  const out: string[] = [];
  let frameCounter = 0;
  let usesTables = false;
  let emitted = false; // any body element produced
  let stopped = false; // page-break cutoff (the cover is ONE page)

  /** First direct child element with a tag name. */
  const childByTag = (el: Element, tag: string): Element | null => {
    for (const child of Array.from(el.children)) {
      if (child.tagName === tag) return child;
    }
    return null;
  };

  /** Run style → character format for the registry. */
  const charFormat = (style: RunStyle) => ({
    fontFamily: FONT_FAMILY[style.font],
    sizePt: style.sizePt,
    bold: style.style === 'bold' || style.style === 'bolditalic',
    italic: style.style === 'italic' || style.style === 'bolditalic',
    underline: style.underline,
    colorHex: hexColor(style.color),
  });

  /** Inline image frame for one image piece (registers the picture). */
  const imageFrameXml = (piece: ImagePiece): string => {
    const m = /^data:image\/(png|jpeg);base64,([\s\S]*)$/.exec(piece.dataUrl);
    if (!m) return ''; // unreachable — sniffImage builds exactly this form
    const mediaType = `image/${m[1]}`;
    let entry = imageEntries.get(piece.dataUrl);
    if (!entry) {
      entry = {
        path: `Pictures/cover-${imageEntries.size + 1}.${m[1] === 'png' ? 'png' : 'jpg'}`,
        mediaType,
      };
      imageEntries.set(piece.dataUrl, entry);
      images.push({ path: entry.path, bytes: base64ToBytes(m[2]), mediaType });
    }
    styles.useFrame();
    frameCounter += 1;
    // Size: the parsed piece carries mm (EMU-derived); cm = mm / 10, i.e.
    // the same EMU / 360000 conversion.
    return (
      `<draw:frame draw:style-name="CovFrame" text:anchor-type="as-char"` +
      ` svg:width="${fmtCm(piece.widthMm * MM_TO_CM)}" svg:height="${fmtCm(piece.heightMm * MM_TO_CM)}"` +
      ` draw:name="cover-image-${frameCounter}">` +
      `<draw:image xlink:href="${entry.path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad">` +
      `<office:binary-data>${m[2]}</office:binary-data>` +
      `</draw:image></draw:frame>`
    );
  };

  /**
   * One parsed paragraph → <text:p> XML. A page break INSIDE the paragraph
   * stops the whole translation: the partial paragraph is emitted and the
   * rest (of the paragraph and the document) is dropped.
   */
  const paragraphXml = (para: CoverParagraph): string => {
    const styleName = styles.paraStyle({
      align: para.align,
      marginTopCm: para.spacingBeforePt * PT_TO_CM,
      marginBottomCm: para.spacingAfterPt * PT_TO_CM,
    });
    const inner: string[] = [];
    for (const piece of para.pieces) {
      if (piece.kind === 'pageBreak') {
        stopped = true;
        break;
      }
      if (piece.kind === 'text') {
        const cs = styles.charStyle(charFormat(piece.style));
        inner.push(`<text:span text:style-name="${cs}">${xmlEscapeWithSpaces(piece.text)}</text:span>`);
      } else if (piece.kind === 'break') {
        inner.push('<text:line-break/>');
      } else {
        const frame = imageFrameXml(piece);
        if (frame !== '') inner.push(frame);
      }
    }
    return `<text:p text:style-name="${styleName}">${inner.join('')}</text:p>`;
  };

  /** Paragraphs of a table cell (w:p directly + inside SDT wrappers;
   *  nested tables are skipped — documented degrade). */
  const collectCellParagraphs = (tc: Element, paras: string[]): void => {
    for (const child of Array.from(tc.children)) {
      if (stopped) return;
      if (child.tagName === 'w:p') {
        paras.push(paragraphXml(parseParagraph(child, cover)));
      } else if (child.tagName === 'w:sdt') {
        const content = childByTag(child, 'w:sdtContent');
        if (content) collectCellParagraphs(content, paras);
      }
    }
  };

  /** One w:tbl → <table:table> (cell paragraphs keep their formatting). */
  const tableXml = (tbl: Element): string => {
    const rows: string[] = [];
    let maxCols = 0;
    for (const tr of Array.from(tbl.children)) {
      if (stopped) break;
      if (tr.tagName !== 'w:tr') continue;
      const cells: string[] = [];
      for (const tc of Array.from(tr.children)) {
        if (stopped) break;
        if (tc.tagName !== 'w:tc') continue;
        const paras: string[] = [];
        collectCellParagraphs(tc, paras);
        // An ODF table cell must contain at least one paragraph.
        if (paras.length === 0) paras.push('<text:p/>');
        cells.push(`<table:table-cell>${paras.join('')}</table:table-cell>`);
      }
      maxCols = Math.max(maxCols, cells.length);
      if (cells.length > 0) rows.push(`<table:table-row>${cells.join('')}</table:table-row>`);
    }
    if (rows.length === 0) return '';
    usesTables = true;
    return (
      '<table:table>' +
      (maxCols > 1
        ? `<table:table-column table:number-columns-repeated="${maxCols}"/>`
        : '<table:table-column/>') +
      rows.join('') +
      '</table:table>'
    );
  };

  /** Block-level walk (paragraphs, tables, transparent SDT wrappers). */
  const walkBlocks = (parent: Element): void => {
    for (const block of Array.from(parent.children)) {
      if (stopped) return;
      if (block.tagName === 'w:p') {
        out.push(paragraphXml(parseParagraph(block, cover)));
        emitted = true;
      } else if (block.tagName === 'w:tbl') {
        const xml = tableXml(block);
        if (xml !== '') {
          out.push(xml);
          emitted = true;
        }
      } else if (block.tagName === 'w:sdt') {
        const content = childByTag(block, 'w:sdtContent');
        if (content) walkBlocks(content);
      }
      // Unknown block constructs (shapes, text boxes…) are skipped
      // without throwing.
    }
  };

  walkBlocks(root);

  if (!emitted) {
    // Nothing renderable was captured — signal an unusable cover so the
    // exporter falls back instead of emitting a blank first page.
    throw new Error('Cover page has no renderable content.');
  }

  return {
    bodyXml: out.join(''),
    stylesXml: styles.build(),
    images,
    usesTables,
  };
}
