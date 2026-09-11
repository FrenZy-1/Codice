import { describe, expect, it } from 'vitest';
import {
  BODY_FONTS,
  CODE_FONTS,
  ALL_FONTS,
  findFont,
  fontStack,
  getBodyFonts,
  getCodeFonts,
} from '../lib/fonts/fontCatalog';

describe('fontCatalog', () => {
  it('contains body fonts', () => {
    expect(BODY_FONTS.length).toBeGreaterThan(3);
    const values = BODY_FONTS.map((f) => f.value);
    expect(values).toContain('Inter');
    expect(values).toContain('Times New Roman');
    expect(values).toContain('Arial');
    expect(values).toContain('Helvetica');
    expect(values).toContain('system-ui');
  });

  it('contains code fonts', () => {
    expect(CODE_FONTS.length).toBeGreaterThan(3);
    const values = CODE_FONTS.map((f) => f.value);
    expect(values).toContain('JetBrains Mono');
    expect(values).toContain('Fira Code');
    expect(values).toContain('Source Code Pro');
    expect(values).toContain('Consolas');
    expect(values).toContain('Courier New');
    expect(values).toContain('monospace');
  });

  it('every font has a fallback stack ending in a generic family', () => {
    for (const f of ALL_FONTS) {
      // Generic family at the end is critical for portability.
      const last = f.stack.split(',').pop()!.trim();
      expect(last).toMatch(/^(sans-serif|serif|monospace)$/);
    }
  });

  it('findFont returns the matching option', () => {
    const f = findFont('JetBrains Mono');
    expect(f).toBeDefined();
    expect(f?.category).toBe('code');
  });

  it('findFont returns undefined for unknown font', () => {
    expect(findFont('Definitely Not A Font')).toBeUndefined();
  });

  it('fontStack returns the full stack for known fonts', () => {
    const stack = fontStack('Inter');
    expect(stack).toContain('Inter');
    expect(stack).toContain('sans-serif');
  });

  it('fontStack falls back to the raw value for unknown fonts', () => {
    expect(fontStack('Comic Sans MS')).toBe('Comic Sans MS');
  });

  it('fontStack handles undefined', () => {
    expect(fontStack(undefined)).toBe('sans-serif');
  });

  it('getBodyFonts and getCodeFonts return correct categories', () => {
    for (const f of getBodyFonts()) {
      expect(f.category).toBe('body');
    }
    for (const f of getCodeFonts()) {
      expect(f.category).toBe('code');
    }
  });
});
