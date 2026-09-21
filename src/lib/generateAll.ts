/**
 * Generate-all planner (R14) — the pure selection logic behind the
 * "Generate all" button in Export groups mode.
 *
 * A group is EXPORTABLE when at least one of its referenced projects is
 * still live AND has selected files (mirrors handleExportGroup's own
 * guard). Groups referencing no live project (a persisted scaffold after
 * a reload) are skipped — the user is told how many were skipped instead
 * of being spammed with one "Empty group" warning per group.
 */

import type { ExportGroup, ProjectEntry } from '@/types';

export interface GenerateAllPlan {
  /** Group ids to generate, in scaffold order. */
  ids: string[];
  /** Groups skipped because they have no live project with files. */
  skipped: number;
}

export function planGenerateAll(
  groups: ExportGroup[],
  liveProjectIds: Set<string>,
): GenerateAllPlan {
  const ids: string[] = [];
  let skipped = 0;
  for (const group of groups) {
    if (group.projectIds.some((pid) => liveProjectIds.has(pid))) {
      ids.push(group.id);
    } else {
      skipped += 1;
    }
  }
  return { ids, skipped };
}

/* ------------------------------------------------------------------ */
/* R16 — per-group summary                                             */
/* ------------------------------------------------------------------ */

export interface GroupSummary {
  /** Live member projects that contribute selected files. */
  projects: number;
  /** Total selected files across those projects. */
  files: number;
  /** Total byte size of the selected files (what the export carries). */
  bytes: number;
}

/**
 * What a group's export would actually contain right now: only live
 * projects with at least one selected file count (mirrors planGenerateAll
 * / handleExportGroup's guard); dead ids from a persisted scaffold are
 * skipped silently; byte sizes come from the selected files themselves
 * (not the project's cached selectedSize, which may drift).
 */
export function summarizeGroup(
  projectIds: string[],
  projects: ProjectEntry[],
  getSelectedFiles: (projectId: string) => Set<string>,
): GroupSummary {
  let projectCount = 0;
  let fileCount = 0;
  let bytes = 0;
  for (const pid of projectIds) {
    const project = projects.find((p) => p.id === pid);
    if (!project) continue;
    const selected = getSelectedFiles(pid);
    if (selected.size === 0) continue;
    projectCount += 1;
    fileCount += selected.size;
    for (const file of project.files) {
      if (selected.has(file.id)) bytes += file.size;
    }
  }
  return { projects: projectCount, files: fileCount, bytes };
}
