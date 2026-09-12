/**
 * Font catalog for the font selector.
 *
 * Provides body fonts and code fonts with sensible fallback stacks. The
 * selector displays each font in its own appearance so users can preview
 * before choosing.
 */

export interface FontOption {
  /** The canonical font name to store in the preset. */
  value: string;
  /** Display label. */
  label: string;
  /** Full CSS font-family stack including fallbacks. */
  stack: string;
  /** Category for grouping in the selector. */
  category: 'body' | 'code';
}

/** Body fonts available in the selector. */
export const BODY_FONTS: FontOption[] = [
  {
    value: 'Inter',
    label: 'Inter',
    stack: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
    category: 'body',
  },
  {
    value: 'system-ui',
    label: 'System UI',
    stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    category: 'body',
  },
  {
    value: 'Arial',
    label: 'Arial',
    stack: 'Arial, Helvetica, sans-serif',
    category: 'body',
  },
  {
    value: 'Helvetica',
    label: 'Helvetica',
    stack: 'Helvetica, Arial, sans-serif',
    category: 'body',
  },
  {
    value: 'Georgia',
    label: 'Georgia',
    stack: 'Georgia, "Times New Roman", serif',
    category: 'body',
  },
  {
    value: 'Times New Roman',
    label: 'Times New Roman',
    stack: '"Times New Roman", Times, Georgia, serif',
    category: 'body',
  },
  {
    value: 'Garamond',
    label: 'Garamond',
    stack: 'Garamond, "Times New Roman", serif',
    category: 'body',
  },
  {
    value: 'Calibri',
    label: 'Calibri',
    stack: 'Calibri, "Segoe UI", Arial, sans-serif',
    category: 'body',
  },
  {
    value: 'Cambria',
    label: 'Cambria',
    stack: 'Cambria, Georgia, serif',
    category: 'body',
  },
];

/** Code (monospace) fonts available in the selector. */
export const CODE_FONTS: FontOption[] = [
  {
    value: 'JetBrains Mono',
    label: 'JetBrains Mono',
    stack: '"JetBrains Mono", "Fira Code", "Source Code Pro", "IBM Plex Mono", Menlo, Consolas, monospace',
    category: 'code',
  },
  {
    value: 'Fira Code',
    label: 'Fira Code',
    stack: '"Fira Code", "JetBrains Mono", Consolas, monospace',
    category: 'code',
  },
  {
    value: 'Source Code Pro',
    label: 'Source Code Pro',
    stack: '"Source Code Pro", "JetBrains Mono", Consolas, monospace',
    category: 'code',
  },
  {
    value: 'IBM Plex Mono',
    label: 'IBM Plex Mono',
    stack: '"IBM Plex Mono", "Source Code Pro", Consolas, monospace',
    category: 'code',
  },
  {
    value: 'Consolas',
    label: 'Consolas',
    stack: 'Consolas, "Courier New", monospace',
    category: 'code',
  },
  {
    value: 'Courier New',
    label: 'Courier New',
    stack: '"Courier New", Courier, monospace',
    category: 'code',
  },
  {
    value: 'Menlo',
    label: 'Menlo',
    stack: 'Menlo, Consolas, "JetBrains Mono", monospace',
    category: 'code',
  },
  {
    value: 'monospace',
    label: 'System Monospace',
    stack: 'monospace',
    category: 'code',
  },
];

/** All fonts combined. */
export const ALL_FONTS: FontOption[] = [...BODY_FONTS, ...CODE_FONTS];

/** Look up a font option by its stored value. */
export function findFont(value: string): FontOption | undefined {
  return ALL_FONTS.find((f) => f.value === value);
}

/** Get the full CSS stack for a stored font value. Falls back to the raw value. */
export function fontStack(value: string | undefined): string {
  if (!value) return 'sans-serif';
  const found = findFont(value);
  return found?.stack ?? value;
}

/** Return all body fonts. */
export function getBodyFonts(): FontOption[] {
  return BODY_FONTS;
}

/** Return all code fonts. */
export function getCodeFonts(): FontOption[] {
  return CODE_FONTS;
}
