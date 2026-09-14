/**
 * PDF layout tests (spec §17/§21/§9/§7).
 *
 * The PDF exporter factors its code-block and title-page geometry into PURE
 * helpers (no jsPDF instance required):
 *
 *   - wrapSourceLineToRows / buildCodeRows — source lines → visual rows
 *     (character-level wrapping in wrap mode; one row per line otherwise).
 *   - planCodeChunks — visual rows → per-page chunks with exact bg/border
 *     rects, never past the bottom margin (footer-overlap fix).
 *   - buildTitlePageLines / planTitlePageLayout — title page as ONE coherent
 *     group honoring horizontal/vertical alignment (date/version/description
 *     flow with the group instead of being pinned to pageH - 200).
 *
 * A thin end-to-end block verifies the jsPDF emission still yields a valid,
 * multi-page PDF for large files.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCodeRows,
  buildTitlePageLines,
  planCodeChunks,
  planTitlePageLayout,
  wrapSourceLineToRows,
  type CodeChunkInput,
  type CodeRow,
} from '../lib/exporters/pdfExporter';
import { pdfExporter } from '../lib/exporters/pdfExporter';
import type {
  DocumentOptions,
  DocumentModel,
  HighlightedFile,
  HighlightedLine,
  HighlightToken,
} from '@/types';
import { defaultDocumentOptions } from '@/lib/defaultOptions';

/** Deterministic monospace measurer: 6 pt per character. */
const CHAR_W = 6;
const measure = (t: string) => Array.from(t).length * CHAR_W;
const EPS = 1e-6;

function token(start: number, length: number, color: string | null = null, extra?: Partial<HighlightToken>): HighlightToken {
  return { start, length, scopes: [], color: color ?? undefined, ...extra };
}

function line(text: string, lineNumber: number, tokens?: HighlightToken[]): HighlightedLine {
  return {
    lineNumber,
    text,
    tokens: tokens ?? (text.length > 0 ? [token(0, text.length)] : []),
  };
}

const rowText = (row: CodeRow) => row.runs.map((r) => r.text).join('');
const rowWidth = (row: CodeRow) => row.runs.reduce((acc, r) => acc + measure(r.text), 0);

describe('wrapSourceLineToRows (wrap mode)', () => {
  it('splits a long single token across rows at character level', () => {
    const rows = wrapSourceLineToRows(line('a'.repeat(40), 1), {
      wrap: true,
      codeWidth: 60, // 10 chars per row at 6pt/char
      measure,
    });
    expect(rows).toHaveLength(4);
    expect(rows.map(rowText).join('')).toBe('a'.repeat(40));
    for (const row of rows) {
      expect(rowWidth(row)).toBeLessThanOrEqual(60 + EPS);
    }
    expect(rows[0].lineNumber).toBe(1);
    expect(rows.slice(1).map((r) => r.lineNumber)).toEqual([null, null, null]);
  });

  it('keeps token color/bold/italic on every wrapped fragment', () => {
    const rows = wrapSourceLineToRows(
      line('abcdefghij', 7, [token(0, 10, '#ff0000', { bold: true })]),
      { wrap: true, codeWidth: 24, measure }, // 4 chars per row
    );
    expect(rows.map(rowText)).toEqual(['abcd', 'efgh', 'ij']);
    for (const row of rows) {
      expect(row.runs).toHaveLength(1);
      expect(row.runs[0].color).toBe('#ff0000');
      expect(row.runs[0].bold).toBe(true);
      expect(row.runs[0].italic).toBe(false);
    }
    // Only the first visual row carries the source line number.
    expect(rows.map((r) => r.lineNumber)).toEqual([7, null, null]);
  });

  it('wraps between tokens and never exceeds the available width', () => {
    const rows = wrapSourceLineToRows(
      line('one two three', 1, [
        token(0, 3, '#a'),
        token(3, 1, null),
        token(4, 3, '#b'),
        token(7, 1, null),
        token(8, 5, '#c'),
      ]),
      { wrap: true, codeWidth: 42, measure }, // exactly 'one two' wide
    );
    expect(rows.map(rowText).join('')).toBe('one two three');
    for (const row of rows) {
      expect(rowWidth(row)).toBeLessThanOrEqual(42 + EPS);
    }
    // Colors survive per fragment.
    const colors = rows.flatMap((r) => r.runs.map((run) => run.color));
    expect(colors).toContain('#a');
    expect(colors).toContain('#b');
    expect(colors).toContain('#c');
  });

  it('yields one empty row for an empty source line', () => {
    const rows = wrapSourceLineToRows(line('', 3, []), { wrap: true, codeWidth: 60, measure });
    expect(rows).toHaveLength(1);
    expect(rows[0].runs).toEqual([]);
    expect(rows[0].lineNumber).toBe(3);
  });
});

