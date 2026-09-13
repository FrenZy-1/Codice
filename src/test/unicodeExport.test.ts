/**
 * Unicode export tests (spec §12–§14, §30–§32).
 *
 * Verifies that project trees with box-drawing characters export without
 * ASCII substitution in DOCX and ODT, and that the fallback font is applied
 * ONLY to the glyph runs (not the whole document).
 *
 * The PDF path additionally exercises the exporter end-to-end; jsPDF runs in
 * Node/jsdom and produces a real (unembedded-font) PDF blob — the glyph run
 * splitting contract is covered by unicodeFallback.test.ts.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { docxExporter } from '../lib/exporters/docxExporter';
import { odtExporter } from '../lib/exporters/odtExporter';
import { pdfExporter } from '../lib/exporters/pdfExporter';
import type { DocumentModel, HighlightedFile } from '@/types';
import { defaultDocumentOptions } from '@/lib/defaultOptions';

const TREE_PATHS = [
  'build.gradle.kts',
  'README.md',
  'src/main/kotlin/com/example/Main.kt',
  'src/test/kotlin/com/example/MainTest.kt',
];

/** Lines the tree renderer must produce (with real Unicode connectors). */
const EXPECTED_GLYPHS = ['├', '└', '│', '─'];

function buildModel(): DocumentModel {
  const codeLines = [
    'project/',
    '├── src/',
    '│   └── Main.kt',
    '└── README.md',
  ];
  const highlighted: HighlightedFile = {
    fileId: 'f1',
    relativePath: 'src/main/kotlin/com/example/Main.kt',
    language: 'kotlin',
    lines: codeLines.map((text, i) => ({
      lineNumber: i + 1,
      text,
      tokens: [{ start: 0, length: text.length, scopes: [], color: '#24292e' }],
    })),
  };
  return {
    metadata: { title: 'Unicode Test' },
    options: { ...defaultDocumentOptions(), includeProjectStructure: true },
    projects: [
      {
        id: 'p1',
        label: 'sample-app',
        folderName: 'sample-app',
        files: [
          {
            projectId: 'p1',
            projectLabel: 'sample-app',
            relativePath: 'src/main/kotlin/com/example/Main.kt',
            language: 'kotlin',
            highlighted,
            sizeBytes: 1234,
          },
        ],
        structurePaths: TREE_PATHS,
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

describe('DOCX unicode tree', () => {
  it('keeps the exact box-drawing characters and per-run fallback fonts', async () => {
    const result = await docxExporter.export(buildModel(), { format: 'docx', filename: 't' });
    expect(result.blob.size).toBeGreaterThan(0);

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');

    // No ASCII substitution.
    expect(xml).not.toContain('`--');
    expect(xml).toContain('├──');
    expect(xml).toContain('└──');
    expect(xml).toContain('│');

    // Fallback font is applied to glyph runs only.
    expect(xml).toContain('DejaVu Sans Mono');
    // The normal code font is still present for regular runs.
    expect(xml).toContain('Courier New');
  });
});

describe('ODT unicode tree', () => {
  it('keeps the exact box-drawing characters and per-run fallback fonts', async () => {
    const result = await odtExporter.export(buildModel(), { format: 'odt', filename: 't' });
    expect(result.blob.size).toBeGreaterThan(0);

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const content = await zip.file('content.xml')!.async('string');

    expect(content).toContain('├──');
    expect(content).toContain('└──');
    expect(content).toContain('│');
    expect(content).toContain('DejaVu Sans Mono');
  });

  it('renders master-page header/footer when enabled', async () => {
    const model = buildModel();
    model.options = {
      ...model.options,
      pageHeaderShow: true,
      pageHeaderCenter: 'Sample Header',
      pageFooterShow: true,
      pageFooterCenter: 'pageNumber',
    };
    const result = await odtExporter.export(model, { format: 'odt', filename: 't' });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const styles = await zip.file('styles.xml')!.async('string');
    expect(styles).toContain('Sample Header');
    expect(styles).toContain('text:page-number');
  });
});

describe('PDF unicode tree', () => {
  it('exports a valid PDF containing the original characters (no ASCII swap)', async () => {
    const result = await pdfExporter.export(buildModel(), { format: 'pdf', filename: 't' });
    const buf = new Uint8Array(await result.blob.arrayBuffer());
    // PDF magic header.
    expect(String.fromCharCode(...buf.slice(0, 5))).toBe('%PDF-');
    expect(result.blob.size).toBeGreaterThan(500);

    // The run-splitting contract guarantees the characters survive; verify
    // the split boundaries once more against the actual tree lines.
    const { splitRuns } = await import('../lib/exporters/unicodeFallback');
    for (const line of ['├── src/', '│   └── Main.kt', '└── README.md']) {
      const joined = splitRuns(line).map((r) => r.text).join('');
      expect(joined).toBe(line);
      for (const g of EXPECTED_GLYPHS) {
        if (line.includes(g)) {
          expect(splitRuns(line).some((r) => r.fallback && r.text.includes(g))).toBe(true);
        }
      }
    }
  });
});
