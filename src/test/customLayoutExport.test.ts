/**
 * Custom layout + per-file details/images export tests (spec §8/§12/§35).
 *
 * Covers:
 *   1. DOCX custom layout stream — headings, labeled blocks, spacers, page
 *      breaks, embedded images (real media parts), panel + columns tables.
 *   2. DOCX standard flow — Description/Summary/Note labels around the code
 *      block + attached images; a file WITHOUT details produces no labels.
 *   3. PDF — custom layout + standard flow (text layer + page count + image
 *      XObject).
 *   4. ODT — draw:image frame + Pictures/ ZIP entry + manifest registration
 *      + panel/columns tables + labeled labels.
 *   5. Regression — a model without customLayout/details/images must not
 *      contain any of the new labels or media in any format.
 *
 * The image used everywhere is a 4x4 PNG data URL so the embedded bytes are
 * deterministic and tiny.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { docxExporter } from '../lib/exporters/docxExporter';
import { pdfExporter } from '../lib/exporters/pdfExporter';
import { odtExporter } from '../lib/exporters/odtExporter';
import type {
  DocumentFile,
  DocumentImage,
  DocumentModel,
  DocumentOptions,
  FileDetails,
  ResolvedLayoutBlock,
} from '@/types';
import { defaultDocumentOptions } from '@/lib/defaultOptions';
import { buildProjectsModel, makeHighlightedFile } from './helpers/exportModels';

/** Tiny valid 4x4 PNG (1 red pixel row) — embedded as REAL bytes. */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mP8z8AARIQBExMDDQMDAwCVAgVDPMSZAAAAAElFTkSuQmCC';

/**
 * A 4x4 PNG with a WELL-FORMED zlib stream. jsPDF must DECODE PNGs (unlike
 * DOCX/ODT which embed the raw bytes), and the fixture above — while
 * accepted by lenient browser decoders — has a corrupt IDAT that standard
 * inflaters (jsPDF's fflate, node zlib) reject. Real user images can never
 * hit this: they are re-encoded by the browser canvas at import time.
 */
const VALID_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAP0lEQVR42gE0AMv/AAD/gDzXlHivqLSHvAAK/4BG15SCr6i+h7wAFP+AUNeUjK+oyIe8AB7/gFrXlJavqNKHvNG6HKF5IX2RAAAAAElFTkSuQmCC';

const TINY_IMAGE: DocumentImage = {
  id: 'img-1',
  name: 'tiny.png',
  dataUrl: TINY_PNG,
  mime: 'image/png',
  width: 4,
  height: 4,
  caption: 'Attached caption',
};

/** A full resolved custom-layout stream exercising every block kind. */
function layoutBlocks(dataUrl: string = TINY_PNG): ResolvedLayoutBlock[] {
  return [
    { kind: 'heading', level: 2, text: 'System Overview' },
    { kind: 'labeled', label: 'Description', text: 'A labeled intro paragraph.' },
    { kind: 'paragraph', text: 'Body text of the layout.' },
    { kind: 'spacer', heightPt: 12 },
    {
      kind: 'image',
      imageId: 'img-1',
      name: 'tiny.png',
      dataUrl,
      mime: 'image/png',
      width: 4,
      height: 4,
      caption: 'A tiny image',
      captionVisible: true,
      align: 'center',
    },
    { kind: 'pageBreak' },
    {
      kind: 'panel',
      fillColor: '#fff8e1',
      borderColor: '#f0c674',
      borderWidthPt: 1,
      radiusPt: 6,
      paddingPt: 10,
      children: [{ kind: 'paragraph', text: 'Inside the panel.' }],
    },
    {
      kind: 'columns',
      count: 2,
      columns: [
        [{ kind: 'paragraph', text: 'Left column text.' }],
        [{ kind: 'paragraph', text: 'Right column text.' }],
      ],
    },
  ];
}

