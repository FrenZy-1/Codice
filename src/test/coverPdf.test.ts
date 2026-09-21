/**
 * Cover-page PDF rendering tests (§42 — PDF extension).
 *
 * renderCoverToPdf() flow-renders an imported cover's first-page OOXML
 * onto a jsPDF page. These tests probe the emission by wrapping the
 * jsPDF instance's drawing methods (text/addImage/setFont/setFontSize/
 * setTextColor) — the same instance the exporter uses — so assertions
 * are about WHAT was drawn, not about compressed PDF bytes.
 *
 * The import-time geometry capture (first w:sectPr → mm fields on the
 * CoverPageAsset) is exercised end-to-end through importCoverDocx with
 * a minimal .docx zip built in-test (JSZip), mirroring the real import
 * pipeline. The pdfExporter integration is covered at the byte level:
 * page count and per-page MediaBox sizes of the emitted PDF.
 */

import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import {
  coverPageGeometry,
  emuToMm,
  renderCoverToPdf,
  twipsToMm,
} from '../lib/coverPdf';
import { applyCoverToDocx, importCoverDocx } from '../lib/coverPages';
import { pdfExporter } from '../lib/exporters/pdfExporter';
import type { CoverPageAsset, DocumentModel } from '@/types';
import { defaultDocumentOptions } from '@/lib/defaultOptions';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** Known-good 1×1 PNG (byte-for-byte). */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_BYTES = Uint8Array.from(
  Array.from(atob(PNG_B64), (ch) => ch.charCodeAt(0)),
);

/** First-page OOXML: centered red bold heading, mixed-format body
 * paragraph, a centered inline image and a two-row table. */
const COVER_BODY_XML = `
<w:p>
  <w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="120"/></w:pPr>
  <w:r><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="FF0000"/></w:rPr><w:t>Quarterly Report</w:t></w:r>
</w:p>
<w:p>
  <w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">Prepared by </w:t></w:r>
  <w:r><w:rPr><w:b/></w:rPr><w:t>Codice</w:t></w:r>
  <w:r><w:t> team</w:t></w:r>
</w:p>
<w:p>
  <w:pPr><w:jc w:val="center"/></w:pPr>
  <w:r>
    <w:drawing>
      <wp:extent cx="1828800" cy="914400"/>
      <a:graphic><a:graphicData><a:blip r:embed="rIdCover1"/></a:graphicData></a:graphic>
    </w:drawing>
  </w:r>
</w:p>
<w:tbl>
  <w:tr>
    <w:tc><w:p><w:r><w:t>Version</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:t>1.0</w:t></w:r></w:p></w:tc>
  </w:tr>
  <w:tr>
    <w:tc><w:p><w:r><w:t>Date</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:t>2025</w:t></w:r></w:p></w:tc>
  </w:tr>
</w:tbl>`;

function makeCover(overrides?: Partial<CoverPageAsset>): CoverPageAsset {
  return {
    id: 'cov-test',
    name: 'Test cover',
    fileName: 'cover.docx',
    addedAt: 0,
    truncated: false,
    bodyXml: COVER_BODY_XML,
    media: [
      { relId: 'rIdCover1', partPath: 'word/media/image1.png', bytes: PNG_BYTES },
    ],
    rels: [
      {
        id: 'rIdCover1',
        target: 'media/image1.png',
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
      },
    ],
    styleIds: [],
    numberingIds: [],
    stylesInner: '',
    numberingInner: '',
    pageCount: 1,
    ...overrides,
  };
}

/** A4 page geometry, 20mm margins everywhere. */
const A4_GEO = {
  widthMm: 210,
  heightMm: 297,
  marginTopMm: 20,
  marginRightMm: 20,
  marginBottomMm: 20,
  marginLeftMm: 20,
};

interface PdfCalls {
  text: string[];
  addImage: Array<{ format: string; x: number; y: number; w: number; h: number }>;
  setFontSize: number[];
  setTextColor: Array<[number, number, number]>;
  setFont: Array<[string, string]>;
}

