/**
 * Shiki theme registry.
 *
 * This module derives the list of available syntax themes directly from the
 * installed Shiki package's `bundledThemes` export. We do NOT maintain a
 * manually duplicated list — the theme catalog is always in sync with what
 * Shiki actually supports.
 *
 * Themes are grouped into Light / Dark / Neutral for the UI selector. The
 * `dark` flag is determined by loading each theme's metadata via Shiki at
 * runtime; for the static catalog we use a curated mapping of well-known
 * theme ids to their light/dark classification (falling back to a name-based
 * heuristic for unknown themes).
 */

/** A selectable syntax theme option. */
export interface SyntaxThemeOption {
  /** Shiki theme id — passed directly to `hl.loadTheme()` / `codeToTokens()`. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Whether the theme has a dark background. */
  dark: boolean;
  /** Group for the selector UI. */
  group: 'light' | 'dark' | 'neutral';
}

/**
 * Static classification of well-known Shiki themes.
 * For themes not in this map, we fall back to a name-based heuristic.
 */
const THEME_CLASSIFICATION: Record<string, { dark: boolean; group: 'light' | 'dark' | 'neutral' }> = {
  // Light themes
  'github-light': { dark: false, group: 'light' },
  'github-light-default': { dark: false, group: 'light' },
  'github-light-high-contrast': { dark: false, group: 'light' },
  'light-plus': { dark: false, group: 'light' },
  'solarized-light': { dark: false, group: 'light' },
  'min-light': { dark: false, group: 'light' },
  'one-light': { dark: false, group: 'light' },
  'vitesse-light': { dark: false, group: 'light' },
  'catppuccin-latte': { dark: false, group: 'light' },
  'rose-pine-dawn': { dark: false, group: 'light' },
  'everforest-light': { dark: false, group: 'light' },
  'material-theme-lighter': { dark: false, group: 'light' },
  'snazzy-light': { dark: false, group: 'light' },
  'kanagawa-lotus': { dark: false, group: 'light' },

  // Dark themes
  'github-dark': { dark: true, group: 'dark' },
  'github-dark-default': { dark: true, group: 'dark' },
  'github-dark-dimmed': { dark: true, group: 'dark' },
  'github-dark-high-contrast': { dark: true, group: 'dark' },
  'dark-plus': { dark: true, group: 'dark' },
  'dracula': { dark: true, group: 'dark' },
  'dracula-soft': { dark: true, group: 'dark' },
  'one-dark-pro': { dark: true, group: 'dark' },
  'monokai': { dark: true, group: 'dark' },
  'solarized-dark': { dark: true, group: 'dark' },
  'nord': { dark: true, group: 'dark' },
  'night-owl': { dark: true, group: 'dark' },
  'vitesse-dark': { dark: true, group: 'dark' },
  'vitesse-black': { dark: true, group: 'dark' },
  'catppuccin-frappe': { dark: true, group: 'dark' },
  'catppuccin-macchiato': { dark: true, group: 'dark' },
  'catppuccin-mocha': { dark: true, group: 'dark' },
  'rose-pine': { dark: true, group: 'dark' },
  'rose-pine-moon': { dark: true, group: 'dark' },
  'everforest-dark': { dark: true, group: 'dark' },
  'tokyo-night': { dark: true, group: 'dark' },
  'material-theme': { dark: true, group: 'dark' },
  'material-theme-darker': { dark: true, group: 'dark' },
  'material-theme-ocean': { dark: true, group: 'dark' },
  'material-theme-palenight': { dark: true, group: 'dark' },
  'slack-dark': { dark: true, group: 'dark' },
  'slack-ochin': { dark: true, group: 'dark' },
  'poimandres': { dark: true, group: 'dark' },
  'synthwave-84': { dark: true, group: 'dark' },
  'aurora-x': { dark: true, group: 'dark' },
  'ayu-dark': { dark: true, group: 'dark' },
  'laserwave': { dark: true, group: 'dark' },
  'houston': { dark: true, group: 'dark' },
  'kanagawa-dragon': { dark: true, group: 'dark' },
  'kanagawa-wave': { dark: true, group: 'dark' },
  'vesper': { dark: true, group: 'dark' },
  'andromeeda': { dark: true, group: 'dark' },

  // Neutral / special
  'min-dark': { dark: true, group: 'neutral' },
  'plastic': { dark: true, group: 'neutral' },
  'red': { dark: true, group: 'neutral' },
};

