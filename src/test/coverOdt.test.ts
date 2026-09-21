/**
 * Cover-page ODT rendering tests (§42 — ODT extension).
 *
 * renderCoverToOdt() flow-renders an imported cover's first-page OOXML into
 * ODF body XML + automatic styles + picture entries. The renderer itself is
 * a PURE function, so its tests assert directly on the returned XML string
 * (paragraph styles CovP/CovT, <draw:frame> EMU→cm geometry, base64
 * payload, <table:table> cells, whitespace preservation, page-break
 * cutoff). The odtExporter integration is covered through the real ZIP:
 * cover prepended before the body content, Pictures/ entry + manifest
 * registration, namespace declarations, page break after the cover and the
 * coverSkipped fallback contract.
 *
 * Fixtures mirror coverPdf.test.ts (hand-built CoverPageAsset + a minimal
 * .docx built in-test through JSZip for the import-pipeline regression) —
 * defined locally, not imported.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { renderCoverToOdt } from '../lib/coverOdt';
import { odtExporter } from '../lib/exporters/odtExporter';
import { importCoverDocx } from '../lib/coverPages';
import type { CoverPageAsset, DocumentModel } from '@/types';
import { defaultDocumentOptions } from '../lib/defaultOptions';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** Known-good 1×1 PNG (byte-for-byte). */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_BYTES = Uint8Array.from(
  Array.from(atob(PNG_B64), (ch) => ch.charCodeAt(0)),
);

/** First-page OOXML: centered red bold heading with spacing, mixed-format
 * body paragraph (italic / bold / plain), a centered inline image (2in ×
 * 1in), a whitespace-preserving run, an in-paragraph line break and a
 * two-row table. */
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
  <w:r><w:t xml:space="preserve">A   B</w:t><w:br/><w:t>after break</w:t></w:r>
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

/** Distinct span style names referenced by the body XML, in order. */
function spanStyleRefs(bodyXml: string): string[] {
  return Array.from(bodyXml.matchAll(/<text:span text:style-name="(CovT\d+)">/g)).map(
    (m) => m[1],
  );
}

/* ------------------------------------------------------------------ */
/* renderCoverToOdt — emission                                         */
/* ------------------------------------------------------------------ */

describe('renderCoverToOdt (emission)', () => {
  const render = renderCoverToOdt(makeCover());

  it('renders paragraphs as <text:p> with interned CovP/CovT styles', () => {
    expect(render.bodyXml).toMatch(/^<text:p text:style-name="CovP\d+">/);
    expect(render.bodyXml).toContain('Quarterly Report');
    expect(render.bodyXml).toContain('Prepared by ');
    expect(render.bodyXml).toContain('Codice');
    // The trailing run's w:t lacks xml:space="preserve" → its leading
    // space is trimmed by the OOXML rules (same as the PDF renderer).
    expect(render.bodyXml).toContain('team');
    expect(render.bodyXml).toMatch(/<text:span text:style-name="CovT\d+">/);
    // Automatic styles travel with the fragment.
    expect(render.stylesXml).toMatch(/style:name="CovP\d+"/);
    expect(render.stylesXml).toMatch(/style:name="CovT\d+"/);
  });

  it('maps alignment + spacing into the paragraph style', () => {
    // w:jc center → fo:text-align="center"; 240/120 twips → 12pt/6pt →
    // 0.423cm / 0.212cm margins.
    expect(render.stylesXml).toContain('fo:text-align="center"');
    expect(render.stylesXml).toContain('fo:margin-top="0.423cm"');
    expect(render.stylesXml).toContain('fo:margin-bottom="0.212cm"');
    // Default paragraphs keep start alignment with no margins.
    expect(render.stylesXml).toContain('fo:text-align="start"');
  });

  it('maps character formatting: 32 half-points → 16pt, #FF0000 → #ff0000, bold, italic', () => {
    expect(render.stylesXml).toContain('fo:font-size="16pt"');
    expect(render.stylesXml).toContain('fo:color="#ff0000"');
    expect(render.stylesXml).toContain('fo:font-weight="bold"');
    expect(render.stylesXml).toContain('fo:font-style="italic"');
    expect(render.stylesXml).toContain('fo:font-family="Helvetica"');
    expect(render.stylesXml).toContain('fo:font-size="11pt"');
  });

  it('emits DISTINCT span styles for mixed-format runs', () => {
    const refs = spanStyleRefs(render.bodyXml);
    expect(refs.length).toBeGreaterThanOrEqual(4); // italic + bold + plain + heading
    expect(new Set(refs).size).toBeGreaterThanOrEqual(3);
    // The italic run and the plain run use different style names.
    expect(refs[0]).not.toBe(refs[1]);
    expect(refs[1]).not.toBe(refs[2]);
    expect(refs[0]).not.toBe(refs[2]);
  });

  it('embeds the image as an as-char frame with EMU→cm size + base64 payload', () => {
    // 1828800×914400 EMU = 2in×1in = 5.08cm×2.54cm.
    expect(render.bodyXml).toContain(
      '<draw:frame draw:style-name="CovFrame" text:anchor-type="as-char" svg:width="5.08cm" svg:height="2.54cm"',
    );
    expect(render.bodyXml).toContain('xlink:href="Pictures/cover-1.png"');
    expect(render.bodyXml).toContain(
      `<office:binary-data>${PNG_B64}</office:binary-data>`,
    );
    // The picture entry carries the raw bytes for the ZIP.
    expect(render.images).toHaveLength(1);
    expect(render.images[0].path).toBe('Pictures/cover-1.png');
    expect(render.images[0].mediaType).toBe('image/png');
    expect(Array.from(render.images[0].bytes)).toEqual(Array.from(PNG_BYTES));
    // The graphic frame style rides along.
    expect(render.stylesXml).toContain('style:name="CovFrame"');
    expect(render.stylesXml).toContain('style:family="graphic"');
  });

  it('builds a real <table:table> with per-cell paragraphs', () => {
    expect(render.usesTables).toBe(true);
    expect(render.bodyXml).toContain('<table:table>');
    expect(render.bodyXml).toContain(
      '<table:table-column table:number-columns-repeated="2"/>',
    );
    expect(render.bodyXml).toContain('<table:table-row>');
    expect(render.bodyXml).toContain('<table:table-cell>');
    // Cell text survives inside cell paragraphs.
    expect(render.bodyXml).toContain('Version');
    expect(render.bodyXml).toContain('1.0');
    expect(render.bodyXml).toContain('Date');
    expect(render.bodyXml).toContain('2025');
    expect(render.bodyXml).toMatch(/<table:table-cell><text:p text:style-name="CovP\d+">/);
  });

  it('preserves multi-space runs with <text:s> and line breaks with <text:line-break/>', () => {
    expect(render.bodyXml).toContain('<text:s text:c="3"/>');
    expect(render.bodyXml).toContain('A<text:s text:c="3"/>B');
    expect(render.bodyXml).toContain('<text:line-break/>');
    expect(render.bodyXml).toContain('after break');
  });

  it('drops everything after an explicit page break (the cover is one page)', () => {
    const bodyXml =
      '<w:p><w:r><w:t>first page line</w:t></w:r></w:p>' +
      '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
      '<w:p><w:r><w:t>second page content</w:t></w:r></w:p>';
    const out = renderCoverToOdt(makeCover({ bodyXml }));
    expect(out.bodyXml).toContain('first page line');
    expect(out.bodyXml).not.toContain('second page content');
  });
});

