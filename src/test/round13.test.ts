/**
 * Round-13 spec coverage (§4 TOC alignment, §10 page-top, §2/§5 highlight
 * mapping semantics, §8/§20 highlighter robustness, exporter TOC page bits).
 */

import { describe, expect, it } from 'vitest';
import {
  buildDocumentElements,
  pageContentAlignment,
  paginateDocument,
  type PaginationProject,
} from '../lib/preview/documentPagination';
import { computeHighlightIds } from '../components/Settings/templateShared';
import { migratePreset, DEFAULT_TOC_STYLE } from '../lib/presets/presetMigration';
import { presetToOptions } from '../lib/presets/presetToOptions';
import { getBuiltInPreset } from '../lib/presets/builtInPresets';
import {
  estimateTitleGroupHeightTwips,
  tocSpacingBefore,
} from '../lib/exporters/docxExporter';
import {
  computeTitlePageSpacerCm,
  computeTocSpacerCm,
  estimateTitleGroupHeightCm,
} from '../lib/exporters/odtExporter';
import { resolveSupportedLanguage, plainHighlightedFile } from '../lib/highlight/highlighter';
import { defaultDocumentOptions } from '../lib/defaultOptions';
import type { DocumentModel } from '../types';

/* ------------------------------------------------------------------ */
/* §4/§10 — shared page-content alignment model                        */
/* ------------------------------------------------------------------ */

describe('pageContentAlignment (spec §4/§9/§10)', () => {
  it('title pages follow the title vertical alignment', () => {
    expect(pageContentAlignment('title', 'top', 'center')).toBe('flex-start');
    expect(pageContentAlignment('title', 'center', 'center')).toBe('center');
    expect(pageContentAlignment('title', 'bottom', 'center')).toBe('flex-end');
  });

  it('TOC pages follow the TOC vertical alignment — independently of the title', () => {
    expect(pageContentAlignment('toc', 'bottom', 'top')).toBe('flex-start');
    expect(pageContentAlignment('toc', 'top', 'center')).toBe('center');
    expect(pageContentAlignment('toc', 'top', 'bottom')).toBe('flex-end');
  });

  it('content and project-intro pages ALWAYS start at the top (spec §10)', () => {
    for (const kind of ['content', 'project-intro'] as const) {
      expect(pageContentAlignment(kind, 'center', 'center')).toBe('flex-start');
      expect(pageContentAlignment(kind, 'bottom', 'bottom')).toBe('flex-start');
    }
  });
});

/* ------------------------------------------------------------------ */
/* §4 — preset model, migration, options bridge                        */
/* ------------------------------------------------------------------ */

describe('TOC alignment preset model (spec §4)', () => {
  it('migrates presets without a toc group to the left/top defaults', () => {
    const preset = migratePreset({});
    expect(preset.toc).toEqual(DEFAULT_TOC_STYLE);
    expect(preset.toc.horizontalAlignment).toBe('left');
    expect(preset.toc.verticalAlignment).toBe('top');
  });

  it('accepts explicit toc alignment values and rejects invalid enums', () => {
    const preset = migratePreset({
      toc: { horizontalAlignment: 'center', verticalAlignment: 'bottom' },
    });
    expect(preset.toc.horizontalAlignment).toBe('center');
    expect(preset.toc.verticalAlignment).toBe('bottom');

    const invalid = migratePreset({
      toc: { horizontalAlignment: 'middle' as never, verticalAlignment: 'diagonal' as never },
    });
    expect(invalid.toc).toEqual(DEFAULT_TOC_STYLE);
  });

  it('built-in presets all carry a valid toc group', () => {
    for (const id of ['university', 'developer', 'minimal', 'dark-code']) {
      const preset = getBuiltInPreset(id);
      expect(preset?.toc).toBeDefined();
      expect(['left', 'center', 'right']).toContain(preset!.toc.horizontalAlignment);
      expect(['top', 'center', 'bottom']).toContain(preset!.toc.verticalAlignment);
    }
  });

  it('presetToOptions maps the toc alignment and semantic colors', () => {
    const options = presetToOptions(migratePreset({
      toc: { horizontalAlignment: 'right', verticalAlignment: 'center' },
    }));
    expect(options.tocHorizontalAlignment).toBe('right');
    expect(options.tocVerticalAlignment).toBe('center');
    // §5 — semantic colors flow into the exporters' options.
    expect(options.bodyColor).toBe('#1f2328');
    expect(options.secondaryColor).toBe('#59636e');
    expect(options.headingColor).toBe('#0f172a');
  });
});

