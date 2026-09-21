/**
 * Per-group export filename resolution (R12).
 *
 * Each export group may carry an optional filename override. The pattern
 * supports three tokens:
 *   {title} — the global export filename (the rail's FILENAME field)
 *   {group} — the group's name
 *   {date}  — today as YYYY-MM-DD
 *
 * The result is sanitized for filesystem safety with the SAME rules the
 * export rail uses (runs of unsafe characters collapse to '_', leading /
 * trailing punctuation trimmed, 100-char cap) and never collapses to an
 * empty string. Without an override the default is `{title}_{group}` —
 * the pre-R12 behavior, unchanged.
 */

/** Same sanitization as the export rail's filename field. */
export function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/^[._-]+/, '')
      .replace(/[._-]+$/, '')
      .slice(0, 100) || 'output'
  );
}

/** Today as YYYY-MM-DD (local time, matching user expectation). */
export function filenameDateToken(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface GroupFilenameInput {
  /** The group's own optional override pattern. */
  filename?: string | null;
  /** The group's name (used by the default and the {group} token). */
  name: string;
}

/**
 * Resolve ONE group's export filename. Pure aside from the optional
 * `now` clock injection — deterministic for tests.
 */
export function groupExportFilename(
  group: GroupFilenameInput,
  globalBase: string,
  now: Date = new Date(),
): string {
  const base = globalBase.trim() || 'Codice_Output';
  const pattern = group.filename?.trim();
  if (!pattern) {
    return sanitizeFilename(`${base}_${group.name}`);
  }
  const expanded = pattern
    .replace(/\{title\}/g, base)
    .replace(/\{group\}/g, group.name)
    .replace(/\{date\}/g, filenameDateToken(now));
  return sanitizeFilename(expanded);
}
