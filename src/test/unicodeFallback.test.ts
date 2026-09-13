/**
 * Tests for the targeted Unicode fallback (box-drawing glyphs).
 *
 * Spec §12–§14: the characters ├ └ │ ─ must remain EXACTLY as-is; only the
 * rendering font changes for unsupported instances; normal characters keep
 * the user's selected font.
 */

import { describe, expect, it } from 'vitest';
import {
  splitRuns,
  containsBoxGlyphs,
  splitLinesRuns,
  GLYPH_FALLBACK_FONT,
  BOX_DRAWING_GLYPHS,
} from '../lib/exporters/unicodeFallback';

describe('splitRuns — character preservation', () => {
  it('never alters the characters (round-trip join)', () => {
    const inputs = [
      '├── src/',
      '└── Main.kt',
      '│   ├── kotlin/',
      'project/\n├── src/\n│   └── Main.kt\n└── README.md',
      'plain code without glyphs',
      '├└│─',
    ];
    for (const input of inputs) {
      const joined = splitRuns(input)
        .map((r) => r.text)
        .join('');
      expect(joined).toBe(input);
    }
  });

  it('no ASCII substitution ever happens', () => {
    const line = '├── build.gradle.kts';
    const runs = splitRuns(line);
    for (const run of runs) {
      expect(run.text).not.toContain('|');
      expect(run.text).not.toContain('--');
      expect(run.text).not.toContain('`--');
    }
  });

  it('all four glyphs are covered by the fallback set', () => {
    for (const glyph of BOX_DRAWING_GLYPHS) {
      expect(containsBoxGlyphs(`x ${glyph} y`)).toBe(true);
    }
    expect(containsBoxGlyphs('no glyphs here')).toBe(false);
  });
});

describe('splitRuns — run classification', () => {
  it('glyph segments are marked for the fallback font', () => {
    const runs = splitRuns('├── src/Main.kt');
    expect(runs[0]).toEqual({ text: '├── ', fallback: true });
    expect(runs[1]).toEqual({ text: 'src/Main.kt', fallback: false });
  });

  it('normal text stays in non-fallback runs', () => {
    const runs = splitRuns('fun main() { println("Hi") }');
    expect(runs).toHaveLength(1);
    expect(runs[0].fallback).toBe(false);
  });

  it('a glyph inside code splits only the affected run', () => {
    const runs = splitRuns('val tree = "├── a"');
    expect(runs.some((r) => r.fallback && r.text.includes('├'))).toBe(true);
    expect(runs.some((r) => !r.fallback && r.text.includes('val tree'))).toBe(true);
  });

  it('adjacent glyphs merge into a single fallback run', () => {
    const runs = splitRuns('│   ├── ');
    expect(runs).toHaveLength(1);
    expect(runs[0].fallback).toBe(true);
  });

  it('empty text produces no runs', () => {
    expect(splitRuns('')).toEqual([]);
  });
});

describe('splitLinesRuns', () => {
  it('splits each line independently', () => {
    const lines = ['└── a', 'plain'];
    const result = splitLinesRuns(lines);
    expect(result).toHaveLength(2);
    expect(result[0][0].fallback).toBe(true);
    expect(result[1][0].fallback).toBe(false);
  });
});

describe('fallback font name', () => {
  it('is a Unicode-capable font, not an ASCII substitute', () => {
    expect(GLYPH_FALLBACK_FONT).toBe('DejaVu Sans Mono');
  });
});
