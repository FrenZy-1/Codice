/**
 * Cover pages (§42-§44).
 *
 * Codice does NOT create cover pages — the user provides a one-page .docx
 * and Codice uses its FIRST PAGE ONLY, preserved AS IS:
 *
 *   user uploads cover.docx
 *           ↓
 *   importCoverDocx(): parse the OOXML, cut the <w:body> at the first
 *   page boundary, keep the referenced media/rels/styles/numbering
 *           ↓
 *   applyCoverToDocx(): at export time the generated document's package
 *   is post-processed — the cover body XML is spliced in front of the
 *   generated content with remapped relationship ids, merged styles and
 *   copied media, followed by one explicit page break.
 *
 * Nothing about the page is reconstructed for the DOCX path: no layout,
 * fonts, shapes, colors, spacing or positioning is interpreted. For
 * multi-page sources the remaining pages are ignored (`truncated` flags
 * this in the UI). The only interpreted metadata is the page GEOMETRY
 * (first w:sectPr → pageWidth/Height + margins in mm), captured so the
 * PDF exporter can size its cover page exactly as authored (§42).
 */

import JSZip from 'jszip';
import type { CoverPageAsset } from '@/types';

/** Generate a stable cover asset id. */
function coverId(): string {
  return `cov-${Math.random().toString(36).slice(2, 10)}`;
}

/** Twips (twentieths of a point) → millimetres. */
function twipsToMm(twips: number): number {
  return (twips / 20) * (25.4 / 72);
}

/** Parse a numeric attribute as twips → mm (null when absent/invalid). */
function attrTwipsToMm(el: Element | null, attr: string): number | undefined {
  if (!el) return undefined;
  const raw = el.getAttribute(attr);
  if (raw == null || raw.trim() === '') return undefined;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) return undefined;
  return twipsToMm(v);
}

/**
 * Capture the page geometry declared by the document's FIRST w:sectPr
 * (page size + margins) so PDF exports can size the cover page exactly
 * as authored (§42). Best-effort: every field is optional — documents
 * without a sectPr (or with partial attributes) simply omit fields.
 */
function capturePageGeometry(bodyXml: string): Pick<
  CoverPageAsset,
  'pageWidthMm' | 'pageHeightMm' | 'marginTopMm' | 'marginRightMm' | 'marginBottomMm' | 'marginLeftMm'
> {
  const geometry: Pick<
    CoverPageAsset,
    'pageWidthMm' | 'pageHeightMm' | 'marginTopMm' | 'marginRightMm' | 'marginBottomMm' | 'marginLeftMm'
  > = {};
  // The body's namespace declarations live on the (stripped) document
  // root, so every prefix used here is auto-declared on the wrapper —
  // otherwise strict XML parsers reject the fragment. The wrapper's own
  // 'w' declaration is never duplicated.
  const declared = new Set<string>(['w']);
  for (const m of bodyXml.matchAll(/xmlns:([A-Za-z_][\w.-]*)\s*=/g)) declared.add(m[1]);
  const used = new Set<string>();
  for (const m of bodyXml.matchAll(/<\/?([A-Za-z_][\w.-]*):[A-Za-z_][\w.-]*[\s/>]/g)) used.add(m[1]);
  for (const m of bodyXml.matchAll(/\s([A-Za-z_][\w.-]*):[A-Za-z_][\w.-]*\s*=/g)) used.add(m[1]);
  const extraNs = [...used]
    .filter((p) => !declared.has(p) && p !== 'xml' && p !== 'xmlns')
    .map((p) => ` xmlns:${p}="urn:codice:cover:${p}"`)
    .join('');
  // DOMParser: native in the browser, provided by jsdom in tests.
  const dom = new DOMParser().parseFromString(
    `<w:root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"${extraNs}>${bodyXml}</w:root>`,
    'application/xml',
  );
  if (dom.getElementsByTagName('parsererror').length > 0) return geometry;
  const sectPr = dom.getElementsByTagName('w:sectPr')[0];
  if (!sectPr) return geometry;
  const pgSz = sectPr.getElementsByTagName('w:pgSz')[0];
  if (pgSz) {
    const widthMm = attrTwipsToMm(pgSz, 'w:w');
    const heightMm = attrTwipsToMm(pgSz, 'w:h');
    if (widthMm !== undefined && heightMm !== undefined) {
      geometry.pageWidthMm = widthMm;
      geometry.pageHeightMm = heightMm;
    }
  }
  const pgMar = sectPr.getElementsByTagName('w:pgMar')[0];
  if (pgMar) {
    const top = attrTwipsToMm(pgMar, 'w:top');
    const right = attrTwipsToMm(pgMar, 'w:right');
    const bottom = attrTwipsToMm(pgMar, 'w:bottom');
    const left = attrTwipsToMm(pgMar, 'w:left');
    if (top !== undefined) geometry.marginTopMm = top;
    if (right !== undefined) geometry.marginRightMm = right;
    if (bottom !== undefined) geometry.marginBottomMm = bottom;
    if (left !== undefined) geometry.marginLeftMm = left;
  }
  return geometry;
}

