/**
 * Tests for fonts and theme flows (spec §7–§9, §10):
 *   - all typography centralized under Fonts Settings fields of the model
 *   - project-structure typography present in the model (color under Theme)
 *   - code border styles solid / dotted / dashed survive migration + mapping
 *   - Shiki theme registry resolves real theme ids and rejects unknown ones
 *   - dark themes are classified correctly (readable rendering guarantee)
 */

import { describe, expect, it } from 'vitest';
import { migratePreset } from '../lib/presets/presetMigration';
import { presetToOptions } from '../lib/presets/presetToOptions';
import { getBuiltInPreset } from '../lib/presets/builtInPresets';
import {
  getSyntaxThemeCatalog,
  getGroupedSyntaxThemes,
  resolveSyntaxTheme,
  findSyntaxTheme,
  DEFAULT_SYNTAX_THEME,
} from '../lib/themes/syntaxThemeRegistry';

function patched(patch: Record<string, any>) {
  const base = getBuiltInPreset('university')!;
  return migratePreset({ ...base, ...patch });
}

describe('fonts model', () => {
  it('body typography carries font, size, weight, line spacing, color, paragraph spacing', () => {
    const p = patched({
      typography: {
        ...getBuiltInPreset('university')!.typography,
        bodyFont: 'Georgia',
        bodyWeight: 'semibold',
        italicMissing: undefined,
      },
    });
    expect(p.typography.bodyFont).toBe('Georgia');
    expect(p.typography.bodyWeight).toBe('semibold');
    expect(p.typography).toHaveProperty('lineSpacing');
    expect(p.typography).toHaveProperty('bodyColor');
    expect(p.typography).toHaveProperty('paragraphSpacingPt');
  });

  it('heading levels each carry weight and italic', () => {
    const p = patched({
      headings: {
        ...getBuiltInPreset('university')!.headings,
        h1: { ...getBuiltInPreset('university')!.headings.h1, weight: 'bold', italic: true },
      },
    });
    expect(p.headings.h1.italic).toBe(true);
    expect(p.headings.h1.weight).toBe('bold');
    for (const level of ['title', 'h1', 'h2', 'h3', 'h4'] as const) {
      expect(p.headings[level]).toHaveProperty('weight');
      expect(p.headings[level]).toHaveProperty('italic');
    }
  });

  it('project structure typography lives in its own style group', () => {
    const p = patched({
      projectStructure: {
        ...getBuiltInPreset('university')!.projectStructure,
        font: 'Fira Code',
        fontSizePt: 9,
        lineHeight: 1.5,
      },
    });
    expect(p.projectStructure.font).toBe('Fira Code');
    expect(p.projectStructure.fontSizePt).toBe(9);
    expect(p.projectStructure.lineHeight).toBe(1.5);
    // Its color is part of the same style object and surfaced under Theme.
    expect(p.projectStructure).toHaveProperty('color');
  });
});

describe('code border styles', () => {
  it('solid / dotted / dashed survive migration and reach the exporters', () => {
    for (const style of ['solid', 'dotted', 'dashed'] as const) {
      const base = getBuiltInPreset('university')!;
      const p = migratePreset({
        ...base,
        code: { ...base.code, borderStyle: style, borderColor: '#d0d7de' },
      });
      const o = presetToOptions(p);
      expect(o.codeBorderStyle).toBe(style);
      expect(o.codeBorderColor).toBe('#d0d7de');
    }
  });

  it("borderStyle 'none' produces no border color for exporters", () => {
    const base = getBuiltInPreset('university')!;
    const p = migratePreset({
      ...base,
      code: { ...base.code, borderStyle: 'none' },
    });
    const o = presetToOptions(p);
    expect(o.codeBorderColor).toBeNull();
    expect(o.codeBorderStyle).toBeUndefined();
  });

  it('unknown border styles from old presets are rejected safely', () => {
    const base = getBuiltInPreset('university')!;
    const p = migratePreset({
      ...base,
      code: { ...base.code, borderStyle: 'grooved' as any },
    });
    expect(['none', 'solid', 'dotted', 'dashed']).toContain(p.code.borderStyle);
  });
});

describe('Shiki syntax theme registry (spec §10)', () => {
  it('exposes a catalog derived from Shiki theme ids', () => {
    const catalog = getSyntaxThemeCatalog();
    expect(catalog.length).toBeGreaterThan(20);
    for (const theme of catalog) {
      expect(theme.id).toBeTruthy();
      expect(['light', 'dark', 'neutral']).toContain(theme.group);
    }
  });

  it('known Shiki themes resolve to themselves', () => {
    expect(resolveSyntaxTheme('github-dark')).toBe('github-dark');
    expect(resolveSyntaxTheme('github-light')).toBe('github-light');
  });

  it('unknown themes fall back to the default (never crashes)', () => {
    expect(resolveSyntaxTheme('not-a-real-theme')).toBe(DEFAULT_SYNTAX_THEME);
    expect(resolveSyntaxTheme(undefined)).toBe(DEFAULT_SYNTAX_THEME);
    expect(resolveSyntaxTheme(null)).toBe(DEFAULT_SYNTAX_THEME);
  });

  it('groups themes into light and dark for the selector', () => {
    const grouped = getGroupedSyntaxThemes();
    expect(grouped.light.length).toBeGreaterThan(0);
    expect(grouped.dark.length).toBeGreaterThan(0);
    for (const t of grouped.dark) expect(t.dark).toBe(true);
    for (const t of grouped.light) expect(t.dark).toBe(false);
  });

  it('findSyntaxTheme returns undefined for unknown ids', () => {
    expect(findSyntaxTheme('github-dark')).toBeTruthy();
    expect(findSyntaxTheme('definitely-not-a-theme')).toBeUndefined();
  });
});

describe('document colors', () => {
  it('all semantic color channels exist on the preset', () => {
    const p = migratePreset({});
    const channels = [
      'background', 'surface', 'primaryText', 'secondaryText', 'mutedText',
      'accent', 'headings', 'borders', 'links', 'success', 'warning', 'error',
    ];
    for (const c of channels) {
      expect(p.colors).toHaveProperty(c);
    }
  });
});