describe('wrapSourceLineToRows (no-wrap mode)', () => {
  it('yields exactly one row per source line and never splits tokens', () => {
    const long = 'x'.repeat(100);
    const rows = [
      wrapSourceLineToRows(line('short', 1), { wrap: false, codeWidth: 30, measure }),
      wrapSourceLineToRows(line(long, 2, [token(0, 100, '#k')]), { wrap: false, codeWidth: 30, measure }),
    ].flat();
    expect(rows).toHaveLength(2);
    expect(rowText(rows[0])).toBe('short');
    expect(rowText(rows[1])).toBe(long); // unsplit — clipped at draw time
    expect(rows[1].runs[0].color).toBe('#k');
    expect(rows.map((r) => r.lineNumber)).toEqual([1, 2]);
  });
});

describe('buildCodeRows', () => {
  it('numbers only the first row of each source line', () => {
    const file: HighlightedFile = {
      fileId: 'f',
      relativePath: 'a.ts',
      language: 'ts',
      lines: [
        line('a'.repeat(15), 1), // 3 rows at codeWidth 36 (6/6/3 chars)
        line('b'.repeat(4), 2), // 1 row
      ],
    };
    const rows = buildCodeRows(file, { wrap: true, codeWidth: 36, measure });
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.lineNumber)).toEqual([1, null, null, 2]);
    expect(rows.map(rowText).join('')).toBe('a'.repeat(15) + 'b'.repeat(4));
  });
});

describe('planCodeChunks', () => {
  const GEO = {
    lineHeight: 10,
    codePadding: 6,
    margin: { top: 50, bottom: 50 },
    pageH: 800,
    startCursorY: 50,
  };
  const base = (rowCount: number, over?: Partial<CodeChunkInput>): CodeChunkInput => ({
    rowCount,
    ...GEO,
    ...over,
  });

  it('splits rows exactly at the content-height boundary (68 rows/page)', () => {
    const chunks = planCodeChunks(base(100));
    expect(chunks).toHaveLength(2);

    // Page 1: firstRowTop = 50 + 6 = 56; row k fits while 56 + 10k + 10 + 6 <= 750.
    expect(chunks[0]).toMatchObject({
      page: 1,
      rowStart: 0,
      rowCount: 68,
      rectTop: 50,
      firstRowTop: 56,
    });
    expect(chunks[0].rectHeight).toBe(68 * 10 + 2 * 6);
    expect(chunks[0].rectTop + chunks[0].rectHeight).toBeLessThanOrEqual(750 + EPS);

    // Continuation chunk starts at the top margin with its own rect.
    expect(chunks[1]).toMatchObject({
      page: 2,
      rowStart: 68,
      rowCount: 32,
      rectTop: 50,
      firstRowTop: 56,
    });
    expect(chunks[1].rectHeight).toBe(32 * 10 + 2 * 6);
  });

  it('keeps every chunk rect inside [margin.top, pageH - margin.bottom] and exact-sized', () => {
    const chunks = planCodeChunks(base(500));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks).toHaveLength(8); // 7 × 68 + 24

    let covered = 0;
    chunks.forEach((chunk, i) => {
      expect(chunk.page).toBe(i + 1);
      expect(chunk.rowStart).toBe(covered);
      covered += chunk.rowCount;
      expect(chunk.rectTop).toBeGreaterThanOrEqual(50 - EPS);
      expect(chunk.rectTop + chunk.rectHeight).toBeLessThanOrEqual(750 + EPS);
      expect(chunk.rectHeight).toBeCloseTo(chunk.rowCount * 10 + 12, 6);
      expect(chunk.firstRowTop).toBe(chunk.rectTop + 6);
    });
    expect(covered).toBe(500);
  });

  it('uses fewer rows on the first page when the block starts deep in the page', () => {
    const chunks = planCodeChunks(base(100, { startCursorY: 600 }));
    // firstRowTop = 606; 606 + 10k + 16 <= 750 → 13 rows on page 1.
    expect(chunks[0].rowCount).toBe(13);
    expect(chunks[0].rectTop).toBe(600);
    expect(chunks[0].rectHeight).toBeCloseTo(13 * 10 + 12, 6);
    expect(chunks[0].rectTop + chunks[0].rectHeight).toBeLessThanOrEqual(750 + EPS);
    expect(chunks[1].page).toBe(2);
    expect(chunks[1].rectTop).toBe(50);
  });

  it('starts the block on a fresh page when not even one row fits at the cursor', () => {
    const chunks = planCodeChunks(base(5, { startCursorY: 745 }));
    expect(chunks[0].page).toBe(2);
    expect(chunks[0].rectTop).toBe(50);
    expect(chunks[0].firstRowTop).toBe(56);
    expect(chunks[0].rowCount).toBe(5);
  });

  it('keeps a padding-only box for an empty block', () => {
    const chunks = planCodeChunks(base(0));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].rowCount).toBe(0);
    expect(chunks[0].rectTop).toBe(50);
    expect(chunks[0].rectHeight).toBeCloseTo(12, 6);
    expect(chunks[0].firstRowTop).toBe(56);
  });

  it('single row block gets one exact chunk', () => {
    const chunks = planCodeChunks(base(1));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].rectHeight).toBeCloseTo(10 + 12, 6);
    expect(chunks[0].rectTop + chunks[0].rectHeight).toBeLessThanOrEqual(750 + EPS);
  });
});

