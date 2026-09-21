/**
 * Duplicate filename detection for the project sidebar.
 *
 * Files that share the same filename but live in different directories are
 * ambiguous when the tree shows only the name. This module computes the set
 * of ambiguous names so the UI can attach just enough path context to
 * distinguish them — unique filenames stay clean.
 */

import type { DiscoveredFile } from '@/types';

/**
 * Return the set of filenames that occur more than once among the given
 * files (name comparison is case-sensitive, matching filesystem behavior).
 */
export function findDuplicateFileNames(files: DiscoveredFile[]): Set<string> {
  const counts = new Map<string, number>();
  for (const file of files) {
    counts.set(file.name, (counts.get(file.name) ?? 0) + 1);
  }
  const duplicates = new Set<string>();
  for (const [name, count] of counts) {
    if (count > 1) duplicates.add(name);
  }
  return duplicates;
}

/**
 * Compact disambiguation context for a duplicated filename.
 *
 * For `src/main/java/com/example/Main.java` the context is
 * `src/main/java/com/example/` — the directory portion only, since the
 * filename itself is already displayed.
 */
export function duplicateContext(file: DiscoveredFile): string {
  return file.directory ? `${file.directory}/` : '';
}

/**
 * Selection identity helper — the unique file id. Never use the bare
 * filename as a selection key: duplicated names must stay independently
 * selectable.
 */
export function fileSelectionKey(file: DiscoveredFile): string {
  return file.id;
}
