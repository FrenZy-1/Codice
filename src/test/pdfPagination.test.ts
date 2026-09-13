/**
 * PDF code-block pagination regression tests (spec §17/§21).
 *
 * Guards the EMITTER against the quadratic page-explosion bug: chunk.page is
 * relative to the block start and must be anchored to the page the block
 * started on — re-basing it on the already-advanced state.page spawned
 * blank pages quadratically (a 500-line file once produced 567 pages).
 */

import { describe, expect, it } from 'vitest';
import { pdfExporter } from '../lib/exporters/pdfExporter';
import { planCodeChunks } from '../lib/exporters/pdfExporter';
import type { DocumentModel, HighlightedFile } from '@/types';
import { defaultDocumentOptions } from '@/lib/defaultOptions';

function largeFile(lines: number): HighlightedFile {
  return {
    fileId: 'big',
    relativePath: 'src/main/Generated.kt',
    language: 'kotlin',
    lines: Array.from({ length: lines }, (_, i) => ({
      lineNumber: i + 1,
      text: `fun gen${i + 1}() {{ // line ${i + 1}`,
      tokens: [{ start: 0, length: 22, scopes: [], color: '#24292e' }],
    })),
  };
}

function buildModel(lineCount: number): DocumentModel {
  return {
    metadata: { title: 'Pagination Test' },
    options: { ...defaultDocumentOptions(), wrapLongLines: false },
    projects: [
      {
        id: 'p1',
        label: 'big-app',
        folderName: 'big-app',
        structurePaths: ['src/main/Generated.kt'],
        files: [
          {
            projectId: 'p1',
            projectLabel: 'big-app',
            relativePath: 'src/main/Generated.kt',
            language: 'kotlin',
            sizeBytes: 12000,
            highlighted: largeFile(lineCount),
          },
        ],
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

async function pageCount(lineCount: number): Promise<number> {
  const result = await pdfExporter.export(buildModel(lineCount), {
    filename: 'pag-test',
    format: 'pdf',
  });
  const buf = await result.blob.arrayBuffer();
  const s = Buffer.from(buf).toString('latin1');
  const m = s.match(/\/Type \/Pages[^>]*?\/Count (\d+)/) ?? s.match(/\/Count (\d+)/);
  return m ? Number(m[1]) : 0;
}

describe('PDF code pagination (emitter level)', () => {
  it('a 400-line file stays within the planner page budget (no quadratic growth)', async () => {
    // Planner expectation: rows ≈ 400 at default 9pt/1.25 → content height
    // ≈ 698pt → ~62 rows/page → ~8-10 code pages + front matter/TOC/trees.
    const expectedMax = 24;
    const pages = await pageCount(400);
    expect(pages).toBeGreaterThan(4); // actually paginated
    expect(pages).toBeLessThan(expectedMax); // NOT ~100+/quadratic
  });

  it('planner alone is page-safe for very large blocks', () => {
    const chunks = planCodeChunks({
      rowCount: 5000,
      lineHeight: 11.25,
      codePadding: 8,
      margin: { top: 72, bottom: 72 },
      pageH: 842,
      startCursorY: 300,
    });
    const last = chunks[chunks.length - 1];
    // ≈ (698-16-16)/11.25 ≈ 59 rows/page → ~85 pages for 5000 rows.
    expect(chunks.length).toBeGreaterThan(60);
    expect(last.page).toBeLessThan(120);
    for (const c of chunks) {
      const bottom = c.rectTop + c.rectHeight;
      expect(bottom).toBeLessThanOrEqual(842 - 72 + 0.01);
    }
  });
});
