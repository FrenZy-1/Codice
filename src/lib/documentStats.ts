/**
 * Document statistics — pure computations over discovered files.
 *
 * Aggregates what the user has SELECTED across one or more projects so the
 * sidebar can show a live "document statistics" panel: file counts by kind,
 * total size, largest file and a per-language breakdown with percentages.
 *
 * Everything here is synchronous and derived exclusively from
 * `DiscoveredFile` metadata (no content reads) so it stays cheap enough to
 * recompute on every render.
 */

import type { DiscoveredFile, ProjectEntry } from '@/types';
import { languageLabel } from '@/lib/languageDetection';
import { formatBytes } from '@/lib/fileDiscovery';

export interface LanguageStat {
  /** Shiki language id (or 'plaintext' for unknown). */
  id: string;
  /** Human label, e.g. "TypeScript". */
  label: string;
  /** Number of selected files in this language. */
  files: number;
  /** Combined byte size of those files. */
  bytes: number;
  /** Share of total bytes, 0..100 rounded to one decimal. */
  pct: number;
}

export interface DocumentStats {
  /** Number of selected files. */
  selectedFiles: number;
  /** Selected non-config, non-binary source files. */
  sourceFiles: number;
  /** Selected config/project files (package.json, .gitignore…). */
  configFiles: number;
  /** Selected files that look binary (images, fonts…). */
  binaryFiles: number;
  /** Combined byte size of selected files. */
  totalBytes: number;
  /** Largest selected file, if any. */
  largest: { name: string; bytes: string } | null;
  /** Average selected file size in bytes (0 when empty). */
  averageBytes: number;
  /** Number of file NAMES that appear more than once among selections. */
  duplicateNames: number;
  /** Number of distinct languages among selections. */
  languageCount: number;
  /** Per-language breakdown, sorted by bytes descending. */
  languages: LanguageStat[];
}

function emptyStats(): DocumentStats {
  return {
    selectedFiles: 0,
    sourceFiles: 0,
    configFiles: 0,
    binaryFiles: 0,
    totalBytes: 0,
    largest: null,
    averageBytes: 0,
    duplicateNames: 0,
    languageCount: 0,
    languages: [],
  };
}

/** Deterministic hue-based color per language id (bars, dots, chips). */
export function languageHueColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 62% 55%)`;
}

/**
 * Render document statistics as a GitHub-flavored Markdown snippet.
 *
 * Pure and synchronous — used by the stats panel's "Copy as Markdown"
 * action so numbers can be pasted into PR descriptions, READMEs or reports.
 */
export function formatStatsMarkdown(stats: DocumentStats): string {
  if (stats.selectedFiles === 0) {
    return '## Document statistics\n\n_No files selected._\n';
  }

  const lines: string[] = [];
  lines.push('## Document statistics');
  lines.push('');
  lines.push(
    `- **Files:** ${stats.selectedFiles} (${stats.sourceFiles} source · ` +
      `${stats.configFiles} config · ${stats.binaryFiles} binary)`,
  );
  lines.push(`- **Total size:** ${formatBytes(stats.totalBytes)}`);
  lines.push(
    `- **Average file:** ${formatBytes(stats.averageBytes)}` +
      (stats.largest
        ? ` · largest: ${stats.largest.name} (${stats.largest.bytes})`
        : ''),
  );
  lines.push(`- **Languages:** ${stats.languageCount}`);
  if (stats.duplicateNames > 0) {
    lines.push(
      `- **Duplicate file names:** ${stats.duplicateNames} (disambiguated with path context)`,
    );
  }

  if (stats.languages.length > 0) {
    lines.push('');
    lines.push('| Language | Files | Size | Share |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const lang of stats.languages) {
      lines.push(
        `| ${lang.label} | ${lang.files} | ${formatBytes(lang.bytes)} | ${lang.pct}% |`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Dominant language of a project (by byte share among selected files).
 * Returns the Shiki language id, or null when nothing is selected.
 */
export function dominantLanguage(
  project: ProjectEntry,
  selectedIds: Set<string>,
): string | null {
  const bytes = new Map<string, number>();
  let total = 0;
  for (const file of project.files) {
    if (!selectedIds.has(file.id) || file.binary) continue;
    const id = file.language ?? 'plaintext';
    bytes.set(id, (bytes.get(id) ?? 0) + file.size);
    total += file.size;
  }
  if (total === 0) return null;
  let best: string | null = null;
  let bestBytes = -1;
  for (const [id, size] of bytes) {
    if (size > bestBytes) {
      best = id;
      bestBytes = size;
    }
  }
  return best;
}

/**
 * Compute statistics for the given projects, restricted to the selected file
 * ids of each project. `selections` maps project id → set of selected file
 * ids; projects with an empty/missing selection contribute nothing.
 */
export function computeDocumentStats(
  projects: ProjectEntry[],
  selections: Record<string, Set<string>> | Map<string, Set<string>>,
): DocumentStats {
  const selected: DiscoveredFile[] = [];

  const getSet = (projectId: string): Set<string> | undefined => {
    if (selections instanceof Map) return selections.get(projectId);
    return selections[projectId];
  };

  for (const project of projects) {
    const ids = getSet(project.id);
    if (!ids || ids.size === 0) continue;
    for (const file of project.files) {
      if (ids.has(file.id)) selected.push(file);
    }
  }

  if (selected.length === 0) return emptyStats();

  let sourceFiles = 0;
  let configFiles = 0;
  let binaryFiles = 0;
  let totalBytes = 0;
  let largest: DiscoveredFile | null = null;

  const byLanguage = new Map<string, { files: number; bytes: number }>();

  for (const file of selected) {
    totalBytes += file.size;
    if (file.binary) binaryFiles += 1;
    else if (file.isConfig) configFiles += 1;
    else sourceFiles += 1;

    if (!largest || file.size > largest.size) largest = file;

    const id = file.language ?? 'plaintext';
    const entry = byLanguage.get(id) ?? { files: 0, bytes: 0 };
    entry.files += 1;
    entry.bytes += file.size;
    byLanguage.set(id, entry);
  }

  // Count file NAMES shared by more than one selected file (spec §6 context).
  const nameCounts = new Map<string, number>();
  for (const file of selected) {
    nameCounts.set(file.name, (nameCounts.get(file.name) ?? 0) + 1);
  }
  let duplicateNames = 0;
  for (const count of nameCounts.values()) {
    if (count > 1) duplicateNames += 1;
  }

  const languages: LanguageStat[] = Array.from(byLanguage.entries())
    .map(([id, agg]) => ({
      id,
      label: languageLabel(id === 'plaintext' ? null : id),
      files: agg.files,
      bytes: agg.bytes,
      pct: totalBytes > 0 ? Math.round((agg.bytes / totalBytes) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes || b.files - a.files);

  return {
    selectedFiles: selected.length,
    sourceFiles,
    configFiles,
    binaryFiles,
    totalBytes,
    largest: largest
      ? { name: largest.name, bytes: formatBytes(largest.size) }
      : null,
    averageBytes: Math.round(totalBytes / selected.length),
    duplicateNames,
    languageCount: languages.length,
    languages,
  };
}