/** Build a one-project/one-file model with the custom layout attached. */
function customLayoutModel(
  blocks: ResolvedLayoutBlock[],
  opts?: Partial<DocumentOptions>,
): DocumentModel {
  const model = buildProjectsModel(
    [
      {
        label: 'Alpha',
        files: [
          {
            path: 'src/Main.java',
            language: 'java',
            highlighted: makeHighlightedFile('src/Main.java', 'class Main {\n    int x = 1;\n}\n'),
          },
        ],
      },
    ],
    opts,
  );
  model.customLayout = {
    templateId: 't1',
    templateName: 'QA Template',
    blocks,
  };
  return model;
}

/** Build a plain standard-flow model, optionally attaching details/images. */
function standardModel(
  details?: FileDetails,
  images?: DocumentImage[],
  opts?: Partial<DocumentOptions>,
): DocumentModel {
  const model = buildProjectsModel(
    [
      {
        label: 'Alpha',
        files: [
          {
            path: 'src/Main.java',
            language: 'java',
            highlighted: makeHighlightedFile('src/Main.java', 'class Main {\n    int x = 1;\n}\n'),
          },
        ],
      },
    ],
    opts,
  );
  const file: DocumentFile = model.projects[0].files[0];
  if (details) file.details = details;
  if (images && images.length > 0) file.images = images;
  return model;
}

/** Parse XML and fail loudly when the payload is not well-formed. */
function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const errors = doc.getElementsByTagName('parsererror');
  if (errors.length > 0) {
    throw new Error(`Malformed XML: ${errors[0].textContent?.slice(0, 300)}`);
  }
  return doc;
}

async function unzip(blob: Blob): Promise<JSZip> {
  return JSZip.loadAsync(await blob.arrayBuffer());
}

const EXPORT = { format: 'docx' as const, filename: 'qa' };

describe('DOCX — custom layout stream (spec §35)', () => {
  it('renders headings, labels, tables, media and page breaks', async () => {
    const result = await docxExporter.export(customLayoutModel(layoutBlocks()), EXPORT);
    const zip = await unzip(result.blob);
    const doc = await zip.file('word/document.xml')!.async('string');

    // Heading + labeled text.
    expect(doc).toContain('System Overview');
    expect(doc).toContain('DESCRIPTION');
    expect(doc).toContain('A labeled intro paragraph.');
    expect(doc).toContain('Body text of the layout.');

    // The image is embedded as a REAL binary media part (not a URL).
    // (word/media/ itself appears as a JSZip directory entry — skip those.)
    const mediaNames = Object.keys(zip.files).filter(
      (n) => n.startsWith('word/media/') && !zip.files[n].dir,
    );
    expect(mediaNames.length).toBe(1);
    const mediaBytes = await zip.file(mediaNames[0])!.async('uint8array');
    expect(mediaBytes.length).toBeGreaterThan(10);
    expect(doc).not.toContain('data:image');

    // Panel + columns render as tables.
    expect(doc.match(/<w:tbl>/g) ?? []).toHaveLength(2);
    expect(doc).toContain('Inside the panel.');
    expect(doc).toContain('Left column text.');
    expect(doc).toContain('Right column text.');

    // Hard page break block.
    expect(doc).toContain('<w:br w:type="page"/>');
  }, 30000);

  it('fileHeader + code blocks reuse the standard machinery (syntax + header)', async () => {
    const model = customLayoutModel([
      { kind: 'projectHeader', projectId: 'p1' },
      { kind: 'fileHeader', projectId: 'p1', fileId: 'src/Main.java' },
      { kind: 'code', projectId: 'p1', fileId: 'src/Main.java' },
    ]);
    const result = await docxExporter.export(model, EXPORT);
    const zip = await unzip(result.blob);
    const doc = await zip.file('word/document.xml')!.async('string');
    // The project header + the standard file header strip.
    expect(doc).toContain('1. Alpha');
    expect(doc).toContain('src/Main.java');
    expect(doc).toContain('Java');
    // The code text renders (same buildCodeLine machinery as standard flow).
    expect(doc).toContain('class Main');
  }, 30000);

  it('metadata / toc / projectHeader blocks reuse the standard builders', async () => {
    const model = customLayoutModel([
      { kind: 'metadata' },
      { kind: 'pageBreak' },
      { kind: 'toc' },
      { kind: 'pageBreak' },
      { kind: 'projectHeader', projectId: 'p1' },
    ]);
    const result = await docxExporter.export(model, EXPORT);
    const zip = await unzip(result.blob);
    const doc = await zip.file('word/document.xml')!.async('string');
    expect(doc).toContain('Preview Model');
    expect(doc).toContain('Table of Contents');
    expect(doc).toContain('1. Alpha');
  }, 30000);
});

