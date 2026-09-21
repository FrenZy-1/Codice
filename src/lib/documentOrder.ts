/**
 * Document file ordering (spec §13-§15/§36).
 *
 * The canonical document order of files WITHIN each project is stored as a
 * per-project array of file ids (`Record<projectId, string[]>`). Both the
 * sidebar and the Outline edit this ONE state — neither keeps its own copy.
 *
 * Ordering is presentation-only: the underlying project directory (the
 * DiscoveredFile list) is never mutated. Files not mentioned in the order
 * array keep their default (path-sorted) position after the ordered ones,
 * so uploads/reselection behave predictably.
 *
 * Reordering never moves a file across a project boundary (§15).
 */

import type { DiscoveredFile } from '@/types';

/** Default order = the natural discovery order (already path-sorted). */
export function defaultFileOrder(files: DiscoveredFile[]): string[] {
  return files.map((f) => f.id);
}

/**
 * Effective document order: the stored arrangement first (only ids that
 * still exist), then any never-ordered files in their default position.
 */
export function effectiveFileOrder(
  files: DiscoveredFile[],
  order: string[] | undefined,
): DiscoveredFile[] {
  if (!order || order.length === 0) return files;
  const byId = new Map(files.map((f) => [f.id, f]));
  const result: DiscoveredFile[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    const f = byId.get(id);
    if (f) {
      result.push(f);
      seen.add(id);
    }
  }
  for (const f of files) {
    if (!seen.has(f.id)) result.push(f);
  }
  return result;
}

/** Move one file within a project's order by a relative offset. */
export function moveFileInOrder(
  order: string[] | undefined,
  files: DiscoveredFile[],
  fileId: string,
  delta: number,
): string[] {
  const current = effectiveFileOrder(files, order).map((f) => f.id);
  const from = current.indexOf(fileId);
  if (from < 0) return current;
  const to = Math.min(current.length - 1, Math.max(0, from + delta));
  if (to === from) return current;
  const next = [...current];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Move one file to an absolute position (drag-and-drop). */
export function reorderFileTo(
  order: string[] | undefined,
  files: DiscoveredFile[],
  fileId: string,
  toIndex: number,
): string[] {
  const current = effectiveFileOrder(files, order).map((f) => f.id);
  const from = current.indexOf(fileId);
  if (from < 0) return current;
  const clamped = Math.min(current.length - 1, Math.max(0, toIndex));
  if (clamped === from) return current;
  const next = [...current];
  const [moved] = next.splice(from, 1);
  next.splice(clamped, 0, moved);
  return next;
}

/** Reset a project's order back to the default discovery order. */
export function resetFileOrder(files: DiscoveredFile[]): string[] {
  return defaultFileOrder(files);
}