/** Extract the inner XML of the first <w:body> element. */
function extractBody(documentXml: string): string | null {
  const open = documentXml.indexOf('<w:body>');
  const close = documentXml.lastIndexOf('</w:body>');
  if (open === -1 || close === -1 || close <= open) return null;
  return documentXml.slice(open + '<w:body>'.length, close);
}

/**
 * Cut the body XML at the FIRST page boundary. Word marks page starts in
 * three ways; any of them ends page 1:
 *   - <w:lastRenderedPageBreak/>  (render cache marker — content before it
 *     is page 1),
 *   - <w:br w:type="page"/>       (explicit break — page 1 ends after it),
 *   - a paragraph with <w:pageBreakBefore/> (the NEXT page starts there),
 *   - an inline <w:sectPr> (a section break is also a page boundary).
 * The trailing body-level <w:sectPr> (page setup, not content) is always
 * removed.
 */
function cutFirstPage(bodyXml: string): { xml: string; cut: boolean } {
  // Strip the trailing body-level sectPr (page setup, never content).
  let xml = bodyXml.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>\s*$/, '');

  const markers: Array<{ index: number; end: number }> = [];
  const rendered = /<w:lastRenderedPageBreak\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = rendered.exec(xml))) markers.push({ index: m.index, end: m.index + m[0].length });

  const br = /<w:br\b[^>]*w:type="page"[^>]*\/>/g;
  while ((m = br.exec(xml))) markers.push({ index: m.index, end: m.index + m[0].length });

  // Paragraph-level pageBreakBefore: cut at the START of its paragraph.
  const pbb = /<w:p\b[^>]*>(?:(?!<w:p[\s>])[\s\S])*?<w:pageBreakBefore\s*\/>/g;
  while ((m = pbb.exec(xml))) markers.push({ index: m.index, end: m.index });

  // Inline section properties (mid-body section break).
  const sect = /<w:sectPr\b/g;
  while ((m = sect.exec(xml))) markers.push({ index: m.index, end: m.index });

  if (markers.length === 0) return { xml, cut: false };
  const first = markers.reduce((a, b) => (a.index <= b.index ? a : b));
  return { xml: closeOpenElements(xml.slice(0, first.index)).trim(), cut: true };
}

/**
 * Make a truncated XML fragment well-formed by closing any elements that
 * are still open at the cut point. A manual page break (<w:br w:type="page"/>
 * — Word's Ctrl+Enter) sits INSIDE a run inside a paragraph, so cutting at
 * it leaves <w:p>/<w:r> unclosed; without this repair both the DOCX splice
 * (malformed document.xml) and the PDF renderer (parsererror) would fail on
 * such covers. Content before the break belongs to page 1 (Word semantics),
 * so it is kept — only the missing close tags are appended.
 */
