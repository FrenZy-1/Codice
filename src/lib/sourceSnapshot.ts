/**
 * Source snapshot — packages the currently selected files into a ZIP archive.
 *
 * Useful for sharing exactly the source set that produced a document:
 * the ZIP mirrors the document's contents (same files, same relative
 * paths), so reviewers can cross-check the code with the PDF/DOCX.
 */

import JSZip from 'jszip';
import type { FileHandle, ProjectEntry } from '@/types';

export interface SnapshotEntry {
  /** Path of the file inside the generated ZIP. */
  zipPath: string;
  /** Original relative path (within its project). */
  relativePath: string;
  handle: FileHandle;
  size: number;
}

export interface SnapshotPlan {
  entries: SnapshotEntry[];
  /** Files skipped because their text could not be read. */
  unreadable: number;
  /** Duplicates that were namespaced under their project label. */
  namespaced: number;
}

export interface SnapshotResult {
  blob: Blob;
  filename: string;
  fileCount: number;
  elapsedMs: number;
}

/**
 * Plan the snapshot: resolve which files go into the archive and under
 * which paths. When several projects contribute files, every path is
 * namespaced under its project label so identical relative paths from
 * different projects cannot collide.
 */
export function planSnapshot(
  projects: ProjectEntry[],
  getSelectedIds: (projectId: string) => Set<string>,
): SnapshotPlan {
  const entries: SnapshotEntry[] = [];
  const active = projects.filter((p) => getSelectedIds(p.id).size > 0);
  const namespace = active.length > 1;

  for (const project of active) {
    const ids = getSelectedIds(project.id);
    for (const file of project.files) {
      if (!ids.has(file.id) || file.excluded) continue;
      if (!file.fileHandle) continue;
      entries.push({
        zipPath: namespace
          ? `${project.label}/${file.relativePath}`
          : file.relativePath,
        relativePath: file.relativePath,
        handle: file.fileHandle,
        size: file.size,
      });
    }
  }

  return { entries, unreadable: 0, namespaced: namespace ? 1 : 0 };
}

/** Slug used in the default archive name. */
function sanitizeSegment(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/^[._-]+/, '')
      .replace(/[._-]+$/, '')
      .slice(0, 100) || 'Codice_Source'
  );
}

/**
 * Build the ZIP archive for a plan. Text is read lazily per file so huge
 * projects do not all sit in memory at once (JSZip holds the compressed
 * form). Returns null when the plan has no entries.
 */
export async function buildSnapshotZip(
  plan: SnapshotPlan,
  filenameBase: string,
  onProgress?: (done: number, total: number, currentPath?: string) => void,
): Promise<SnapshotResult | null> {
  if (plan.entries.length === 0) return null;
  const started = performance.now();
  const zip = new JSZip();
  let done = 0;
  for (const entry of plan.entries) {
    onProgress?.(done, plan.entries.length, entry.zipPath);
    try {
      const text = await entry.handle.getText();
      zip.file(entry.zipPath, text);
    } catch {
      // Unreadable files are skipped; the archive still mirrors the rest.
    }
    done++;
    onProgress?.(done, plan.entries.length, entry.zipPath);
  }
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/zip',
  });
  const base = sanitizeSegment(filenameBase) || 'Codice_Source';
  return {
    blob,
    filename: `${base}.zip`,
    fileCount: plan.entries.length,
    elapsedMs: performance.now() - started,
  };
}
