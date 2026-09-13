/**
 * Per-project selection rules — glob patterns that deselect matching files.
 *
 * Rules live OUTSIDE the discovery filter: they operate on already-discovered
 * files at selection time, so they never require a re-scan and they are
 * immediately reflected in the file tree, statistics, and exports.
 *
 * Semantics (mirroring getSelectedFiles in useAppState):
 *   - a file matching ANY rule is deselected by default
 *   - an explicit user inclusion (checkbox re-checked) overrides rules
 *   - an explicit user exclusion (checkbox unchecked) always wins
 *
 * Pattern syntax is the shared minimal glob (see ./glob.ts):
 *   - no slash in the pattern  → matched against the BASENAME
 *   - contains a slash or **   → matched against the full relative path
 */

import type { DiscoveredFile } from '@/types';
import { matchGlob } from './glob';

/** Test whether a single file matches a selection rule pattern. */
export function fileMatchesRule(file: DiscoveredFile, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  return matchGlob(file.relativePath, trimmed);
}

/** Test whether a file is deselected by any of the given rules. */
export function isRuleDeselected(
  file: DiscoveredFile,
  patterns: readonly string[],
): boolean {
  return patterns.some((p) => fileMatchesRule(file, p));
}

/**
 * Test whether a file is re-selected by an INCLUDE rule.
 *
 * Include rules are the positive counterpart to exclusion rules: they
 * rescue files that an exclusion rule would remove (e.g. exclude `docs/**`
 * but include `docs/README.md`). Manual checkbox exclusion still wins.
 */
export function isRuleSelected(
  file: DiscoveredFile,
  patterns: readonly string[],
): boolean {
  return patterns.some((p) => fileMatchesRule(file, p));
}

/**
 * Count how many NON-EXCLUDED files each pattern would deselect.
 * Returns one entry per input pattern (in order) so the UI can render
 * a live match count next to each chip.
 */
export function countRuleMatches(
  files: readonly DiscoveredFile[],
  patterns: readonly string[],
): number[] {
  const counts = patterns.map(() => 0);
  for (const file of files) {
    if (file.excluded) continue;
    for (let i = 0; i < patterns.length; i++) {
      if (fileMatchesRule(file, patterns[i])) counts[i] += 1;
    }
  }
  return counts;
}

/** Total number of selectable files deselected by the given rule set. */
export function countRuleDeselected(
  files: readonly DiscoveredFile[],
  patterns: readonly string[],
): number {
  if (patterns.length === 0) return 0;
  let n = 0;
  for (const file of files) {
    if (file.excluded) continue;
    if (isRuleDeselected(file, patterns)) n += 1;
  }
  return n;
}

/** Total number of selectable files matched by the include rule set. */
export function countRuleSelectedTotal(
  files: readonly DiscoveredFile[],
  patterns: readonly string[],
): number {
  if (patterns.length === 0) return 0;
  let n = 0;
  for (const file of files) {
    if (file.excluded) continue;
    if (isRuleSelected(file, patterns)) n += 1;
  }
  return n;
}

/**
 * Files that an exclusion rule would remove but an include rule rescues —
 * the live "+N" stat shown next to the include chips.
 */
export function countRescuedByIncludes(
  files: readonly DiscoveredFile[],
  excludePatterns: readonly string[],
  includePatterns: readonly string[],
): number {
  if (excludePatterns.length === 0 || includePatterns.length === 0) return 0;
  let n = 0;
  for (const file of files) {
    if (file.excluded) continue;
    if (isRuleDeselected(file, excludePatterns) && isRuleSelected(file, includePatterns)) {
      n += 1;
    }
  }
  return n;
}

/** Parse a raw user input string into distinct, non-empty rule patterns. */
export function parseRuleInput(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Example patterns offered as suggestions in the rules editor. */
export const RULE_SUGGESTIONS: readonly string[] = [
  '*.test.js',
  '*.spec.ts',
  '**/__tests__/**',
  '**/*.d.ts',
  'docs/**',
];

/** Example patterns for the include (positive) rules editor. */
export const INCLUDE_RULE_SUGGESTIONS: readonly string[] = [
  'src/**',
  '**/*.java',
  'docs/README.md',
  'lib/**',
  '*.md',
];