function closeOpenElements(fragment: string): string {
  const stack: string[] = [];
  // NOTE: the element-name class must include ':' — OOXML tags are
  // namespace-prefixed (w:p, wp:extent, pic:pic, …).
  const tag = /<(\/?)([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(fragment))) {
    const closing = m[1] === '/';
    const name = m[2];
    const selfClosed = m[4] === '/';
    if (closing) {
      // Pop up to (and including) the matching open tag — tolerate stray
      // closes (never produced by valid input, harmless to ignore).
      const idx = stack.lastIndexOf(name);
      if (idx >= 0) stack.length = idx;
    } else if (!selfClosed) {
      stack.push(name);
    }
  }
  let out = fragment;
  for (let i = stack.length - 1; i >= 0; i--) out += `</${stack[i]}>`;
  return out;
}

/** Parse the document rels list (id → {target, type}). */
function parseRels(relsXml: string): Array<{ id: string; target: string; type: string; external: boolean }> {
  const out: Array<{ id: string; target: string; type: string; external: boolean }> = [];
  const rel = /<Relationship\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = rel.exec(relsXml))) {
    const tag = m[0];
    const id = /Id="([^"]+)"/.exec(tag)?.[1];
    const target = /Target="([^"]+)"/.exec(tag)?.[1];
    const type = /Type="([^"]+)"/.exec(tag)?.[1];
    if (!id || !target || !type) continue;
    out.push({ id, target, type, external: tag.includes('TargetMode="External"') });
  }
  return out;
}

/** Collect the relationship ids referenced by a piece of body XML. */
function referencedRelIds(bodyXml: string): Set<string> {
  const ids = new Set<string>();
  const attr = /(?:r:embed|r:id|r:link)="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = attr.exec(bodyXml))) ids.add(m[1]);
  return ids;
}

/** Collect pStyle/rStyle/tblStyle style ids used by the body XML. */
function usedStyleIds(bodyXml: string): string[] {
  const ids = new Set<string>();
  const attr = /<(?:w:pStyle|w:rStyle|w:tblStyle)\s+w:val="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = attr.exec(bodyXml))) ids.add(m[1]);
  return [...ids];
}

/** Collect numbering ids used by the body XML. */
function usedNumberingIds(bodyXml: string): string[] {
  const ids = new Set<string>();
  const attr = /<w:numId\s+w:val="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = attr.exec(bodyXml))) ids.add(m[1]);
  return [...ids];
}

/**
 * Import a .docx file as a cover page asset. Uses the FIRST PAGE only;
 * `truncated` reports whether the source had further pages.
 */
export async function importCoverDocx(file: File): Promise<CoverPageAsset> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) {
    throw new Error('This file is not a Word document (missing word/document.xml).');
  }
  const body = extractBody(documentXml);
  if (!body || body.trim() === '') {
    throw new Error('The document has no content on its first page.');
  }
  const { xml: firstPageXml, cut } = cutFirstPage(body);
  if (firstPageXml.trim() === '') {
    throw new Error('The first page of this document is empty.');
  }

  // Page count from app.xml (informational).
  let pageCount = 1;
  const appXml = await zip.file('docProps/app.xml')?.async('string');
  if (appXml) {
    const pages = /<Pages>(\d+)<\/Pages>/.exec(appXml)?.[1];
    if (pages) pageCount = Math.max(1, parseInt(pages, 10) || 1);
  }
  const truncated = cut || pageCount > 1;

  // Relationships + media referenced by the kept page.
  const relsXml = (await zip.file('word/_rels/document.xml.rels')?.async('string')) ?? '';
  const allRels = parseRels(relsXml);
  const usedIds = referencedRelIds(firstPageXml);
  const rels: CoverPageAsset['rels'] = [];
  const media: CoverPageAsset['media'] = [];
  for (const rel of allRels) {
    if (!usedIds.has(rel.id)) continue;
    rels.push({ id: rel.id, target: rel.target, type: rel.type });
    if (!rel.external && rel.type.includes('/image')) {
      const partPath = rel.target.startsWith('/')
        ? rel.target.slice(1)
        : `word/${rel.target.replace(/^\.\.\//, '')}`;
      const bytes = await zip.file(partPath)?.async('uint8array');
      if (bytes) media.push({ relId: rel.id, partPath, bytes });
    }
  }

  // Styles + numbering (full definitions — merged at export time).
  const stylesXml = await zip.file('word/styles.xml')?.async('string');
  const stylesInner = stylesXml
    ? (/<w:styles\b[^>]*>([\s\S]*?)<\/w:styles>/.exec(stylesXml)?.[1] ?? '')
    : '';
  const numberingXml = await zip.file('word/numbering.xml')?.async('string');
  const numberingInner = numberingXml
    ? (/<w:numbering\b[^>]*>([\s\S]*?)<\/w:numbering>/.exec(numberingXml)?.[1] ?? '')
    : '';

  // Page geometry from the FIRST sectPr of the source document (page 1
  // setup) — used by the PDF exporter to size the cover page as authored.
  // Parsed from the FULL body (cutFirstPage strips the trailing sectPr,
  // so the geometry must be captured before the cut).
  const pageGeometry = capturePageGeometry(body);

  // Namespace declarations from the source document root — the cover body
  // uses prefixed elements (wp:, a:, pic:, …) declared there; the DOCX
  // splice re-declares the missing ones on the target root (§42 fix).
  const namespaces = captureRootNamespaces(documentXml);

  return {
    id: coverId(),
    name: file.name.replace(/\.docx$/i, ''),
    fileName: file.name,
    addedAt: Date.now(),
    truncated,
    bodyXml: firstPageXml,
    media,
    rels,
    styleIds: usedStyleIds(firstPageXml),
    numberingIds: usedNumberingIds(firstPageXml),
    stylesInner,
    numberingInner,
    pageCount,
    ...(namespaces.length > 0 ? { namespaces } : {}),
    ...pageGeometry,
  };
}