/** jsPDF instance with the drawing methods wrapped for assertions. */
function makeInstrumentedPdf(unit: 'mm' | 'pt' = 'mm'): { pdf: jsPDF; calls: PdfCalls } {
  const pdf = new jsPDF({ unit, format: 'a4' });
  const calls: PdfCalls = { text: [], addImage: [], setFontSize: [], setTextColor: [], setFont: [] };
  const pdfAny = pdf as unknown as Record<string, (...args: unknown[]) => unknown>;

  const origText = pdfAny.text.bind(pdf);
  pdfAny.text = (text: unknown, x: unknown, y: unknown, options?: unknown) => {
    calls.text.push(String(text));
    return origText(text, x, y, options);
  };
  const origAddImage = pdfAny.addImage.bind(pdf);
  pdfAny.addImage = (
    data: unknown,
    format: unknown,
    x: unknown,
    y: unknown,
    w: unknown,
    h: unknown,
  ) => {
    calls.addImage.push({ format: String(format), x: Number(x), y: Number(y), w: Number(w), h: Number(h) });
    return origAddImage(data, format, x, y, w, h);
  };
  const origSetFontSize = pdfAny.setFontSize.bind(pdf);
  pdfAny.setFontSize = (size: unknown) => {
    calls.setFontSize.push(Number(size));
    return origSetFontSize(size);
  };
  const origSetTextColor = pdfAny.setTextColor.bind(pdf);
  pdfAny.setTextColor = (r: unknown, g: unknown, b: unknown) => {
    calls.setTextColor.push([Number(r), Number(g), Number(b)]);
    return origSetTextColor(r, g, b);
  };
  const origSetFont = pdfAny.setFont.bind(pdf);
  pdfAny.setFont = (name: unknown, style: unknown) => {
    calls.setFont.push([String(name), String(style)]);
    return origSetFont(name, style);
  };
  return { pdf, calls };
}

/** All drawn words in order (whitespace wrap tokens removed). */
const drawnWords = (calls: PdfCalls): string =>
  calls.text
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .join(' ');

/* ------------------------------------------------------------------ */
/* Unit conversions + geometry resolution                              */
/* ------------------------------------------------------------------ */

describe('cover unit conversions', () => {
  it('twipsToMm: A4 width 11906 twips ≈ 210mm, 1440 twips = 1 inch', () => {
    expect(twipsToMm(11906)).toBeCloseTo(210, 1);
    expect(twipsToMm(16838)).toBeCloseTo(297, 1);
    expect(twipsToMm(1440)).toBeCloseTo(25.4, 6);
  });

  it('emuToMm: 914400 EMU (1 inch) = 25.4mm', () => {
    expect(emuToMm(914400)).toBeCloseTo(25.4, 6);
    expect(emuToMm(1828800)).toBeCloseTo(50.8, 6);
    expect(emuToMm(0)).toBe(0);
  });
});