describe('buildTitlePageLines', () => {
  const options: DocumentOptions = defaultDocumentOptions();
  const wrapText = () => ['Part one.', 'Part two.'];

  it('collects the whole group in order — date/version/description included', () => {
    const lines = buildTitlePageLines({
      metadata: {
        title: 'Title',
        subtitle: 'Sub',
        author: 'Au',
        course: 'Co',
        university: 'Un',
        date: '2025-01-01',
        version: '1.2.3',
        description: 'desc',
      },
      options,
      descriptionWidth: 400,
      wrapText,
      fallbackDate: 'Generated: now',
    });

    expect(lines.map((l) => l.text)).toEqual([
      'Title',
      'Sub',
      'Au',
      'Co',
      'Un',
      '2025-01-01',
      'Version: 1.2.3',
      'Part one.',
      'Part two.',
    ]);
    // Typography preserved; colors now follow the semantic document colors
    // (spec §5): title = Headings (#0f172a), subtitle/author = Secondary
    // (#59636e) — presetToOptions feeds them from the canonical preset.
    expect(lines[0]).toMatchObject({ size: 32, style: 'bold', color: [15, 23, 42] });
    expect(lines[1]).toMatchObject({ size: 14, style: 'italic', color: [89, 99, 110] });
    expect(lines[5]).toMatchObject({ size: 10, color: [120, 120, 120] });
    expect(lines[6]).toMatchObject({ size: 10, color: [120, 120, 120] });
    expect(lines[7]).toMatchObject({ size: 11, color: [60, 60, 60] });
    // Baseline rhythm: wide gap after title, tight meta rhythm, visible gap
    // before the date block, then version/description flowing beneath.
    expect(lines.map((l) => l.gapBefore)).toEqual([0, 44, 24, 24, 24, 36, 16, 20, 13.2]);
  });

  it('falls back to the generated date and widens the gap without a version', () => {
    const lines = buildTitlePageLines({
      metadata: { title: 'T', description: 'd' },
      options,
      descriptionWidth: 400,
      wrapText,
      fallbackDate: 'Generated: now',
    });
    expect(lines.map((l) => l.text)).toEqual(['T', 'Generated: now', 'Part one.', 'Part two.']);
    expect(lines[1].gapBefore).toBe(44); // second line overall keeps the title rhythm
    expect(lines[2].gapBefore).toBe(36); // no version → description follows the date gap
  });
});

