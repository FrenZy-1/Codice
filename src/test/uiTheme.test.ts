import { describe, expect, it, beforeEach } from 'vitest';
import {
  LIGHT_TOKENS,
  DARK_TOKENS,
  applyUITheme,
  getInitialUITheme,
  persistUITheme,
  type UIThemeMode,
} from '../lib/themes/uiTheme';

describe('uiTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('LIGHT_TOKENS and DARK_TOKENS have all required keys', () => {
    const required = [
      'background',
      'surface',
      'surfaceElevated',
      'textPrimary',
      'textSecondary',
      'textMuted',
      'textDisabled',
      'textInverse',
      'border',
      'borderMuted',
      'inputBackground',
      'inputBorder',
      'accent',
      'accentHover',
      'accentText',
      'success',
      'successText',
      'warning',
      'warningText',
      'error',
      'errorText',
      'codeBackground',
      'codeText',
    ];
    for (const key of required) {
      expect(LIGHT_TOKENS).toHaveProperty(key);
      expect(DARK_TOKENS).toHaveProperty(key);
    }
  });

  it('light textPrimary is dark, dark textPrimary is light', () => {
    // The whole point of the bug fix — light backgrounds need dark text,
    // dark backgrounds need light text.
    expect(LIGHT_TOKENS.textPrimary).toMatch(/^#/);
    expect(DARK_TOKENS.textPrimary).toMatch(/^#/);
    // Light theme: text should be darker than background.
    const lightTextLuma = luma(LIGHT_TOKENS.textPrimary);
    const lightBgLuma = luma(LIGHT_TOKENS.background);
    expect(lightTextLuma).toBeLessThan(lightBgLuma);
    // Dark theme: text should be lighter than background.
    const darkTextLuma = luma(DARK_TOKENS.textPrimary);
    const darkBgLuma = luma(DARK_TOKENS.background);
    expect(darkTextLuma).toBeGreaterThan(darkBgLuma);
  });

  it('textInverse contrasts with the accent color in both themes', () => {
    // textInverse is used on accent-colored buttons. Verify the contrast
    // direction is reasonable (one is light, one is dark) relative to accent.
    const lightAccentLuma = luma(LIGHT_TOKENS.accent);
    const lightInverseLuma = luma(LIGHT_TOKENS.textInverse);
    const darkAccentLuma = luma(DARK_TOKENS.accent);
    const darkInverseLuma = luma(DARK_TOKENS.textInverse);
    // At least one of (light inverse, dark inverse) should differ from
    // its accent by a meaningful amount — i.e. they're not the same color.
    expect(Math.abs(lightAccentLuma - lightInverseLuma)).toBeGreaterThan(50);
    expect(Math.abs(darkAccentLuma - darkInverseLuma)).toBeGreaterThan(50);
  });

  it('applyUITheme sets data-theme attribute', () => {
    applyUITheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyUITheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('applyUITheme sets CSS custom properties', () => {
    applyUITheme('dark');
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-background');
    expect(bg).toBe(DARK_TOKENS.background);
    const text = getComputedStyle(document.documentElement).getPropertyValue('--color-text-primary');
    expect(text).toBe(DARK_TOKENS.textPrimary);
  });

  it('applyUITheme swaps colors when switching modes', () => {
    applyUITheme('dark');
    const darkBg = getComputedStyle(document.documentElement).getPropertyValue('--color-background');
    applyUITheme('light');
    const lightBg = getComputedStyle(document.documentElement).getPropertyValue('--color-background');
    expect(darkBg).not.toBe(lightBg);
  });

  it('repeated switching does not leave stale values', () => {
    const modes: UIThemeMode[] = ['dark', 'light', 'dark', 'light', 'dark', 'light'];
    for (const m of modes) {
      applyUITheme(m);
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-background');
      const text = getComputedStyle(document.documentElement).getPropertyValue('--color-text-primary');
      if (m === 'dark') {
        expect(bg).toBe(DARK_TOKENS.background);
        expect(text).toBe(DARK_TOKENS.textPrimary);
      } else {
        expect(bg).toBe(LIGHT_TOKENS.background);
        expect(text).toBe(LIGHT_TOKENS.textPrimary);
      }
    }
  });

  it('persistUITheme + getInitialUITheme round-trip', () => {
    persistUITheme('light');
    expect(getInitialUITheme()).toBe('light');
    persistUITheme('dark');
    expect(getInitialUITheme()).toBe('dark');
  });

  it('getInitialUITheme defaults to dark when nothing persisted', () => {
    expect(getInitialUITheme()).toBe('dark');
  });
});

/** Compute perceived luma (Rec. 709) for a hex color. */
function luma(hex: string): number {
  const h = hex.replace(/^#/, '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
