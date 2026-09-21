/**
 * Targeted Unicode fallback for box-drawing glyphs.
 *
 * Project trees (and occasionally source code) contain the Unicode
 * box-drawing characters:
 *
 *     ├  └  │  ─
 *
 * Many user-selected fonts (and all PDF standard 14 fonts) cannot render
 * them. The rule is:
 *
 *   - The characters themselves are NEVER replaced or transliterated.
 *   - Normal characters keep the user's selected font.
 *   - ONLY segments containing the box-drawing glyphs switch to a
 *     Unicode-capable fallback font ("DejaVu Sans Mono").
 *
 * Exporters split text into runs at glyph boundaries using splitRuns() and
 * render each run with its own font. The HTML preview achieves the same
 * per-glyph fallback via a CSS font stack ending in DejaVu Sans Mono.
 */

/** The box-drawing glyphs that require the fallback font. */
export const BOX_DRAWING_GLYPHS = ['├', '└', '│', '─'] as const;

const BOX_GLYPH_RE = /[\u251C\u2514\u2502\u2500]/;

/** True if the text contains at least one box-drawing glyph. */
export function containsBoxGlyphs(text: string): boolean {
  return BOX_GLYPH_RE.test(text);
}

/** Canonical Unicode-capable fallback font family name. */
export const GLYPH_FALLBACK_FONT = 'DejaVu Sans Mono';

/** A run of text rendered with a specific font choice. */
export interface FontRun {
  text: string;
  /** true → render with the Unicode fallback font. */
  fallback: boolean;
}

/**
 * Split text into consecutive runs keyed by whether they contain
 * box-drawing glyphs. Adjacent runs with the same flag are merged.
 *
 * Whitespace directly adjacent to a glyph joins the fallback run so tree
 * prefixes (e.g. "│   ├── ") keep consistent monospace metrics even when
 * the fallback font has slightly different space widths.
 *
 * Example:
 *   splitRuns('├── src/Main.kt') →
 *     [ { text: '├── ', fallback: true }, { text: 'src/Main.kt', fallback: false } ]
 */
export function splitRuns(text: string): FontRun[] {
  if (!text) return [];
  const chars = Array.from(text);
  const flags = chars.map((ch) => BOX_GLYPH_RE.test(ch));
  const isWs = (ch: string) => /\s/.test(ch);

  // Pull whitespace into neighboring glyph runs (fixed-point propagation).
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < chars.length; i++) {
      if (!flags[i] && isWs(chars[i])) {
        const prevIsGlyph = i > 0 && flags[i - 1];
        const nextIsGlyph = i < chars.length - 1 && flags[i + 1];
        if (prevIsGlyph || nextIsGlyph) {
          flags[i] = true;
          changed = true;
        }
      }
    }
  }

  const runs: FontRun[] = [];
  let current = '';
  let currentFallback = flags[0];
  for (let i = 0; i < chars.length; i++) {
    if (flags[i] === currentFallback) {
      current += chars[i];
    } else {
      runs.push({ text: current, fallback: currentFallback });
      current = chars[i];
      currentFallback = flags[i];
    }
  }
  runs.push({ text: current, fallback: currentFallback });
  return runs;
}

/**
 * Split an array of tree/code lines into per-line runs. Convenience wrapper
 * used by the exporters.
 */
export function splitLinesRuns(lines: string[]): FontRun[][] {
  return lines.map((line) => splitRuns(line));
}
