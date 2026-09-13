/**
 * Export history — keeps the last N generated documents around so the user
 * can re-download them without re-running the export pipeline.
 *
 * Blobs live in module memory (they die with the page — nothing is persisted
 * to disk or localStorage). The pure helpers below are unit-tested; the React
 * wiring lives in ExportPanel.
 */

export interface ExportHistoryEntry {
  id: string;
  filename: string;
  format: 'docx' | 'pdf' | 'odt' | 'zip';
  /** Blob size in bytes. */
  sizeBytes: number;
  /** Wall-clock duration of the export in milliseconds. */
  elapsedMs: number;
  /** Downloadable object URL (kept alive while the entry is retained). */
  url: string;
  /** Epoch millis when the export finished. */
  at: number;
  /** How the document was packaged (single file / ZIP of N). */
  detail?: string;
}

/** Maximum number of retained exports. */
export const EXPORT_HISTORY_CAP = 5;

let counter = 0;

/** Create a history entry from an export result (assigns a fresh object URL). */
export function createHistoryEntry(input: {
  blob: Blob;
  filename: string;
  format: ExportHistoryEntry['format'];
  elapsedMs: number;
  detail?: string;
  now?: number;
}): ExportHistoryEntry {
  counter += 1;
  return {
    id: `exh-${Date.now().toString(36)}-${counter}`,
    filename: input.filename,
    format: input.format,
    sizeBytes: input.blob.size,
    elapsedMs: input.elapsedMs,
    url: URL.createObjectURL(input.blob),
    at: input.now ?? Date.now(),
    detail: input.detail,
  };
}

/** Prepend an entry, cap the list length, and revoke dropped URLs. */
export function pushHistory(
  list: ExportHistoryEntry[],
  entry: ExportHistoryEntry,
  cap = EXPORT_HISTORY_CAP,
): ExportHistoryEntry[] {
  const next = [entry, ...list];
  while (next.length > cap) {
    const dropped = next.pop();
    if (dropped) URL.revokeObjectURL(dropped.url);
  }
  return next;
}

/** Revoke every URL in the list (used by "clear history" and unmount). */
export function clearHistory(list: ExportHistoryEntry[]): [] {
  for (const entry of list) URL.revokeObjectURL(entry.url);
  return [];
}

/** Human-readable relative timestamp: "just now", "2m ago", "1h ago"… */
export function formatRelativeTime(at: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - at);
  const seconds = Math.floor(delta / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Human-readable size label (mirrors fileDiscovery.formatBytes but local). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Trigger a browser download for an existing history entry URL. */
export function downloadHistoryEntry(entry: ExportHistoryEntry): void {
  const a = document.createElement('a');
  a.href = entry.url;
  a.download = entry.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
