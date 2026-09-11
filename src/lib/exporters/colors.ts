/**
 * Color utilities shared across exporters.
 */

/** Parse a hex color (#rgb, #rrggbb, or #rrggbbaa) into RGB components. */
export function parseHex(hex: string): { r: number; g: number; b: number } {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (h.length === 8) {
    h = h.slice(0, 6);
  }
  if (h.length !== 6) {
    return { r: 0, g: 0, b: 0 };
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return { r: 0, g: 0, b: 0 };
  }
  return { r, g, b };
}

/** Convert hex to a CSS-style rgb() string. */
export function hexToRgb(hex: string): string {
  const { r, g, b } = parseHex(hex);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Decide whether a colour is "light" (and thus needs dark text on top). */
export function isLightColor(hex: string): boolean {
  const { r, g, b } = parseHex(hex);
  // Perceived brightness (Rec. 709 luma).
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return y > 140;
}

/** Mix two hex colors. t=0 -> a, t=1 -> b. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const r = Math.round(ca.r + (cb.r - ca.r) * t);
  const g = Math.round(ca.g + (cb.g - ca.g) * t);
  const bl = Math.round(ca.b + (cb.b - ca.b) * t);
  return `#${[r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