describe('DOCX — standard flow details + images (spec §8/§12)', () => {
  it('renders Description before / Summary+Note after the code, and embeds images', async () => {
    const model = standardModel(
      {
        description: 'File description text.',
        summary: 'File summary text.',
        note: 'File note text.',
      },
      [TINY_IMAGE],
    );
    const result = await docxExporter.export(model, EXPORT);
    const zip = await unzip(result.blob);
    const doc = await zip.file('word/document.xml')!.async('string');

    // Labels render uppercase (the label content itself is uppercase).
    expect(doc).toMatch(/Description/i);
    expect(doc).toMatch(/Summary/i);
    expect(doc).toMatch(/Note/i);

    // Ordering: description label BEFORE the code, summary/note AFTER it.
    const descIdx = doc.indexOf('DESCRIPTION');
    const codeIdx = doc.indexOf('class Main');
    const sumIdx = doc.indexOf('SUMMARY');
    const noteIdx = doc.indexOf('NOTE');
    expect(descIdx).toBeGreaterThan(-1);
    expect(codeIdx).toBeGreaterThan(descIdx);
    expect(sumIdx).toBeGreaterThan(codeIdx);
    expect(noteIdx).toBeGreaterThan(sumIdx);

    // Caption + real media part.
    expect(doc).toContain('Attached caption');
    const mediaNames = Object.keys(zip.files).filter(
      (n) => n.startsWith('word/media/') && !zip.files[n].dir,
    );
    expect(mediaNames.length).toBe(1);
    expect((await zip.file(mediaNames[0])!.async('uint8array')).length).toBeGreaterThan(10);
  }, 30000);

  it('a file WITHOUT details/images produces no labels and no media', async () => {
    const model = standardModel();
    const result = await docxExporter.export(model, EXPORT);
    const zip = await unzip(result.blob);
    const doc = await zip.file('word/document.xml')!.async('string');
    expect(doc).not.toMatch(/DESCRIPTION/);
    expect(doc).not.toMatch(/SUMMARY/);
    expect(doc).not.toMatch(/NOTE/);
    const mediaNames = Object.keys(zip.files).filter(
      (n) => n.startsWith('word/media/') && !zip.files[n].dir,
    );
    expect(mediaNames).toHaveLength(0);
  }, 30000);
});

describe('PDF — custom layout + standard flow', () => {
  it('renders the custom layout stream and honors the pageBreak block', async () => {
    // jsPDF must decode the PNG — use the well-formed fixture (see above).
    const result = await pdfExporter.export(customLayoutModel(layoutBlocks(VALID_PNG)), {
      format: 'pdf',
      filename: 'qa',
    });
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF')).toBe(true);

    // Text layer: heading, label, paragraph and both columns are present.
    expect(text).toContain('System Overview');
    expect(text).toContain('DESCRIPTION');
    expect(text).toContain('A labeled intro paragraph.');
    expect(text).toContain('Inside the panel.');
    expect(text).toContain('Left column text.');
    expect(text).toContain('Right column text.');

    // The image is embedded as real pixels (an image XObject exists).
    expect(text).toContain('/Subtype /Image');

    // The pageBreak block forces a second page.
    const pages = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(2);
  }, 30000);

  it('renders details + embedded image in the standard flow', async () => {
    const model = standardModel(
      { description: 'File description text.', summary: 'File summary text.', note: 'File note text.' },
      [{ ...TINY_IMAGE, dataUrl: VALID_PNG }],
    );
    const result = await pdfExporter.export(model, { format: 'pdf', filename: 'qa' });
    const text = new TextDecoder('latin1').decode(new Uint8Array(await result.blob.arrayBuffer()));
    expect(text).toContain('DESCRIPTION');
    expect(text).toContain('SUMMARY');
    expect(text).toContain('NOTE');
    expect(text).toContain('/Subtype /Image');
    // No exception + image never overlaps the footer: hard to assert
    // geometrically here — the ensureSpace path is exercised by the run.
  }, 30000);

  it('baseline PDF without details/layout has no labels or images', async () => {
    const result = await pdfExporter.export(standardModel(), { format: 'pdf', filename: 'qa' });
    const text = new TextDecoder('latin1').decode(new Uint8Array(await result.blob.arrayBuffer()));
    expect(text).not.toContain('DESCRIPTION');
    expect(text).not.toContain('SUMMARY');
    expect(text).not.toContain('NOTE');
    expect(text).not.toContain('/Subtype /Image');
  }, 30000);
});

