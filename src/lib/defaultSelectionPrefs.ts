/**
 * Default file-selection preferences (§46).
 *
 * A persistent user configuration that decides which files are selected
 * when projects are uploaded:
 *
 *   Default rules (this module, applied at discovery)
 *       ↓
 *   Project/import rules (per-project selection rules)
 *       ↓
 *   Manual include/exclude overrides (explicit per-file toggles)
 *
 * The prefs are applied ONLY at upload/discovery time — changing them
 * never destructively rewrites already-loaded projects (§46).
 */

import type { FilterConfig } from '@/lib/defaultExclusions';
import { defaultFilterConfig } from '@/lib/defaultExclusions';

const STORAGE_KEY = 'codice-default-selection-v1';

/** The user's default file-selection preferences (all optional-ish). */
export interface DefaultSelectionPrefs {
  /** Extra extensions to EXCLUDE on upload (e.g. "csv, log"). */
  excludeExtensions: string[];
  /** Extensions to FORCE-include even when defaults exclude them. */
  includeExtensions: string[];
  /** Extra glob patterns to exclude (gitignore syntax, e.g. build trees). */
  excludePatterns: string[];
  /** Glob patterns to force-include (gitignore syntax, any depth). */
  includePatterns: string[];
  /** Extra directory names to exclude (any path segment, e.g. "vendor"). */
  excludeDirectories: string[];
}

export const DEFAULT_SELECTION_PREFS: DefaultSelectionPrefs = {
  excludeExtensions: [],
  includeExtensions: [],
  excludePatterns: [],
  includePatterns: [],
  excludeDirectories: [],
};

/** Parse a raw user input string into clean tokens (comma/newline/semicolon/space). */
export function parsePrefList(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\n,;\s]+/)
        .map((t) => t.replace(/^\*/, '').replace(/^\./, '').toLowerCase())
        .filter((t) => t.length > 0),
    ),
  );
}

/** Parse pattern lists (globs keep their structure, split on lines/commas). */
export function parsePrefPatterns(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\n,]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    ),
  );
}

/** Load the persisted prefs (falls back to defaults on any corruption). */
export function loadDefaultSelectionPrefs(): DefaultSelectionPrefs {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_SELECTION_PREFS };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SELECTION_PREFS };
    const parsed = JSON.parse(raw) as Partial<DefaultSelectionPrefs>;
    const list = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    return {
      excludeExtensions: list(parsed.excludeExtensions),
      includeExtensions: list(parsed.includeExtensions),
      excludePatterns: list(parsed.excludePatterns),
      includePatterns: list(parsed.includePatterns),
      excludeDirectories: list(parsed.excludeDirectories),
    };
  } catch {
    return { ...DEFAULT_SELECTION_PREFS };
  }
}

/** Persist the prefs. Quota/private-mode failures are swallowed (§64). */
export function saveDefaultSelectionPrefs(prefs: DefaultSelectionPrefs): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* best-effort persistence */
  }
}

/** Reset to shipping defaults (used by the dialog's Reset button). */
export function resetDefaultSelectionPrefs(): DefaultSelectionPrefs {
  const prefs = { ...DEFAULT_SELECTION_PREFS };
  saveDefaultSelectionPrefs(prefs);
  return prefs;
}

/**
 * Merge the user's prefs into a FilterConfig used for the NEXT upload.
 *
 * Precedence inside the config (matches makeFile's logic):
 *   1. forced includes (includeGlobs — prefs' includeExtensions become
 *      `*.ext` basename globs, plus includePatterns verbatim)
 *   2. default + user exclusions (extensions / dirs / patterns)
 */
export function applyPrefsToFilterConfig(
  prefs: DefaultSelectionPrefs,
  base: FilterConfig = defaultFilterConfig(),
): FilterConfig {
  const includeGlobs = [
    ...base.includeGlobs,
    ...prefs.includePatterns,
    ...prefs.includeExtensions.map((ext) => `*.${ext.replace(/^\./, '')}`),
  ];
  const excludeGlobs = [...base.excludeGlobs, ...prefs.excludePatterns];
  const excludedExtensions = Array.from(
    new Set([...base.excludedExtensions, ...prefs.excludeExtensions]),
  ).filter((ext) => !prefs.includeExtensions.includes(ext));
  const excludedDirs = Array.from(
    new Set([...base.excludedDirs, ...prefs.excludeDirectories.map((d) => d.toLowerCase())]),
  );
  return {
    ...base,
    includeGlobs,
    excludeGlobs,
    excludedExtensions,
    excludedDirs,
  };
}
