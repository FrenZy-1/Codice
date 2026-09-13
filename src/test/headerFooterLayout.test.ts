/**
 * Tests for the structured header/footer layout model (spec §26) and for
 * preset compatibility when migrating legacy single-string headers/footers.
 */

import { describe, expect, it } from 'vitest';
import { migratePreset, migratePageStyle } from '../lib/presets/presetMigration';
import { presetToOptions } from '../lib/presets/presetToOptions';
import { getBuiltInPreset } from '../lib/presets/builtInPresets';
import type { DocumentPreset } from '../lib/presets/documentPreset';

function patched(base: DocumentPreset, patch: Record<string, any>): DocumentPreset {
  return migratePreset({ ...base, ...patch });
}

describe('migratePageStyle — legacy conversion', () => {
  it('converts a legacy pageFooter template into a structured text slot', () => {
    const p = migratePageStyle({
      pageFooter: 'Page {page} of {pages}',
    } as any);
    expect(p.pageFooterShow).toBe(true);
    expect(p.pageFooterLayout).toBe('single');
    expect(p.pageFooterCenter).toBe('text');
    expect(p.pageFooterText).toBe('Page {page} of {pages}');
    expect(p.pageFooter).toBe('Page {page} of {pages}');
  });

  it('converts a legacy pageHeader string into the header center slot', () => {
    const p = migratePageStyle({
      pageHeader: 'My Header',
    } as any);
    expect(p.pageHeaderShow).toBe(true);
    expect(p.pageHeaderCenter).toBe('My Header');
    expect(p.pageHeaderLayout).toBe('single');
    expect(p.pageHeaderAlign).toBe('right');
  });

  it('a legacy string re-set on a structured preset turns the header back on', () => {
    const first = migratePageStyle({ pageHeader: null } as any);
    expect(first.pageHeaderShow).toBe(false);
    const second = migratePageStyle({ ...first, pageHeader: 'Back on' } as any);
    expect(second.pageHeaderShow).toBe(true);
    expect(second.pageHeaderCenter).toBe('Back on');
  });

  it('round-trips an already-structured preset without resurrecting hidden headers', () => {
    const first = migratePageStyle({ pageHeader: null, pageFooter: null } as any);
    const second = migratePageStyle(first);
    expect(second.pageHeaderShow).toBe(false);
    expect(second.pageFooterShow).toBe(false);
  });

  it('rejects invalid enum values with safe defaults', () => {
    const p = migratePageStyle({
      pageHeaderLayout: 'quad',
      pageHeaderAlign: 'middle',
      pageFooterLeft: 'everything',
    } as any);
    expect(p.pageHeaderLayout).toBe('single');
    expect(p.pageHeaderAlign).toBe('right');
    expect(p.pageFooterLeft).toBe('none');
  });
});

describe('footer content options', () => {
  const base = getBuiltInPreset('university')!;

  it('supports page number / count / date slots in the model', () => {
    const p = patched(base, {
      page: {
        ...base.page,
        pageFooterShow: true,
        pageFooterLayout: 'triple',
        pageFooterLeft: 'fileName',
        pageFooterCenter: 'pageNumber',
        pageFooterRight: 'pageCount',
      },
    });
    expect(p.page.pageFooterLeft).toBe('fileName');
    expect(p.page.pageFooterCenter).toBe('pageNumber');
    expect(p.page.pageFooterRight).toBe('pageCount');
  });

  it('structured footer slots flow into DocumentOptions', () => {
    const p = patched(base, {
      page: {
        ...base.page,
        pageFooterShow: true,
        pageFooterLayout: 'dual',
        pageFooterLeft: 'projectName',
        pageFooterRight: 'linesOnPage',
      },
    });
    const o = presetToOptions(p);
    expect(o.pageFooterLayout).toBe('dual');
    expect(o.pageFooterLeft).toBe('projectName');
    expect(o.pageFooterRight).toBe('linesOnPage');
    expect(o.pageFooterShow).toBe(true);
  });
});

describe('header layout options', () => {
  const base = getBuiltInPreset('university')!;

  it('supports single / dual / triple layouts', () => {
    for (const layout of ['single', 'dual', 'triple'] as const) {
      const p = patched(base, {
        page: { ...base.page, pageHeaderShow: true, pageHeaderLayout: layout },
      });
      const o = presetToOptions(p);
      expect(o.pageHeaderLayout).toBe(layout);
      expect(o.pageHeaderShow).toBe(true);
    }
  });

  it('single mode honors the alignment setting', () => {
    const p = patched(base, {
      page: { ...base.page, pageHeaderShow: true, pageHeaderAlign: 'center' },
    });
    expect(presetToOptions(p).pageHeaderAlign).toBe('center');
  });
});