describe('planTitlePageLayout', () => {
  // group: title 32pt + 44pt gap + meta 14pt
  // firstAscent = 25.6; totalHeight = 25.6 + 44 + 2.8 = 72.4
  const lines = [
    { text: 'T', font: 'times' as const, style: 'bold' as const, size: 32, color: [0, 0, 0] as [number, number, number], gapBefore: 0 },
    { text: 'M', font: 'times' as const, style: 'normal' as const, size: 14, color: [0, 0, 0] as [number, number, number], gapBefore: 44 },
  ];
  const GEO = { margin: { top: 50, bottom: 50 }, pageH: 800 }; // content 50..750

  it('top: group top = margin.top + offset', () => {
    const layout = planTitlePageLayout({ lines, ...GEO, vAlign: 'top', offset: 100 });
    expect(layout.totalHeight).toBeCloseTo(72.4, 6);
    expect(layout.groupTop).toBeCloseTo(150, 6);
    expect(layout.firstBaseline).toBeCloseTo(175.6, 6);
  });

  it('center: group centered within the content region (offset must not skew centering, spec §9)', () => {
    const layout = planTitlePageLayout({ lines, ...GEO, vAlign: 'center', offset: 100 });
    expect(layout.groupTop).toBeCloseTo(50 + (700 - 72.4) / 2, 6);
    expect(layout.groupTop).toBeGreaterThanOrEqual(50);
    expect(layout.groupTop + layout.totalHeight).toBeLessThanOrEqual(750 + EPS);
  });

  it('bottom: the group bottom sits AT the content bottom (offset is top-mode only, spec §17)', () => {
    const layout = planTitlePageLayout({ lines, ...GEO, vAlign: 'bottom', offset: 100 });
    expect(layout.groupTop).toBeCloseTo(750 - 72.4, 6);
    expect(layout.groupTop + layout.totalHeight).toBeCloseTo(750, 6);
  });

  it('clamps the group inside the content region for extreme offsets', () => {
    const top = planTitlePageLayout({ lines, ...GEO, vAlign: 'top', offset: 5000 });
    expect(top.groupTop).toBeCloseTo(750 - 72.4, 6);
    expect(top.groupTop).toBeGreaterThanOrEqual(50);

    const bottom = planTitlePageLayout({ lines, ...GEO, vAlign: 'bottom', offset: 5000 });
    // The offset is top-mode only — bottom placement ignores it entirely.
    expect(bottom.groupTop).toBeCloseTo(750 - 72.4, 6);
    expect(bottom.groupTop + bottom.totalHeight).toBeLessThanOrEqual(750 + EPS);
  });
});

// ---------------------------------------------------------------------------
// End-to-end emission smoke test (thin jsPDF wrapper over the pure planners).
// ---------------------------------------------------------------------------

function buildModel(lineCount: number, text: string, opts?: Partial<DocumentOptions>): DocumentModel {
  const options: DocumentOptions = {
    ...defaultDocumentOptions(),
    includeFrontMatter: false,
    includeToc: false,
    includeProjectStructure: false,
    showFileHeaders: false,
    ...opts,
  };
  const highlighted: HighlightedFile = {
    fileId: 'f1',
    relativePath: 'src/Big.java',
    language: 'java',
    lines: Array.from({ length: lineCount }, (_, i) => line(text, i + 1)),
  };
  return {
    metadata: { title: 'Layout Test' },
    options,
    projects: [
      {
        id: 'p1',
        label: 'big',
        folderName: 'big',
        files: [
          {
            projectId: 'p1',
            projectLabel: 'big',
            relativePath: 'src/Big.java',
            language: 'java',
            highlighted,
            sizeBytes: 10_000,
          },
        ],
        structurePaths: ['src/Big.java'],
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

async function countPdfPages(blob: Blob): Promise<number> {
  const text = new TextDecoder().decode(await blob.arrayBuffer());
  return (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

describe('pdfExporter code-block pagination', () => {
  it('splits a large wrapped code block across multiple pages', async () => {
    const model = buildModel(200, 'System.out.println("the quick brown fox jumps over the lazy dog");');
    const result = await pdfExporter.export(model, { format: 'pdf', filename: 'big' });
    expect(result.filename).toBe('big.pdf');
    expect(result.blob.size).toBeGreaterThan(0);
    const pages = await countPdfPages(result.blob);
    expect(pages).toBeGreaterThan(1);
  }, 30000);

  it('keeps a small code block on a single page (no full-page filler rect)', async () => {
    const model = buildModel(5, 'int x = 1;');
    const result = await pdfExporter.export(model, { format: 'pdf', filename: 'small' });
    const pages = await countPdfPages(result.blob);
    expect(pages).toBe(1);
  }, 30000);
});
