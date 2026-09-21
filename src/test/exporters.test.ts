import { describe, expect, it } from 'vitest';
import { docxExporter } from '../lib/exporters/docxExporter';
import { odtExporter } from '../lib/exporters/odtExporter';
import { pdfExporter } from '../lib/exporters/pdfExporter';
import type { DocumentModel, DocumentOptions, HighlightedFile } from '@/types';
import { defaultDocumentOptions } from '@/lib/defaultOptions';

/** Build a minimal document model with one project / one file. */
function buildModel(opts?: Partial<DocumentOptions>): DocumentModel {
  const options = { ...defaultDocumentOptions(), ...opts };
  const highlighted: HighlightedFile = {
    fileId: 'f1',
    relativePath: 'src/Main.java',
    language: 'java',
    lines: [
      {
        lineNumber: 1,
        text: 'public class Main {',
        tokens: [
          {
            start: 0,
            length: 6,
            scopes: [],
            color: '#ff7b72',
            bold: true,
          },
          {
            start: 7,
            length: 5,
            scopes: [],
            color: '#ff7b72',
            bold: true,
          },
          {
            start: 13,
            length: 4,
            scopes: [],
            color: '#d2a8ff',
          },
        ],
      },
      {
        lineNumber: 2,
        text: '    public static void main(String[] args) {',
        tokens: [
          {
            start: 4,
            length: 6,
            scopes: [],
            color: '#ff7b72',
            bold: true,
          },
        ],
      },
      {
        lineNumber: 3,
        text: '        System.out.println("Hello");',
        tokens: [],
      },
      {
        lineNumber: 4,
        text: '    }',
        tokens: [],
      },
      {
        lineNumber: 5,
        text: '}',
        tokens: [],
      },
    ],
  };

  return {
    metadata: {
      title: 'Test Project',
      author: 'Test Author',
    },
    options,
    projects: [
      {
        id: 'p1',
        label: 'TestProject',
        folderName: 'TestProject',
        files: [
          {
            projectId: 'p1',
            projectLabel: 'TestProject',
            relativePath: 'src/Main.java',
            language: 'java',
            highlighted,
            sizeBytes: 1024,
          },
        ],
        structurePaths: ['src/Main.java'],
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

/** Read a Blob's first bytes safely (jsdom's Blob may not have arrayBuffer()). */
async function readFirstBytes(blob: Blob, n: number): Promise<Uint8Array> {
  const slice = blob.slice(0, n);
  // Try arrayBuffer first; fall back to FileReader.
  if (typeof (slice as any).arrayBuffer === 'function') {
    const buf = await (slice as any).arrayBuffer();
    return new Uint8Array(buf);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      resolve(new Uint8Array(buf));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(slice);
  });
}

describe('docxExporter', () => {
  it('exports a valid .docx blob', async () => {
    const model = buildModel();
    const result = await docxExporter.export(model, {
      format: 'docx',
      filename: 'test-doc',
    });
    expect(result.format).toBe('docx');
    expect(result.filename).toBe('test-doc.docx');
    expect(result.blob.size).toBeGreaterThan(0);
    // DOCX files start with the PK ZIP signature.
    const buf = await readFirstBytes(result.blob, 2);
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4b); // K
  }, 30000);

  it('resolves header tokens ({title}/{author}/{files}) in header1.xml', async () => {
    const model = buildModel({
      pageHeaderShow: true,
      pageHeaderLayout: 'single',
      pageHeaderCenter: '{title} — {author} — {files} files',
    });
    const result = await docxExporter.export(model, {
      format: 'docx',
      filename: 'tokens',
    });
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const header = await zip.file('word/header1.xml')!.async('string');
    expect(header).toContain('Test Project');
    expect(header).toContain('Test Author');
    // {files} resolves in its own run ('1') followed by the literal ' files'.
    expect(header).toMatch(/>1<\/w:t>/);
    expect(header).toContain('files');
    // No raw token text may leak into the output.
    expect(header).not.toContain('{title}');
    expect(header).not.toContain('{author}');
    expect(header).not.toContain('{files}');
  }, 30000);

  it('emits live PAGE fields for {page}/{pages} in footer text templates', async () => {
    const model = buildModel({
      pageFooterShow: true,
      pageFooterLayout: 'single',
      pageFooterCenter: 'text',
      pageFooterText: 'Page {page} of {pages}',
    });
    const result = await docxExporter.export(model, {
      format: 'docx',
      filename: 'fields',
    });
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const footer = await zip.file('word/footer1.xml')!.async('string');
    expect(footer).toContain('Page ');
    expect(footer).toContain(' of ');
    expect(footer).toMatch(/PAGE/);
    expect(footer).toMatch(/NUMPAGES/);
  }, 30000);
});

describe('pdfExporter', () => {
  it('exports a valid PDF blob', async () => {
    const model = buildModel();
    const result = await pdfExporter.export(model, {
      format: 'pdf',
      filename: 'test-doc',
    });
    expect(result.format).toBe('pdf');
    expect(result.filename).toBe('test-doc.pdf');
    expect(result.blob.size).toBeGreaterThan(0);
    // PDF files start with %PDF
    const buf = await readFirstBytes(result.blob, 5);
    const header = new TextDecoder().decode(buf);
    expect(header.startsWith('%PDF')).toBe(true);
  }, 30000);
});

describe('odtExporter', () => {
  it('exports a valid ODT blob', async () => {
    const model = buildModel();
    const result = await odtExporter.export(model, {
      format: 'odt',
      filename: 'test-doc',
    });
    expect(result.format).toBe('odt');
    expect(result.filename).toBe('test-doc.odt');
    expect(result.blob.size).toBeGreaterThan(0);
    // ODT files are ZIP archives — start with PK.
    const buf = await readFirstBytes(result.blob, 2);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  }, 30000);

  it('resolves header tokens and keeps {page} as a live field in styles.xml', async () => {
    const model = buildModel({
      pageHeaderShow: true,
      pageHeaderLayout: 'single',
      pageHeaderCenter: '{title} · page {page}',
    });
    const result = await odtExporter.export(model, {
      format: 'odt',
      filename: 'tokens',
    });
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const styles = await zip.file('styles.xml')!.async('string');
    // Static token resolved from model metadata…
    expect(styles).toContain('Test Project');
    expect(styles).not.toContain('{title}');
    // …while {page} stays a live OpenDocument page-number field.
    expect(styles).toContain('text:page-number');
  }, 30000);
});