/**
 * Collect the xmlns:PREFIX="URI" declarations of the document's ROOT
 * element (w:document). The body XML handed to the splice/PDF renderer is
 * extracted from inside <w:body>, so those declarations would otherwise be
 * lost — yet the cover's prefixed elements need them to stay bound.
 */
function captureRootNamespaces(documentXml: string): Array<{ prefix: string; uri: string }> {
  const out: Array<{ prefix: string; uri: string }> = [];
  const root = /<w:document\b[^>]*>/.exec(documentXml)?.[0];
  if (!root) return out;
  const decl = /xmlns:([A-Za-z_][\w.-]*)\s*=\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(root))) out.push({ prefix: m[1], uri: m[2] });
  return out;
}

/**
 * Well-known OOXML namespace URIs — the fallback for covers imported before
 * namespace capture existed (or exotic prefixes not declared on the source
 * root). URIs matter here: Word resolves elements by namespace URI + local
 * name, so a dummy URI would silently drop the element at render time.
 */
const KNOWN_OOXML_URIS: Record<string, string> = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  w15: 'http://schemas.microsoft.com/office/word/2012/wordml',
  w16: 'http://schemas.microsoft.com/office/word/2018/wordml',
  w16cid: 'http://schemas.microsoft.com/office/word/2016/wordml/cid',
  w16se: 'http://schemas.microsoft.com/office/word/2015/wordml/symex',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  wpg: 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
  wpi: 'http://schemas.microsoft.com/office/word/2010/wordprocessingInk',
  wne: 'http://schemas.microsoft.com/office/word/2006/wordml',
  wpc: 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas',
  w10: 'urn:schemas-microsoft-com:office:word',
  v: 'urn:schemas-microsoft-com:vml',
  o: 'urn:schemas-microsoft-com:office:office',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  cx: 'http://schemas.microsoft.com/office/drawing/2014/chartex',
  am3d: 'http://schemas.microsoft.com/office/drawing/2017/3dmodel',
  wp14: 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing',
};

/**
 * Return `documentXml` with every namespace prefix USED by the cover body
 * but NOT bound on the target's <w:document> root declared on that root.
 * Resolution order: the cover's captured source declarations (exact URIs —
 * perfect fidelity) → the well-known OOXML map → a dummy URI (well-formed
 * fallback; Word ignores such elements rather than failing the file).
 */