describe('ODT — custom layout stream + pictures', () => {
  it('embeds pictures under Pictures/ with manifest entries and renders tables/labels', async () => {
    const result = await odtExporter.export(customLayoutModel(layoutBlocks()), {
      format: 'odt',
      filename: 'qa',
    });
    const zip = await unzip(result.blob);
    const content = await zip.file('content.xml')!.async('string');
    parseXml(content); // well-formed

    expect(content).toContain('System Overview');
    expect(content).toContain('DESCRIPTION');
    expect(content).toContain('Body text of the layout.');

    // Image frame references the ZIP picture.
    expect(content).toContain('draw:frame');
    expect(content).toContain('xlink:href="Pictures/img-img-1.png"');

    // The picture bytes exist in the archive (real pixels, length > 0).
    const pic = zip.file('Pictures/img-img-1.png');
    expect(pic).toBeTruthy();
    expect((await pic!.async('uint8array')).length).toBeGreaterThan(0);

    // Manifest lists the picture file entry.
    const manifest = await zip.file('META-INF/manifest.xml')!.async('string');
    expect(manifest).toContain('Pictures/img-img-1.png');

    // Panel + columns render as ODF tables.
    expect(content.match(/<table:table /g) ?? []).toHaveLength(2);
    expect(content).toContain('Inside the panel.');
    expect(content).toContain('Left column text.');
    expect(content).toContain('Right column text.');
  }, 30000);

  it('standard flow: details + image render around the code block; baseline does not', async () => {
    const withDetails = standardModel(
      { description: 'File description text.', summary: 'File summary text.', note: 'File note text.' },
      [TINY_IMAGE],
    );
    const result = await odtExporter.export(withDetails, { format: 'odt', filename: 'qa' });
    const zip = await unzip(result.blob);
    const content = await zip.file('content.xml')!.async('string');
    parseXml(content);

    expect(content).toContain('DESCRIPTION');
    expect(content).toContain('SUMMARY');
    expect(content).toContain('NOTE');
    const descIdx = content.indexOf('DESCRIPTION');
    const codeIdx = content.indexOf('class Main');
    const sumIdx = content.indexOf('SUMMARY');
    expect(descIdx).toBeGreaterThan(-1);
    expect(codeIdx).toBeGreaterThan(descIdx);
    expect(sumIdx).toBeGreaterThan(codeIdx);

    expect(content).toContain('draw:frame');
    expect(zip.file('Pictures/img-img-1.png')).toBeTruthy();
    const manifest = await zip.file('META-INF/manifest.xml')!.async('string');
    expect(manifest).toContain('Pictures/img-img-1.png');

    // Regression: same model WITHOUT details/images → no labels, no media.
    const baseline = await odtExporter.export(standardModel(), { format: 'odt', filename: 'qa' });
    const baseZip = await unzip(baseline.blob);
    const baseContent = await baseZip.file('content.xml')!.async('string');
    parseXml(baseContent);
    expect(baseContent).not.toContain('DESCRIPTION');
    expect(baseContent).not.toContain('SUMMARY');
    expect(baseContent).not.toContain('NOTE');
    expect(baseContent).not.toContain('draw:frame');
    expect(Object.keys(baseZip.files).some((n) => n.startsWith('Pictures/'))).toBe(false);
    expect((await baseZip.file('META-INF/manifest.xml')!.async('string'))).not.toContain('Pictures/');
  }, 30000);
});
