/**
 * Unicode-glyph fallback font loading (§21).
 *
 * The PDF exporter embeds "DejaVu Sans Mono" so ONLY the box-drawing glyph
 * runs (├ └ │ ─) can render — the user's selected font stays the primary
 * font for everything else, and no ASCII substitution ever happens.
 *
 * In the browser the TTFs are fetched from /fonts. Headless harnesses
 * (export QA scripts) can inject the same fonts from disk via
 * setGlyphFontOverride — the exporter behavior is identical either way;
 * if no font is available at all, glyphs are never ASCII-substituted
 * (documented degradation: viewer-side fallback may save us).
 */

/** Canonical Unicode-capable fallback font family name. */
export const GLYPH_FALLBACK_FONT = 'DejaVu Sans Mono';

let override: { normal: string; bold: string } | null = null;
let cache: { normal: string; bold: string } | null | undefined;

/** Inject font data (base64) — used by headless export harnesses. */
export function setGlyphFontOverride(fonts: { normal: string; bold: string } | null): void {
  override = fonts;
  cache = undefined;
}

async function fetchFontBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font fetch failed: ${url}`);
  const buf = await res.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Load (and cache) the Unicode fallback fonts. Returns null when unavailable. */
export async function loadGlyphFonts(): Promise<{ normal: string; bold: string } | null> {
  if (cache !== undefined) return cache;
  if (override) {
    cache = override;
    return cache;
  }
  try {
    const [normal, bold] = await Promise.all([
      fetchFontBase64('/fonts/DejaVuSansMono.ttf'),
      fetchFontBase64('/fonts/DejaVuSansMono-Bold.ttf'),
    ]);
    cache = { normal, bold };
  } catch {
    cache = null;
  }
  return cache;
}