function ensureRootNamespaces(
  documentXml: string,
  coverBody: string,
  cover: CoverPageAsset,
): string {
  const rootMatch = /<w:document\b[^>]*>/.exec(documentXml);
  if (!rootMatch) return documentXml;
  const rootTag = rootMatch[0];

  const declared = new Set<string>();
  for (const m of rootTag.matchAll(/xmlns:([A-Za-z_][\w.-]*)\s*=/g)) declared.add(m[1]);

  // Prefixes used by the cover body (element names + prefixed attributes).
  const used = new Set<string>();
  for (const m of coverBody.matchAll(/<\/?([A-Za-z_][\w.-]*):[A-Za-z_][\w.-]*[\s/>]/g)) used.add(m[1]);
  for (const m of coverBody.matchAll(/\s([A-Za-z_][\w.-]*):[A-Za-z_][\w.-]*\s*=/g)) used.add(m[1]);

  const captured = new Map<string, string>();
  for (const ns of cover.namespaces ?? []) captured.set(ns.prefix, ns.uri);

  const inject: string[] = [];
  for (const prefix of used) {
    if (prefix === 'xml' || prefix === 'xmlns' || declared.has(prefix)) continue;
    const uri = captured.get(prefix) ?? KNOWN_OOXML_URIS[prefix] ?? `urn:codice:cover:${prefix}`;
    inject.push(` xmlns:${prefix}="${uri}"`);
  }
  if (inject.length === 0) return documentXml;

  const newRootTag = rootTag.replace(/>\s*$/, '') + inject.join('') + '>';
  return documentXml.replace(rootTag, newRootTag);
}

/* ------------------------------------------------------------------ */
/* Export-time merge                                                   */
/* ------------------------------------------------------------------ */

/** One explicit page-break paragraph. */
const PAGE_BREAK_PARA =
  '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/** Read a zip text file (null when missing). */
async function readText(zip: JSZip, path: string): Promise<string | null> {
  return (await zip.file(path)?.async('string')) ?? null;
}

/** Extract every style id defined in a styles.xml inner fragment. */
function definedStyleIds(stylesInner: string): Set<string> {
  const ids = new Set<string>();
  const def = /<w:style\b[^>]*w:styleId="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = def.exec(stylesInner))) ids.add(m[1]);
  return ids;
}

/** Rename style references (pStyle/rStyle/tblStyle) in body XML. */
function renameStyleRefs(xml: string, map: Map<string, string>): string {
  let out = xml;
  for (const [from, to] of map) {
    out = out.replace(
      new RegExp(`(<w:(?:pStyle|rStyle|tblStyle)\\s+w:val=")${escapeRegExp(from)}(")`, 'g'),
      `$1${to}$2`,
    );
  }
  return out;
}

/** Rename style ids inside the cover's style definitions themselves
 * (styleId attributes + basedOn/link/next references). */