/* ------------------------------------------------------------------ */
/* renderCoverToOdt — degradation                                      */
/* ------------------------------------------------------------------ */

describe('renderCoverToOdt (degradation rules)', () => {
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
    expect(() => renderCoverToOdt(makeCover({ bodyXml }))).not.toThrow();
    const out = renderCoverToOdt(makeCover({ bodyXml }));
    expect(out.bodyXml).toContain('Title stays');
    expect(out.bodyXml).toContain('SDT subtitle survives');
    expect(out.bodyXml).not.toContain('hidden shape text');
    expect(out.bodyXml).not.toContain('never seen');
  });

  it('skips non-PNG/JPEG media bytes silently', () => {
    const bodyXml =
      '<w:p><w:r><w:drawing><wp:extent cx="914400" cy="914400"/>' +
      '<a:graphic><a:graphicData><a:blip r:embed="rIdCover1"/></a:graphicData></a:graphic>' +
      '</w:drawing></w:r></w:p>' +
      '<w:p><w:r><w:t>text after image</w:t></w:r></w:p>';
    const gifish = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0]);
    expect(() =>
      renderCoverToOdt(
        makeCover({
          bodyXml,
          media: [{ relId: 'rIdCover1', partPath: 'word/media/x.gif', bytes: gifish }],
        }),
      ),
    ).not.toThrow();
    const out = renderCoverToOdt(
      makeCover({
        bodyXml,
        media: [{ relId: 'rIdCover1', partPath: 'word/media/x.gif', bytes: gifish }],
      }),
    );
    expect(out.bodyXml).not.toContain('<draw:frame');
    expect(out.images).toHaveLength(0);
    expect(out.bodyXml).toContain('text after image');
  });

  it('throws only on unparseable XML (the exporter catches and drops the cover)', () => {
    expect(() => renderCoverToOdt(makeCover({ bodyXml: '<w:p><w:t>oops</w:t' }))).toThrow();
  });

  it('throws for an empty body (nothing renderable → exporter fallback)', () => {
    expect(() => renderCoverToOdt(makeCover({ bodyXml: '   ' }))).toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* renderCoverToOdt — imported cover regression                        */
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
  return new File([blob], 'cover.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

describe('renderCoverToOdt (imported cover regression)', () => {
  it('renders the repaired in-paragraph page-break cover (was parsererror territory)', async () => {
    // Page-1 paragraph whose manual break (Ctrl+Enter form) sits INSIDE it.
    const BREAK_BODY_XML =
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
      '<w:r><w:rPr><w:b/></w:rPr><w:t>first page tail</w:t></w:r>' +
      '<w:br w:type="page"/>' +
      '<w:r><w:t>second page content</w:t></w:r></w:p>';
    const cover = await importCoverDocx(await buildDocxBlob({ documentXml: BREAK_BODY_XML }));
    expect(() => renderCoverToOdt(cover)).not.toThrow();
    const out = renderCoverToOdt(cover);
    expect(out.bodyXml).toContain('first page tail');
    expect(out.bodyXml).not.toContain('second page content');
  });
});

/* ------------------------------------------------------------------ */
/* odtExporter integration                                             */
/* ------------------------------------------------------------------ */

function tinyModel(): DocumentModel {
  const options = {
    ...defaultDocumentOptions(),
    includeFrontMatter: false,
    includeToc: false,
    includeProjectStructure: false,
    showFileHeaders: false,
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
                {
                  lineNumber: 1,
                  text: 'hello cover',
                  tokens: [{ start: 0, length: 11, scopes: [], color: '#24292e' }],
                },
              ],
            },
          },
        ],
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

async function exportZip(
  model: DocumentModel,
  cover?: CoverPageAsset,
): Promise<{ content: string; manifest: string; zip: JSZip; result: { coverSkipped?: boolean; blob: Blob } }> {
  const result = await odtExporter.export(model, {
    format: 'odt',
    filename: 'cover-odt',
    ...(cover ? { cover } : {}),
  });
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  const content = await zip.file('content.xml')!.async('string');
  const manifest = await zip.file('META-INF/manifest.xml')!.async('string');
  return { content, manifest, zip, result };
}

describe('odtExporter cover integration (§42)', () => {
  it('prepends the cover before the body content with a page break after it', async () => {
    const { content } = await exportZip(tinyModel(), makeCover());
    // Cover text is the FIRST content after <office:text>, before the
    // generated project heading.
    const textOpen = content.indexOf('<office:text>');
    const coverText = content.indexOf('Quarterly Report');
    const bodyHeading = content.indexOf('1. proj');
    expect(coverText).toBeGreaterThan(textOpen);
    expect(coverText).toBeLessThan(bodyHeading);
    expect(bodyHeading).toBeGreaterThan(-1);
    // The document body itself still renders after the cover.
    expect(content).toContain('hello cover');
    // A hard page break separates cover and content (the only
    // fo:break-before in this configuration comes from the cover carrier).
    expect(content).toMatch(/fo:break-before="page"/);
    // The cover's automatic styles are registered in content.xml.
    expect(content).toMatch(/<office:automatic-styles>[^<]*<style:style style:name="CovP\d+"/);
    expect(content).toMatch(/style:name="CovT\d+"/);
    // The merged content.xml is namespace-well-formed XML (catches any
    // undeclared prefix the cover body might have dragged in).
    const dom = new DOMParser().parseFromString(content, 'application/xml');
    expect(dom.getElementsByTagName('parsererror')).toHaveLength(0);
  });

  it('embeds the cover image as a Pictures/ ZIP entry + manifest registration', async () => {
    const { manifest, zip, content } = await exportZip(tinyModel(), makeCover());
    const entry = zip.file('Pictures/cover-1.png');
    expect(entry).not.toBeNull();
    const bytes = await entry!.async('uint8array');
    expect(Array.from(bytes)).toEqual(Array.from(PNG_BYTES));
    expect(manifest).toContain('manifest:full-path="Pictures/cover-1.png"');
    expect(manifest).toContain('manifest:media-type="image/png"');
    // The content root declares the drawing namespaces (image present).
    expect(content).toContain('xmlns:draw=');
    expect(content).toContain('xmlns:svg=');
    expect(content).toContain('xlink:href="Pictures/cover-1.png"');
  });

  it('declares the table namespace when the cover has a table', async () => {
    const { content } = await exportZip(tinyModel(), makeCover());
    expect(content).toContain('<table:table>');
    expect(content).toContain('xmlns:table=');
  });

  it('degrades to an export WITHOUT the cover when rendering fails', async () => {
    const broken = makeCover({ bodyXml: '<w:p><w:t>broken' });
    const { content, result } = await exportZip(tinyModel(), broken);
    expect(result.blob.size).toBeGreaterThan(0);
    // The fallback is signalled so the UI can warn for this export.
    expect(result.coverSkipped).toBe(true);
    // No cover content: the document body is all there is.
    expect(content).not.toContain('Quarterly Report');
    expect(content).toContain('1. proj');
  });

  it('does not flag coverSkipped on a clean export (with or without a cover)', async () => {
    const bare = await exportZip(tinyModel());
    expect(bare.result.coverSkipped).toBeUndefined();
    const covered = await exportZip(tinyModel(), makeCover());
    expect(covered.result.coverSkipped).toBeUndefined();
  });
});
