/**
 * Semantic UI theme tokens.
 *
 * The application shell uses CSS custom properties that swap between light
 * and dark values. Components reference these tokens via Tailwind utility
 * aliases (e.g. `bg-surface`, `text-secondary`) — they should never use
 * raw hex colors for chrome text/backgrounds.
 *
 * Syntax highlighting colors are NOT part of this theme — those come from
 * the selected Shiki syntax theme and are intentionally fixed per theme.
 */

export type UIThemeMode = 'light' | 'dark';

/** Token values for one mode. */
export interface UIThemeTokens {
  background: string;
  surface: string;
  surfaceElevated: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDisabled: string;
  textInverse: string;
  border: string;
  borderMuted: string;
  inputBackground: string;
  inputBorder: string;
  accent: string;
  accentHover: string;
  accentText: string;
  success: string;
  successText: string;
  warning: string;
  warningText: string;
  error: string;
  errorText: string;
  codeBackground: string;
  codeText: string;
}

export const LIGHT_TOKENS: UIThemeTokens = {
  background: '#ffffff',
  surface: '#f6f8fa',
  surfaceElevated: '#ffffff',
  textPrimary: '#1f2328',
  textSecondary: '#59636e',
  textMuted: '#818b98',
  textDisabled: '#afb8c1',
  textInverse: '#ffffff',
  border: '#d0d7de',
  borderMuted: '#e7eaed',
  inputBackground: '#ffffff',
  inputBorder: '#d0d7de',
  accent: '#0969da',
  accentHover: '#218bff',
  accentText: '#ffffff',
  success: '#1a7f37',
  successText: '#1a7f37',
  warning: '#9a6700',
  warningText: '#9a6700',
  error: '#cf222e',
  errorText: '#cf222e',
  codeBackground: '#f6f8fa',
  codeText: '#1f2328',
};

export const DARK_TOKENS: UIThemeTokens = {
  background: '#0d1117',
  surface: '#161b22',
  surfaceElevated: '#1c2128',
  textPrimary: '#e6edf3',
  textSecondary: '#9198a1',
  textMuted: '#6e7681',
  textDisabled: '#484f58',
  textInverse: '#0d1117',
  border: '#30363d',
  borderMuted: '#21262d',
  inputBackground: '#0d1117',
  inputBorder: '#30363d',
  accent: '#2f81f7',
  accentHover: '#388bfd',
  accentText: '#ffffff',
  success: '#3fb950',
  successText: '#3fb950',
  warning: '#d29922',
  warningText: '#d29922',
  error: '#f85149',
  errorText: '#f85149',
  codeBackground: '#161b22',
  codeText: '#e6edf3',
};

/** Apply theme tokens to the document root as CSS custom properties. */
export function applyUITheme(mode: UIThemeMode) {
  const tokens = mode === 'dark' ? DARK_TOKENS : LIGHT_TOKENS;
  const root = document.documentElement;
  root.setAttribute('data-theme', mode);
  for (const [key, value] of Object.entries(tokens)) {
    // Convert camelCase to kebab-case CSS variable name.
    const cssName = '--color-' + key.replace(/([A-Z])/g, '-$1').toLowerCase();
    root.style.setProperty(cssName, value);
  }
}

/** Get the preferred initial theme (system or persisted). */
export function getInitialUITheme(): UIThemeMode {
  try {
    const persisted = localStorage.getItem('codice-ui-theme');
    if (persisted === 'light' || persisted === 'dark') return persisted;
  } catch {
    // ignore
  }
  if (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'dark'; // default to dark — feels like a developer tool
}

/** Persist the user's theme choice. */
export function persistUITheme(mode: UIThemeMode) {
  try {
    localStorage.setItem('codice-ui-theme', mode);
  } catch {
    // ignore
  }
}