describe('coverPageGeometry', () => {
  it('returns the captured geometry with margins defaulted to 1 inch', () => {
    const geo = coverPageGeometry(makeCover({ pageWidthMm: 210, pageHeightMm: 297 }));
    expect(geo).not.toBeNull();
    expect(geo?.widthMm).toBeCloseTo(210, 6);
    expect(geo?.heightMm).toBeCloseTo(297, 6);
    expect(geo?.marginTopMm).toBeCloseTo(25.4, 6);
    expect(geo?.marginBottomMm).toBeCloseTo(25.4, 6);
  });

  it('returns null when no page size was captured (older assets)', () => {
    const cover = makeCover();
    delete cover.pageWidthMm;
    delete cover.pageHeightMm;
    expect(coverPageGeometry(cover)).toBeNull();
  });

  it('returns null for a partial/invalid page size', () => {
    expect(coverPageGeometry(makeCover({ pageWidthMm: 210 }))).toBeNull();
    expect(coverPageGeometry(makeCover({ pageWidthMm: -5, pageHeightMm: 297 }))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* renderCoverToPdf — emission                                         */
/* ------------------------------------------------------------------ */

describe('renderCoverToPdf (mm-unit document)', () => {
  const { pdf, calls } = makeInstrumentedPdf('mm');

  it('renders the cover onto exactly one page', () => {
    renderCoverToPdf(pdf, makeCover(), A4_GEO);
    expect(pdf.getNumberOfPages()).toBe(1);
    expect(calls.text.length).toBeGreaterThan(0);
  });

  it('draws the heading and body text (word-wrapped tokens rejoin)', () => {
    const drawn = drawnWords(calls);
    expect(drawn).toContain('Quarterly Report');
    expect(drawn).toContain('Prepared by Codice team');
  });

  it('maps character formatting: 32 half-points → 16pt, #FF0000 → rgb(255,0,0), bold', () => {
    expect(calls.setFontSize).toContain(16);
    expect(calls.setTextColor).toContainEqual([255, 0, 0]);
    expect(calls.setFont).toContainEqual(['helvetica', 'bold']);
    expect(calls.setFont).toContainEqual(['helvetica', 'italic']);
  });

  it('places the image with EMU-derived size, centered in the content box', () => {
    // 1828800×914400 EMU = 2in×1in = 50.8mm×25.4mm; content box is
    // 210-40 = 170mm wide starting at x=20 → centered x = 20 + (170-50.8)/2.
    expect(calls.addImage).toHaveLength(1);
    const img = calls.addImage[0];
    expect(img.format).toBe('PNG');
    expect(img.w).toBeCloseTo(50.8, 1);
    expect(img.h).toBeCloseTo(25.4, 1);
    expect(img.x).toBeCloseTo(20 + (170 - 50.8) / 2, 1);
    expect(img.y).toBeGreaterThanOrEqual(A4_GEO.marginTopMm);
  });

  it('linearizes the table: rows as text lines with " | " cell joins', () => {
    const drawn = drawnWords(calls);
    expect(drawn).toContain('Version | 1.0');
    expect(drawn).toContain('Date | 2025');
  });

  it('emits a real image XObject into the PDF output', async () => {
    const out = Buffer.from(await (pdf.output('blob') as Blob).arrayBuffer()).toString('latin1');
    expect(/\/Subtype\s*\/Image/.test(out)).toBe(true);
  });
});

describe('renderCoverToPdf (pt-unit document — exporter units)', () => {
  it('converts mm geometry into the document unit', () => {
    const { pdf, calls } = makeInstrumentedPdf('pt');
    renderCoverToPdf(pdf, makeCover(), A4_GEO);
    expect(pdf.getNumberOfPages()).toBe(1);
    expect(calls.addImage).toHaveLength(1);
    // 50.8mm in points = 50.8 * 72 / 25.4 = 144pt.
    expect(calls.addImage[0].w).toBeCloseTo(144, 1);
    expect(calls.addImage[0].h).toBeCloseTo(72, 1);
  });
});

/* ------------------------------------------------------------------ */
/* renderCoverToPdf — degradation                                      */
/* ------------------------------------------------------------------ */

describe('renderCoverToPdf (degradation rules)', () => {
  it('throws only on unparseable XML (the exporter catches and drops the cover)', () => {
    const { pdf } = makeInstrumentedPdf('mm');
    expect(() => renderCoverToPdf(pdf, makeCover({ bodyXml: '<w:p><w:t>oops</w:t' }), A4_GEO)).toThrow();
  });

  it('skips unknown constructs (shapes, text boxes, foreign namespaces) without throwing', () => {
    const bodyXml = `
<w:p w14:paraId="1A2B3C" mc:Ignorable="w14">
  <w:r><w:t>Title stays</w:t></w:r>
</w:p>
<w:p>
  <w:r>
    <w:drawing>
      <a:graphic>
        <a:graphicData>
          <wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>hidden shape text</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp>
        </a:graphicData>
      </a:graphic>
    </w:drawing>
  </w:r>
</w:p>
<w:sdt>
  <w:sdtPr><w:alias w:val="Subtitle"/></w:sdtPr>
  <w:sdtContent>
    <w:p><w:r><w:t>SDT subtitle survives</w:t></w:r></w:p>
  </w:sdtContent>
</w:sdt>
<weird:unknownBlock xmlns:weird="urn:test"><w:p><w:r><w:t>never seen</w:t></w:r></w:p></weird:unknownBlock>`;
    const { pdf, calls } = makeInstrumentedPdf('mm');
    expect(() => renderCoverToPdf(pdf, makeCover({ bodyXml }), A4_GEO)).not.toThrow();
    const drawn = drawnWords(calls);
    // Content-control (SDT) paragraphs render; shapes and unknown blocks
    // are skipped silently.
    expect(drawn).toContain('Title stays');
    expect(drawn).toContain('SDT subtitle survives');
    expect(drawn).not.toContain('hidden shape text');
    expect(drawn).not.toContain('never seen');
  });

  it('drops content past an explicit page break (the cover is one page)', () => {
    const bodyXml =
      '<w:p><w:r><w:t>first page line</w:t></w:r></w:p>' +
      '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
      '<w:p><w:r><w:t>second page content</w:t></w:r></w:p>';
    const { pdf, calls } = makeInstrumentedPdf('mm');
    renderCoverToPdf(pdf, makeCover({ bodyXml }), A4_GEO);
    expect(pdf.getNumberOfPages()).toBe(1);
    expect(drawnWords(calls)).toContain('first page line');
    expect(drawnWords(calls)).not.toContain('second page content');
  });

  it('drops content past the one-page boundary instead of paginating', () => {
    const many = Array.from(
      { length: 80 },
      (_, i) => `<w:p><w:r><w:t>line ${i + 1}</w:t></w:r></w:p>`,
    ).join('');
    const { pdf, calls } = makeInstrumentedPdf('mm');
    renderCoverToPdf(pdf, makeCover({ bodyXml: many }), A4_GEO);
    expect(pdf.getNumberOfPages()).toBe(1);
    const drawn = drawnWords(calls);
    // Early lines render; the tail past the bottom margin is dropped.
    expect(drawn).toContain('line 1');
    expect(drawn).not.toContain(`line ${80}`);
  });

  it('skips non-PNG/JPEG media bytes silently', () => {
    const bodyXml =
      '<w:p><w:r><w:drawing><wp:extent cx="914400" cy="914400"/>' +
      '<a:graphic><a:graphicData><a:blip r:embed="rIdCover1"/></a:graphicData></a:graphic>' +
      '</w:drawing></w:r></w:p>' +
      '<w:p><w:r><w:t>text after image</w:t></w:r></w:p>';
    const gifish = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0]);
    const { pdf, calls } = makeInstrumentedPdf('mm');
    expect(() =>
      renderCoverToPdf(pdf, makeCover({ bodyXml, media: [{ relId: 'rIdCover1', partPath: 'word/media/x.gif', bytes: gifish }] }), A4_GEO),
    ).not.toThrow();
    expect(calls.addImage).toHaveLength(0);
    expect(drawnWords(calls)).toContain('text after image');
  });

  it('throws for an empty body (nothing renderable → exporter fallback)', () => {
    const { pdf, calls } = makeInstrumentedPdf('mm');
    expect(() => renderCoverToPdf(pdf, makeCover({ bodyXml: '   ' }), A4_GEO)).toThrow();
    expect(calls.text).toHaveLength(0);
    expect(pdf.getNumberOfPages()).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* importCoverDocx — geometry capture                                  */
/* ------------------------------------------------------------------ */

/** Build a minimal one-page .docx (document.xml + rels + media). */
async function buildDocxBlob(parts: {
  documentXml: string;
  relsXml?: string;
  media?: Record<string, Uint8Array>;
}): Promise<File> {
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parts.documentXml}</w:body></w:document>`,
  );
  if (parts.relsXml) {
    zip.file('word/_rels/document.xml.rels', parts.relsXml);
  }
  for (const [path, bytes] of Object.entries(parts.media ?? {})) {
    zip.file(path, bytes);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'cover.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

describe('importCoverDocx page-geometry capture (§42)', () => {
  it('parses page size and margins from the first w:sectPr (twips → mm)', async () => {
    const file = await buildDocxBlob({
      documentXml:
        '<w:p><w:r><w:t>Cover</w:t></w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" ' +
        'w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>',
    });
    const cover = await importCoverDocx(file);
    expect(cover.bodyXml).toContain('Cover');
    expect(cover.pageWidthMm).toBeCloseTo(210, 1);
    expect(cover.pageHeightMm).toBeCloseTo(297, 1);
    expect(cover.marginTopMm).toBeCloseTo(25.4, 1);
    expect(cover.marginBottomMm).toBeCloseTo(25.4, 1);
    expect(cover.marginLeftMm).toBeCloseTo(31.75, 1);
    expect(cover.marginRightMm).toBeCloseTo(31.75, 1);
  });

  it('leaves the geometry fields absent without a sectPr (backward compatible)', async () => {
    const file = await buildDocxBlob({
      documentXml: '<w:p><w:r><w:t>Plain cover</w:t></w:r></w:p>',
    });
    const cover = await importCoverDocx(file);
    expect(cover.bodyXml).toContain('Plain cover');
    expect(cover.pageWidthMm).toBeUndefined();
    expect(cover.pageHeightMm).toBeUndefined();
    expect(cover.marginTopMm).toBeUndefined();
    expect(cover.marginBottomMm).toBeUndefined();
    expect(cover.marginLeftMm).toBeUndefined();
    expect(cover.marginRightMm).toBeUndefined();
  });

  it('captures geometry even when the body uses auxiliary namespaces (w14 attrs)', async () => {
    const file = await buildDocxBlob({
      documentXml:
        '<w:p w14:paraId="ABC123" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">' +
        '<w:r><w:t>Geo</w:t></w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
    });
    const cover = await importCoverDocx(file);
    // US Letter: 12240×15840 twips = 216×280mm (with rounding).
    expect(cover.pageWidthMm).toBeCloseTo(215.9, 1);
    expect(cover.pageHeightMm).toBeCloseTo(279.4, 1);
    expect(cover.marginLeftMm).toBeCloseTo(25.4, 1);
  });
});

/* ------------------------------------------------------------------ */
/* importCoverDocx — manual page break inside a paragraph (regression) */
/* ------------------------------------------------------------------ */

describe('importCoverDocx in-paragraph page-break repair (§42 regression)', () => {
  /** Page-1 paragraph whose manual break (Ctrl+Enter form) sits INSIDE it:
   *  <w:p>…run "first page tail"… <w:br w:type="page"/> …run "second page"… </w:p> */
  const BREAK_BODY_XML =
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
    '<w:r><w:rPr><w:b/></w:rPr><w:t>first page tail</w:t></w:r>' +
    '<w:br w:type="page"/>' +
    '<w:r><w:t>second page content</w:t></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';

  async function importBreakCover(): Promise<CoverPageAsset> {
    return importCoverDocx(await buildDocxBlob({ documentXml: BREAK_BODY_XML }));
  }

  it('cuts at the break and closes the open paragraph — well-formed XML', async () => {
    const cover = await importBreakCover();
    expect(cover.truncated).toBe(true);
    // Page-1 content kept; page-2 content dropped.
    expect(cover.bodyXml).toContain('first page tail');
    expect(cover.bodyXml).not.toContain('second page content');
    // The previously-lost close tags are repaired.
    expect(cover.bodyXml.endsWith('</w:p>')).toBe(true);
    expect(cover.bodyXml).not.toMatch(/<w:br\b[^>]*w:type="page"/);
    // Parses cleanly as XML (what both the DOCX splice and the PDF renderer
    // rely on).
    const dom = new DOMParser().parseFromString(
      `<w:coverbody xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${cover.bodyXml}</w:coverbody>`,
      'application/xml',
    );
    expect(dom.getElementsByTagName('parsererror')).toHaveLength(0);
  });

  it('renderCoverToPdf succeeds on the repaired cover (was parsererror → skipped)', async () => {
    const cover = await importBreakCover();
    const { pdf, calls } = makeInstrumentedPdf('mm');
    expect(() => renderCoverToPdf(pdf, cover, A4_GEO)).not.toThrow();
    expect(drawnWords(calls)).toContain('first page tail');
    expect(drawnWords(calls)).not.toContain('second page content');
  });
});

/* ------------------------------------------------------------------ */
/* applyCoverToDocx — namespace + well-formedness (§42 regression)     */
/* ------------------------------------------------------------------ */

describe('applyCoverToDocx splice validity (§42 regression)', () => {
  /** Cover with an IMAGE (wp:/a:/pic: prefixed elements) whose manual page
   *  break sits INSIDE the last paragraph — the exact combination that used
   *  to produce a corrupt document.xml (unclosed <w:p> + unbound wp/a/pic
   *  prefixes after the splice). */
  const IMG_BREAK_BODY_XML =
    '<w:p><w:r><w:t>Image cover</w:t></w:r></w:p>' +
    '<w:p><w:r><w:drawing><wp:extent cx="914400" cy="914400"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="img"/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdCov1"/></pic:blipFill>' +
    '<pic:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic>' +
    '</w:drawing></w:r></w:p>' +
    '<w:p><w:r><w:t>before break</w:t></w:r><w:br w:type="page"/><w:r><w:t>after break</w:t></w:r></w:p>';
  const IMG_RELS_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdCov1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
    '</Relationships>';
  const TARGET_DOCUMENT_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<w:body><w:p><w:r><w:t>body content</w:t></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';

  async function buildSplicedDocx(): Promise<{ docXml: string; files: string[] }> {
    const cover = await importCoverDocx(
      await buildDocxBlob({
        documentXml: IMG_BREAK_BODY_XML,
        relsXml: IMG_RELS_XML,
        media: { 'word/media/image1.png': PNG_BYTES },
      }),
    );
    const zip = new JSZip();
    zip.file('word/document.xml', TARGET_DOCUMENT_XML);
    zip.file(
      'word/_rels/document.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>',
    );
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    );
    const spliced = await applyCoverToDocx(await zip.generateAsync({ type: 'blob' }), cover);
    const out = await JSZip.loadAsync(await spliced.arrayBuffer());
    const docXml = (await out.file('word/document.xml')?.async('string')) ?? '';
    return { docXml, files: Object.keys(out.files) };
  }

  it('splices to a namespace-well-formed document.xml (no parsererror)', async () => {
    const { docXml } = await buildSplicedDocx();
    const dom = new DOMParser().parseFromString(docXml, 'application/xml');
    expect(dom.getElementsByTagName('parsererror')).toHaveLength(0);
  });

  it('re-declares the cover-only namespaces (wp/a/pic) on the target root', async () => {
    const { docXml } = await buildSplicedDocx();
    const root = /<w:document\b[^>]*>/.exec(docXml)?.[0] ?? '';
    expect(root).toContain('xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"');
    expect(root).toContain('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"');
    expect(root).toContain('xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"');
    // Already-declared prefixes are NOT duplicated.
    expect(root.match(/xmlns:w="/g)).toHaveLength(1);
  });

  it('keeps the cover, the remapped image rel and the original body', async () => {
    const { docXml, files } = await buildSplicedDocx();
    expect(docXml).toContain('Image cover');
    expect(docXml).toContain('before break');
    expect(docXml).not.toContain('after break'); // page-2 content dropped
    expect(docXml).toContain('body content');
    // Rel id remapped to a collision-free id and the media part copied.
    expect(docXml).toMatch(/r:embed="rIdCov\d+"/);
    expect(files).toContain('word/media/cover-1.png');
  });
});

/* ------------------------------------------------------------------ */
/* pdfExporter integration                                             */
/* ------------------------------------------------------------------ */

function tinyModel(overrides?: Partial<DocumentModel['options']>): DocumentModel {
  const options = {
    ...defaultDocumentOptions(),
    includeFrontMatter: false,
    includeToc: false,
    includeProjectStructure: false,
    showFileHeaders: false,
    ...overrides,
  };
  return {
    metadata: { title: 'Cover Integration' },
    options,
    projects: [
      {
        id: 'p1',
        label: 'proj',
        folderName: 'proj',
        structurePaths: ['a.txt'],
        files: [
          {
            projectId: 'p1',
            projectLabel: 'proj',
            relativePath: 'a.txt',
            language: 'text',
            sizeBytes: 10,
            highlighted: {
              fileId: 'f1',
              relativePath: 'a.txt',
              language: 'text',
              lines: [
                { lineNumber: 1, text: 'hello cover', tokens: [{ start: 0, length: 11, scopes: [], color: '#24292e' }] },
              ],
            },
          },
        ],
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

/** MediaBox sizes of every page, in page order. */
async function pdfPageBoxes(blob: Blob): Promise<Array<[number, number]>> {
  const s = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  const boxes = Array.from(s.matchAll(/MediaBox\s*\[([\d.\s]+)\]/g)).map((m) => {
    const nums = m[1].trim().split(/\s+/).map(Number);
    return [nums[2], nums[3]] as [number, number];
  });
  return boxes;
}

describe('pdfExporter cover integration (§42)', () => {
  it('prepends the cover as page 1 with the cover\'s own page geometry', async () => {
    // Letter cover (216×279mm) on an A4 export → page 1 Letter, content A4.
    const cover = makeCover({ pageWidthMm: 215.9, pageHeightMm: 279.4 });
    const result = await pdfExporter.export(tinyModel(), {
      format: 'pdf',
      filename: 'cover-int',
      cover,
    });
    expect(result.filename).toBe('cover-int.pdf');
    const boxes = await pdfPageBoxes(result.blob);
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    expect(boxes[0][0]).toBeCloseTo(215.9 * (72 / 25.4), 0); // 612pt Letter
    expect(boxes[0][1]).toBeCloseTo(279.4 * (72 / 25.4), 0); // 792pt Letter
    expect(boxes[1][0]).toBeCloseTo(595.28, 0); // A4 content page
    expect(boxes[1][1]).toBeCloseTo(841.89, 0);
  });

  it('adds exactly one page over the same export without a cover', async () => {
    const model = tinyModel();
    const bare = await pdfExporter.export(model, { format: 'pdf', filename: 'bare' });
    const withCover = await pdfExporter.export(model, {
      format: 'pdf',
      filename: 'covered',
      cover: makeCover(),
    });
    const bareBoxes = await pdfPageBoxes(bare.blob);
    const coverBoxes = await pdfPageBoxes(withCover.blob);
    expect(coverBoxes.length).toBe(bareBoxes.length + 1);
  });

  it('degrades to an export WITHOUT the cover when rendering fails', async () => {
    const broken = makeCover({ bodyXml: '<w:p><w:t>broken' });
    const result = await pdfExporter.export(tinyModel(), {
      format: 'pdf',
      filename: 'broken-cover',
      cover: broken,
    });
    expect(result.blob.size).toBeGreaterThan(0);
    // The fallback is signalled so the UI can warn for this export.
    expect(result.coverSkipped).toBe(true);
    // No extra page: the cover fell back to nothing.
    const bare = await pdfExporter.export(tinyModel(), { format: 'pdf', filename: 'bare2' });
    const resultBoxes = await pdfPageBoxes(result.blob);
    const bareBoxes = await pdfPageBoxes(bare.blob);
    expect(resultBoxes.length).toBe(bareBoxes.length);
  });

  it('does not flag coverSkipped on a clean export (with or without a cover)', async () => {
    const bare = await pdfExporter.export(tinyModel(), { format: 'pdf', filename: 'clean1' });
    expect(bare.coverSkipped).toBeUndefined();
    const covered = await pdfExporter.export(tinyModel(), {
      format: 'pdf',
      filename: 'clean2',
      cover: makeCover(),
    });
    expect(covered.coverSkipped).toBeUndefined();
  });
});
