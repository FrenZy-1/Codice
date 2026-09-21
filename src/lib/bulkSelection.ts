/**
 * Bulk selection — pure helpers for the file-tree bulk actions.
 *
 * The sidebar exposes "All / None / Invert" buttons that operate on the
 * CURRENTLY VISIBLE (filtered) set of files so bulk actions respect the
 * active search query and extension filter.
 */

import type { DiscoveredFile } from '@/types';

/** Options shared by the sidebar's visibility filter and the FileTree. */
export interface VisibleFilterOptions {
  showExcluded: boolean;
  /** Legacy extension filter ("" = all). Kept for API compatibility. */
  extensionFilter?: string;
  /** §44 — language id filter derived from the central language mapping. */
  languageFilter?: string;
  searchQuery: string;
  /** Per-project explicitly-included file ids (override defaults). */
  inclusions?: Record<string, Set<string>>;
  projectId: string;
}

/**
 * The canonical visibility filter — shared by the FileTree renderer and the
 * bulk-selection toolbar so "select all" always matches what is on screen.
 */
export function filterVisibleFiles(
  files: DiscoveredFile[],
  opts: VisibleFilterOptions,
): DiscoveredFile[] {
  let result = files;
  if (!opts.showExcluded) {
    const included = opts.inclusions?.[opts.projectId];
    result = result.filter(
      (f) => !f.excluded || (included ? included.has(f.id) : false),
    );
  }
  if (opts.extensionFilter) {
    const ext = opts.extensionFilter.toLowerCase();
    result = result.filter((f) => {
      const dot = f.name.lastIndexOf('.');
      const fext = dot >= 0 ? f.name.slice(dot).toLowerCase() : '';
      return fext === ext;
    });
  }
  if (opts.languageFilter) {
    result = result.filter((f) => f.language === opts.languageFilter);
  }
  if (opts.searchQuery) {
    const q = opts.searchQuery.toLowerCase();
    result = result.filter((f) => f.relativePath.toLowerCase().includes(q));
  }
  return result;
}

/** The visible ids in a stable order — input for computeBulkSelection. */
export function visibleIdsFor(files: DiscoveredFile[]): string[] {
  return files.map((f) => f.id);
}

/**
 * Compute the per-file selection changes for a bulk action.
 *
 * @param mode      'all' selects every visible id, 'none' deselects every
 *                  visible id, 'invert' flips each visible id.
 * @param visibleIds  ids of files currently matching search/filter.
 * @param isSelected  predicate telling whether a file id is selected now.
 * @returns ids to select and ids to deselect (disjoint).
 */
export function computeBulkSelection(
  mode: 'all' | 'none' | 'invert',
  visibleIds: string[],
  isSelected: (id: string) => boolean,
): { selectIds: string[]; deselectIds: string[] } {
  const selectIds: string[] = [];
  const deselectIds: string[] = [];
  for (const id of visibleIds) {
    const selected = isSelected(id);
    if (mode === 'all') {
      if (!selected) selectIds.push(id);
    } else if (mode === 'none') {
      if (selected) deselectIds.push(id);
    } else {
      if (selected) deselectIds.push(id);
      else selectIds.push(id);
    }
  }
  return { selectIds, deselectIds };
}

/** Sum of sizes for a set of ids (used by the selection progress bar). */
export function totalSizeForIds(
  files: Array<{ id: string; size: number }>,
  ids: Set<string>,
): number {
  let total = 0;
  for (const file of files) {
    if (ids.has(file.id)) total += file.size;
  }
  return total;
}
