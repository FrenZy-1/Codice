/**
 * Tests for layout behaviors: orientation, margins, vertical alignment,
 * page breaks, and document density — verified through the canonical
 * preset → options pipeline that feeds both preview and exporters.
 */

import { describe, expect, it } from 'vitest';
import { migratePreset } from '../lib/presets/presetMigration';
import { presetToOptions } from '../lib/presets/presetToOptions';
import { getBuiltInPreset } from '../lib/presets/builtInPresets';
import { computeHighlightIds } from '../components/Settings/templateShared';

function patched(patch: Record<string, any>) {
  const base = getBuiltInPreset('university')!;
  return migratePreset({ ...base, ...patch });
}

describe('orientation', () => {
  it('portrait is preserved', () => {
    const base = getBuiltInPreset('university')!;
    const o = presetToOptions(migratePreset(base));
    expect(o.landscape).toBe(false);
  });

  it('landscape flows into the export options', () => {
    const base = getBuiltInPreset('university')!;
    const p = migratePreset({
      ...base,
      page: { ...base.page, landscape: true },
    });
    expect(presetToOptions(p).landscape).toBe(true);
  });

  it('page size is preserved', () => {
    const base = getBuiltInPreset('university')!;
    const p = migratePreset({ ...base, page: { ...base.page, size: 'Letter' } });
    expect(presetToOptions(p).pageSize).toBe('Letter');
  });
});

describe('margins', () => {
  it('margin changes recalculate the exported margins', () => {
    const base = getBuiltInPreset('university')!;
    const p = migratePreset({
      ...base,
      page: { ...base.page, marginTopMm: 30, marginLeftMm: 18 },
    });
    const o = presetToOptions(p);
    expect(o.margins.top).toBe(30);
    expect(o.margins.left).toBe(18);
  });
});

describe('vertical alignment (spec §25)', () => {
  it('defaults to top', () => {
    const p = migratePreset({});
    expect(p.titlePage.verticalAlignment).toBe('top');
  });

  it('supports top / center / bottom', () => {
    for (const va of ['top', 'center', 'bottom'] as const) {
      const p = migratePreset({ titlePage: { verticalAlignment: va } });
      expect(p.titlePage.verticalAlignment).toBe(va);
    }
  });

  it('invalid values fall back to top', () => {
    const p = migratePreset({ titlePage: { verticalAlignment: 'middle' as any } });
    expect(p.titlePage.verticalAlignment).toBe('top');
  });

  it('flows into the export options for the PDF front matter', () => {
    const base = getBuiltInPreset('university')!;
    const p = migratePreset({
      ...base,
      titlePage: { ...base.titlePage, verticalAlignment: 'center', verticalOffsetPt: 40 },
    });
    const o = presetToOptions(p);
    expect(o.titlePageVerticalAlignment).toBe('center');
    expect(o.titlePageVerticalOffsetPt).toBe(40);
  });
});

describe('page breaks', () => {
  it('all four page-break rules map into options', () => {
    const base = getBuiltInPreset('university')!;
    const p = migratePreset({
      ...base,
      pageBreaks: {
        afterTitlePage: true,
        beforeProject: true,
        beforeFile: false,
        beforeH1: true,
      },
    });
    const o = presetToOptions(p);
    expect(o.pageBreakBetweenFiles).toBe(false);
    expect(o.includeFrontMatter).toBe(true);
    expect(o.includeToc).toBe(true);
  });
});

describe('document density', () => {
  it('density values are part of the canonical preset', () => {
    const p = patched({ layout: { sectionSpacingPt: 33 } });
    expect(p.layout.sectionSpacingPt).toBe(33);
  });

  it('title page offset is stored on the title page style', () => {
    const p = patched({ titlePage: { verticalOffsetPt: 77 } });
    expect(p.titlePage.verticalOffsetPt).toBe(77);
  });
});

describe('setting → preview highlight mapping', () => {
  it('body typography highlights the body region', () => {
    const ids = computeHighlightIds({ typography: { bodyFont: 'Georgia' } });
    expect(ids).toContain('body');
  });

  it('code settings highlight the code region', () => {
    const ids = computeHighlightIds({ code: { showLineNumbers: false } });
    expect(ids).toContain('code');
  });

  it('project structure settings highlight the tree', () => {
    const ids = computeHighlightIds({
      projectStructure: { fontSizePt: 10 },
    });
    expect(ids).toContain('structure');
  });

  it('page size highlights the page region', () => {
    const ids = computeHighlightIds({ page: { size: 'A3' } });
    expect(ids).toContain('page');
  });

  it('footer layout highlights the footer region', () => {
    const ids = computeHighlightIds({
      page: { pageFooterLayout: 'triple' },
    });
    expect(ids).toContain('page-footer');
  });

  it('per-level heading changes highlight only that level', () => {
    const ids = computeHighlightIds({ headings: { h2: { italic: true } } });
    expect(ids).toContain('heading-h2');
    expect(ids).not.toContain('heading-h1');
  });
});
