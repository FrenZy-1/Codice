import { describe, expect, it } from 'vitest';
import {
  getSyntaxThemeCatalog,
  getGroupedSyntaxThemes,
  findSyntaxTheme,
  resolveSyntaxTheme,
  DEFAULT_SYNTAX_THEME,
} from '../lib/themes/syntaxThemeRegistry';

describe('syntaxThemeRegistry', () => {
  it('returns a non-empty catalog derived from Shiki', () => {
    const catalog = getSyntaxThemeCatalog();
    expect(catalog.length).toBeGreaterThan(10);
  });

  it('includes well-known themes', () => {
    const catalog = getSyntaxThemeCatalog();
    const ids = catalog.map((t) => t.id);
    expect(ids).toContain('github-dark');
    expect(ids).toContain('github-light');
    expect(ids).toContain('dracula');
    expect(ids).toContain('nord');
    expect(ids).toContain('one-dark-pro');
  });

  it('every theme has an id, name, dark flag, and group', () => {
    for (const t of getSyntaxThemeCatalog()) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(typeof t.dark).toBe('boolean');
      expect(['light', 'dark', 'neutral']).toContain(t.group);
    }
  });

  it('groups themes into light / dark / neutral', () => {
    const grouped = getGroupedSyntaxThemes();
    expect(grouped.light.length).toBeGreaterThan(0);
    expect(grouped.dark.length).toBeGreaterThan(0);
    // All light themes should have dark=false.
    for (const t of grouped.light) {
      expect(t.dark).toBe(false);
    }
    // All dark themes should have dark=true.
    for (const t of grouped.dark) {
      expect(t.dark).toBe(true);
    }
  });

  it('findSyntaxTheme returns the matching theme', () => {
    const t = findSyntaxTheme('dracula');
    expect(t).toBeDefined();
    expect(t?.id).toBe('dracula');
    expect(t?.dark).toBe(true);
  });

  it('findSyntaxTheme returns undefined for unknown theme', () => {
    expect(findSyntaxTheme('not-a-real-theme')).toBeUndefined();
  });

  it('resolveSyntaxTheme returns the id if valid', () => {
    expect(resolveSyntaxTheme('github-dark')).toBe('github-dark');
    expect(resolveSyntaxTheme('github-light')).toBe('github-light');
  });

  it('resolveSyntaxTheme falls back to default for invalid id', () => {
    expect(resolveSyntaxTheme('not-real')).toBe(DEFAULT_SYNTAX_THEME);
    expect(resolveSyntaxTheme(null)).toBe(DEFAULT_SYNTAX_THEME);
    expect(resolveSyntaxTheme(undefined)).toBe(DEFAULT_SYNTAX_THEME);
  });

  it('github-light is classified as light, github-dark as dark', () => {
    expect(findSyntaxTheme('github-light')?.dark).toBe(false);
    expect(findSyntaxTheme('github-dark')?.dark).toBe(true);
  });

  it('theme names are human-readable (not raw ids)', () => {
    const t = findSyntaxTheme('github-dark');
    expect(t?.name).toBe('GitHub Dark');
    const t2 = findSyntaxTheme('one-dark-pro');
    expect(t2?.name).toBe('One Dark Pro');
  });
});