function renameStyleDefs(stylesInner: string, map: Map<string, string>): string {
  let out = stylesInner;
  for (const [from, to] of map) {
    out = out.replace(
      new RegExp(`(w:styleId=")${escapeRegExp(from)}(")`, 'g'),
      `$1${to}$2`,
    );
    out = out.replace(
      new RegExp(`(<w:(?:basedOn|link|next)\\s+w:val=")${escapeRegExp(from)}(")`, 'g'),
      `$1${to}$2`,
    );
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Remap relationship ids in cover XML to fresh, collision-free ids. */
function remapRelIds(xml: string, map: Map<string, string>): string {
  let out = xml;
  for (const [from, to] of map) {
    out = out.replace(
      new RegExp(`((?:r:embed|r:id|r:link)=")${escapeRegExp(from)}(")`, 'g'),
      `$1${to}$2`,
    );
  }
  return out;
}

/**
 * Prepend a cover page to a generated DOCX blob (§42 — preserved as-is).
 *
 * Steps:
 *   1. unzip the generated package,
 *   2. splice the cover body XML right after <w:body> + one page break,
 *   3. remap the cover's relationship ids to fresh rIds, append its
 *      image/hyperlink relationships and copy its media parts,
 *   4. merge the cover's style definitions (renaming ids that would
 *      collide with the generated document's own styles),
 *   5. merge numbering definitions the same way,
 *   6. keep [Content_Types].xml aware of every media extension used,
 *   7. re-zip.
 */
export async function applyCoverToDocx(blob: Blob, cover: CoverPageAsset): Promise<Blob> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const documentXml = await readText(zip, 'word/document.xml');
  if (!documentXml) throw new Error('Generated DOCX is missing word/document.xml.');
  const relsXml = await readText(zip, 'word/_rels/document.xml.rels');
  if (!relsXml) throw new Error('Generated DOCX is missing document relationships.');
  const contentTypesXml = await readText(zip, '[Content_Types].xml');
  if (!contentTypesXml) throw new Error('Generated DOCX is missing [Content_Types].xml.');

  const stylesXml = await readText(zip, 'word/styles.xml');
  const numberingXml = await readText(zip, 'word/numbering.xml');

  // ---- 1. relationship remapping ------------------------------------
  const existingRelIds = new Set(parseRels(relsXml).map((r) => r.id));
  const relMap = new Map<string, string>();
  let relCounter = 0;
  for (const rel of cover.rels) {
    let fresh: string;
    do {
      fresh = `rIdCov${++relCounter}`;
    } while (existingRelIds.has(fresh));
    relMap.set(rel.id, fresh);
  }

  let coverBody = remapRelIds(cover.bodyXml, relMap);

  // ---- 2. style collision handling ----------------------------------
  const ourStyleIds = stylesXml ? definedStyleIds(extractStylesInner(stylesXml)) : new Set<string>();
  const styleRename = new Map<string, string>();
  for (const id of cover.styleIds ?? []) {
    if (ourStyleIds.has(id)) styleRename.set(id, `${id}Cov`);
  }
  const coverStylesInner = cover.stylesInner;
  if (styleRename.size > 0 && coverStylesInner) {
    coverBody = renameStyleRefs(coverBody, styleRename);
  }

  // ---- 3. numbering remapping ---------------------------------------
  let numberingInnerFinal = cover.numberingInner;
  const coverNumberingInner = cover.numberingInner;
  const numberingRename = new Map<string, string>();
  let numCounter = 0;
  if (coverNumberingInner && (cover.numberingIds?.length ?? 0) > 0) {
    // Remap every cover numId to a high, collision-free value.
    const abstractMap = new Map<string, string>();
    const abstracts = [...coverNumberingInner.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="([^"]+)"/g)];
    for (const a of abstracts) abstractMap.set(a[1], `C${a[1]}`);
    for (const id of cover.numberingIds) numberingRename.set(id, `Cov${++numCounter}`);
    // numId references in the body.
    for (const [from, to] of numberingRename) {
      coverBody = coverBody.replace(
        new RegExp(`(<w:numId\\s+w:val=")${escapeRegExp(from)}(")`, 'g'),
        `$1${to}$2`,
      );
    }
    // numId + abstractNumId references inside the numbering definitions.
    let remappedNumbering = coverNumberingInner;
    for (const [from, to] of abstractMap) {
      remappedNumbering = remappedNumbering.replace(
        new RegExp(`(w:abstractNumId=")${escapeRegExp(from)}(")`, 'g'),
        `$1${to}$2`,
      );
      remappedNumbering = remappedNumbering.replace(
        new RegExp(`(<w:abstractNumId\\s+w:val=")${escapeRegExp(from)}(")`, 'g'),
        `$1${to}$2`,
      );
    }
    for (const [from, to] of numberingRename) {
      remappedNumbering = remappedNumbering.replace(
        new RegExp(`(<w:num\\s+w:numId=")${escapeRegExp(from)}(")`, 'g'),
        `$1${to}$2`,
      );
    }
    numberingInnerFinal = remappedNumbering;
  }

  // ---- 4. splice the body --------------------------------------------
  // The cover body uses prefixed elements (wp:, a:, pic:, …) whose xmlns
  // declarations lived on the SOURCE document root. Re-declare every used
  // prefix the target root does not already bind — otherwise the merged
  // document.xml is not namespace-well-formed (Word would reject it).
  // NOTE: inject FIRST — it lengthens the root tag, so the <w:body> offsets
  // must be computed on the patched string.
  const withNamespaces = ensureRootNamespaces(documentXml, coverBody, cover);
  const bodyOpen = withNamespaces.indexOf('<w:body>');
  if (bodyOpen === -1) throw new Error('Generated DOCX body not found.');
  const insertAt = bodyOpen + '<w:body>'.length;
  const newDocumentXml =
    withNamespaces.slice(0, insertAt) + coverBody + PAGE_BREAK_PARA + withNamespaces.slice(insertAt);
  zip.file('word/document.xml', newDocumentXml);

  // ---- 5. relationships + media ---------------------------------------
  let newRelsXml = relsXml;
  const relEntries: string[] = [];
  let mediaIndex = 0;
  const usedExtensions = new Set<string>();
  for (const rel of cover.rels) {
    const freshId = relMap.get(rel.id);
    if (!freshId) continue;
    const isImage = rel.type.includes('/image');
    let target = rel.target;
    if (isImage) {
      mediaIndex += 1;
      const ext = (rel.target.split('.').pop() ?? 'png').toLowerCase();
      usedExtensions.add(ext);
      target = `media/cover-${mediaIndex}.${ext}`;
      const mediaEntry = cover.media.find((m) => m.relId === rel.id);
      if (mediaEntry) {
        zip.file(`word/${target}`, mediaEntry.bytes);
      }
    }
    const external = !isImage && rel.type.includes('/hyperlink');
    relEntries.push(
      `<Relationship Id="${freshId}" Type="${rel.type}" Target="${escapeXmlAttr(target)}"${
        external ? ' TargetMode="External"' : ''
      }/>`,
    );
  }
  if (relEntries.length > 0) {
    newRelsXml = relsXml.replace('</Relationships>', `${relEntries.join('')}</Relationships>`);
    zip.file('word/_rels/document.xml.rels', newRelsXml);
  }

  // ---- 6. styles merge -------------------------------------------------
  if (coverStylesInner.trim() !== '' && stylesXml) {
    const mergedDefs = styleRename.size > 0 ? renameStyleDefs(coverStylesInner, styleRename) : coverStylesInner;
    const inner = extractStylesInner(stylesXml);
    const newStylesXml = stylesXml.replace('</w:styles>', `${mergedDefs}</w:styles>`);
    // Guard: replace only once (the styles.xml has exactly one closing tag).
    zip.file('word/styles.xml', newStylesXml);
    void inner;
  }

  // ---- 7. numbering merge ----------------------------------------------
  if (numberingInnerFinal.trim() !== '') {
    if (numberingXml) {
      zip.file('word/numbering.xml', numberingXml.replace('</w:numbering>', `${numberingInnerFinal}</w:numbering>`));
    } else {
      zip.file(
        'word/numbering.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${numberingInnerFinal}</w:numbering>`,
      );
      // The package needs the numbering part registered.
      if (!contentTypesXml.includes('numbering.xml')) {
        const override =
          '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>';
        zip.file('[Content_Types].xml', contentTypesXml.replace('</Types>', `${override}</Types>`));
      }
    }
  }

  // ---- 8. content types: media extensions ------------------------------
  let newContentTypes = contentTypesXml;
  const defaultsToAdd: string[] = [];
  for (const ext of usedExtensions) {
    if (new RegExp(`Extension="${ext}"`, 'i').test(newContentTypes)) continue;
    const contentType = extContentType(ext);
    defaultsToAdd.push(`<Default Extension="${ext}" ContentType="${contentType}"/>`);
  }
  if (defaultsToAdd.length > 0) {
    newContentTypes = newContentTypes.replace('</Types>', `${defaultsToAdd.join('')}</Types>`);
    zip.file('[Content_Types].xml', newContentTypes);
  }

  return zip.generateAsync({ type: 'blob', mimeType: docxMimeType });
}

function extractStylesInner(stylesXml: string): string {
  return /<w:styles\b[^>]*>([\s\S]*?)<\/w:styles>/.exec(stylesXml)?.[1] ?? '';
}

const docxMimeType =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function extContentType(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    case 'tiff':
    case 'tif':
      return 'image/tiff';
    case 'emf':
      return 'image/x-emf';
    case 'wmf':
      return 'image/x-wmf';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}