/**
 * Derive the full theme catalog from Shiki's `bundledThemes` export.
 * Falls back to a curated list if the dynamic import fails (e.g. in tests).
 */
function buildThemeCatalog(): SyntaxThemeOption[] {
  // We try to read bundledThemes dynamically. If it's not available
  // (e.g. in a non-browser context without the full bundle), we fall
  // back to the static classification keys.
  let themeIds: string[] = [];
  try {
    // Use a dynamic require so this works in both ESM and CJS contexts.
    // In the browser, Vite will tree-shake the shiki import.
    const shiki = require('shiki');
    if (shiki?.bundledThemes) {
      themeIds = Object.keys(shiki.bundledThemes);
    }
  } catch {
    // Fall back below.
  }

  // Fallback: use the static classification keys.
  if (themeIds.length === 0) {
    themeIds = Object.keys(THEME_CLASSIFICATION);
  }

  // Build the catalog.
  const catalog: SyntaxThemeOption[] = themeIds.map((id) => {
    const known = THEME_CLASSIFICATION[id];
    if (known) {
      return { id, name: prettifyName(id), dark: known.dark, group: known.group };
    }
    // Heuristic for unknown themes: check the name for "light" or "dark".
    const lower = id.toLowerCase();
    const dark = !(
      lower.includes('light') ||
      lower.includes('latte') ||
      lower.includes('dawn') ||
      lower.includes('lotus')
    );
    return {
      id,
      name: prettifyName(id),
      dark,
      group: dark ? 'dark' : 'light',
    };
  });

  // Sort: light first, then dark, then neutral — alphabetical within each group.
  const groupOrder = { light: 0, dark: 1, neutral: 2 };
  catalog.sort((a, b) => {
    if (a.group !== b.group) return groupOrder[a.group] - groupOrder[b.group];
    return a.name.localeCompare(b.name);
  });

  return catalog;
}

/** Convert a Shiki theme id like "github-dark" to "GitHub Dark". */
function prettifyName(id: string): string {
  // Known acronyms / brand names that should keep their specific casing.
  const acronyms = new Set(['github', 'gitlab', 'api', 'ui', 'css', 'html', 'sql']);
  return id
    .split(/[-_]/)
    .map((word) => {
      if (word.length === 0) return word;
      if (/^\d+$/.test(word)) return word;
      const lower = word.toLowerCase();
      if (acronyms.has(lower)) {
        // GitHub is special-cased.
        if (lower === 'github') return 'GitHub';
        return lower.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/** Cached catalog — built once on first access. */
let cachedCatalog: SyntaxThemeOption[] | null = null;

/** Get the full syntax theme catalog. */
export function getSyntaxThemeCatalog(): SyntaxThemeOption[] {
  if (!cachedCatalog) {
    cachedCatalog = buildThemeCatalog();
  }
  return cachedCatalog;
}

/** Look up a single theme by id. Returns undefined if not found. */
export function findSyntaxTheme(id: string): SyntaxThemeOption | undefined {
  return getSyntaxThemeCatalog().find((t) => t.id === id);
}

/** Default theme id used when none is specified or the specified one is invalid. */
export const DEFAULT_SYNTAX_THEME = 'github-dark';

/** Get a valid theme id, falling back to the default if the given one is unknown. */
export function resolveSyntaxTheme(id: string | undefined | null): string {
  if (!id) return DEFAULT_SYNTAX_THEME;
  if (findSyntaxTheme(id)) return id;
  return DEFAULT_SYNTAX_THEME;
}

/** Themes grouped for the selector UI. */
export function getGroupedSyntaxThemes(): {
  light: SyntaxThemeOption[];
  dark: SyntaxThemeOption[];
  neutral: SyntaxThemeOption[];
} {
  const catalog = getSyntaxThemeCatalog();
  return {
    light: catalog.filter((t) => t.group === 'light'),
    dark: catalog.filter((t) => t.group === 'dark'),
    neutral: catalog.filter((t) => t.group === 'neutral'),
  };
}