/* ------------------------------------------------------------------ */
/* §4 — paginator keeps the TOC on its own page                        */
/* ------------------------------------------------------------------ */

const PROJECTS: PaginationProject[] = [
  {
    label: 'proj-a',
    path: '/tmp/proj-a',
    structure: ['a.ts'],
    files: [{ name: 'a.ts', path: 'a.ts', language: 'typescript', size: 10, code: 'const a = 1;' }],
  },
  {
    label: 'proj-b',
    path: '/tmp/proj-b',
    structure: ['b.ts'],
    files: [{ name: 'b.ts', path: 'b.ts', language: 'typescript', size: 10, code: 'const b = 1;' }],
  },
];

function paginateWith(presetOverride: Parameters<typeof migratePreset>[0]) {
  const preset = migratePreset(presetOverride);
  const elements = buildDocumentElements(preset, PROJECTS);
  return paginateDocument(elements, preset, PROJECTS, {
    getLineCount: (f) => (f.code ? f.code.split('\n').length : 1),
    getLineText: () => '',
  });
}

describe('paginator — TOC and project pages (§4/§10/§16)', () => {
  it('title page → TOC page → project pages are isolated', () => {
    const pages = paginateWith({
      titlePage: { enabled: true },
      pageBreaks: {
        afterTitlePage: true,
        beforeProject: true,
        beforeFile: false,
        beforeH1: false,
      },
    });
    const kinds = pages.map((p) => p.kind);
    expect(kinds[0]).toBe('title');
    expect(kinds[1]).toBe('toc');
    // Each project starts its own page.
    const tocIdx = kinds.indexOf('toc');
    expect(kinds[tocIdx + 1]).toBe('project-intro');
    // The second project begins on ANOTHER fresh page.
    const secondIntro = kinds.lastIndexOf('project-intro');
    expect(secondIntro).toBeGreaterThan(tocIdx + 1);
  });

  it('the project-intro page never carries elements of the previous section', () => {
    const pages = paginateWith({
      titlePage: { enabled: true },
      pageBreaks: { afterTitlePage: true, beforeProject: true, beforeFile: false, beforeH1: false },
    });
    const intro = pages.find((p) => p.kind === 'project-intro')!;
    expect(intro.elements.length).toBeGreaterThan(0);
    expect(intro.elements.every((el) => el.type === 'projectHeader' || el.type === 'structure' || el.type === 'heading' || el.type === 'fileHeader' || el.type === 'paragraph' || el.type === 'code')).toBe(true);
    expect(intro.elements.some((el) => el.type === 'toc')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* §2/§5 — highlight mapping semantics                                 */
/* ------------------------------------------------------------------ */

describe('computeHighlightIds — semantic targets', () => {
  it('maps the toc group to the toc region (spec §4)', () => {
    expect(computeHighlightIds({ toc: { verticalAlignment: 'center' } })).toEqual(['toc']);
  });

  it('maps the Headings document color to ALL heading levels (spec §5)', () => {
    const ids = computeHighlightIds({ colors: { headings: '#123456' } });
    for (const id of ['heading-title', 'heading-h1', 'heading-h2', 'heading-h3', 'heading-h4']) {
      expect(ids).toContain(id);
    }
  });

  it('maps primary text to the body region (spec §5)', () => {
    expect(computeHighlightIds({ colors: { primaryText: '#123456' } })).toEqual(['body']);
  });

  it('maps secondary text to the title-page + toc + structure consumers', () => {
    const ids = computeHighlightIds({ colors: { secondaryText: '#123456' } });
    expect(ids).toContain('title-page');
    expect(ids).toContain('toc');
    expect(ids).toContain('structure');
  });

  it('maps success/warning/error/surface to the status card', () => {
    const ids = computeHighlightIds({ colors: { success: '#0a0' } });
    expect(ids).toContain('status-card');
  });
});

/* ------------------------------------------------------------------ */
/* §17 — DOCX/ODT title group height estimates                         */
/* ------------------------------------------------------------------ */

describe('title group height estimates (spec §17)', () => {
  it('grow with the metadata actually present (DOCX twips)', () => {
    const minimal = estimateTitleGroupHeightTwips({ title: 'T' });
    const full = estimateTitleGroupHeightTwips({
      title: 'T',
      subtitle: 'S',
      author: 'A',
      course: 'C',
      university: 'U',
      version: 'V',
      description: 'D',
    });
    expect(full).toBeGreaterThan(minimal);
    // Title (28pt × 1.15 × 20 + 400) + the always-present "Generated:" line.
    expect(minimal).toBe(Math.round(28 * 1.15 * 20) + 400 + Math.round(11 * 1.15 * 20) + 600);
  });

  it('ODT cm estimate matches the same per-field model', () => {
    const minimal = estimateTitleGroupHeightCm({ title: 'T' });
    const full = estimateTitleGroupHeightCm({ title: 'T', author: 'A', description: 'D' });
    expect(full).toBeGreaterThan(minimal);
    expect(minimal).toBeGreaterThan(1.5); // margins allowance included
  });

  it('ODT bottom spacer places the group near the text-area bottom (footer-aware)', () => {
    const options = {
      ...defaultDocumentOptions(),
      titlePageVerticalAlignment: 'bottom' as const,
      pageFooterShow: false,
    };
    const spacer = computeTitlePageSpacerCm(options, 29.7, 3);
    // A4 text height 24.7cm → 24.7 − 3 − 1.2 safety band.
    expect(spacer).toBeCloseTo(24.7 - 3 - 1.2, 2);
  });

  it('ODT toc spacer: top → 0, center → half leftover, bottom → full leftover', () => {
    const base = { ...defaultDocumentOptions(), pageFooterShow: false };
    expect(computeTocSpacerCm({ ...base, tocVerticalAlignment: 'top' }, 29.7, 10)).toBe(0);
    const lineCm = base.bodyFontSize * 1.4 * 0.03527777777777778;
    const blockH = Math.min(24.7, 10 * lineCm + 1.2);
    expect(
      computeTocSpacerCm({ ...base, tocVerticalAlignment: 'center' }, 29.7, 10),
    ).toBeCloseTo((24.7 - blockH) / 2, 2);
    expect(
      computeTocSpacerCm({ ...base, tocVerticalAlignment: 'bottom' }, 29.7, 10),
    ).toBeCloseTo(24.7 - blockH, 2);
  });

  it('DOCX tocSpacingBefore: top keeps the historical 200, center centers the group', () => {
    const model: DocumentModel = {
      metadata: {},
      options: { ...defaultDocumentOptions(), tocVerticalAlignment: 'top' },
      projects: [],
      generatedAt: '2025-01-01T00:00:00Z',
    };
    expect(tocSpacingBefore(model.options, model)).toBe(200);
    const center = {
      ...model,
      options: { ...defaultDocumentOptions(), tocVerticalAlignment: 'center' as const, margins: { top: 20, right: 20, bottom: 20, left: 20 } },
    };
    const [pw, ph] = [11906, 16838];
    const textArea = ph - Math.round(20 * 56.7) * 2;
    expect(tocSpacingBefore(center.options, center)).toBe(Math.max(0, Math.round((textArea - Math.round(2 * 280)) / 2)));
    expect(textArea).toBe(ph - 2268);
    expect(pw).toBeGreaterThan(0);
  });
});
