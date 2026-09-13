/**
 * Canonical header/footer token engine.
 *
 * A single `expandTokens` implementation shared by the live preview, the
 * template editor preview, and ALL THREE exporters (DOCX / PDF / ODT) so a
 * token renders the same resolved value everywhere.
 *
 * Supported tokens (see TOKEN_CATALOG):
 *   {page} {pages} {lines} {fileName} {projectName} {project}
 *   {title} {author} {date} {time} {files}
 *
 * Unknown `{whatever}` tokens are left untouched so typos are visible
 * instead of silently disappearing.
 */

import type { DocumentMetadata } from '@/types';

/** Dynamic values available while expanding a template. */
export interface TokenContext {
  /** Current 1-based page number (1 in static contexts like DOCX headers → becomes a live field). */
  page?: string | number;
  /** Total page count. */
  pages?: string | number;
  /** Lines rendered on the current page. */
  lines?: string | number;
  /** File name (basename) associated with the current page. */
  fileName?: string;
  /** Project label associated with the current page. `project` is an alias. */
  projectName?: string;
  /** Document title from metadata. */
  title?: string;
  /** Author from metadata. */
  author?: string;
  /** Locale date string. */
  date?: string;
  /** Locale time string. */
  time?: string;
  /** Number of files included in the document. */
  files?: string | number;
  /** Raw generation date — used by `{date:format}` / `{time:format}` suffixes. */
  now?: Date;
}

/** One entry of the user-facing token catalog. */
export interface TokenInfo {
  /** Token as typed by the user, e.g. `{page}`. */
  token: string;
  /** Short label shown on the chip. */
  label: string;
  /** What the token resolves to. */
  description: string;
  /** Example resolved value. */
  example: string;
}

/**
 * Ordered catalog — also drives the token chips in the Template Customizer.
 * Page-dependent tokens are flagged so static contexts can disable them.
 */
export const TOKEN_CATALOG: TokenInfo[] = [
  { token: '{page}', label: 'Page', description: 'Current page number', example: '3' },
  { token: '{pages}', label: 'Pages', description: 'Total page count', example: '12' },
  { token: '{title}', label: 'Title', description: 'Document title (from Document info)', example: 'Project Report' },
  { token: '{author}', label: 'Author', description: 'Author (from Document info)', example: 'Ada Lovelace' },
  { token: '{date}', label: 'Date', description: 'Generation date — supports a format: {date:yyyy-MM-dd}', example: '2/14/2026' },
  { token: '{time}', label: 'Time', description: 'Generation time — supports a format: {time:HH:mm}', example: '10:15 AM' },
  { token: '{files}', label: 'Files', description: 'Number of files in the document', example: '10' },
  { token: '{projectName}', label: 'Project', description: 'Project name (first project for page-level contexts)', example: 'my-app' },
  { token: '{fileName}', label: 'File', description: 'File name of the page content', example: 'App.java' },
  { token: '{lines}', label: 'Lines', description: 'Code lines on the current page', example: '42' },
];

/** Tokens that depend on the page being rendered. */
export const PAGE_DEPENDENT_TOKENS = new Set(['page', 'pages', 'lines', 'fileName']);

/** All token strings in catalog order (for quick membership checks). */
export const KNOWN_TOKENS = new Set(TOKEN_CATALOG.map((t) => t.token));

/** Replace `{token}` occurrences with context values; unknown tokens pass through. */
export function expandTokens(template: string, ctx: TokenContext): string {
  return template.replace(/\{(\w+)(?::([^}]+))?\}/g, (match, keyRaw: string, fmt?: string) => {
    let key: string = keyRaw;
    if (key === 'project') key = 'projectName';
    // Formatted date/time resolve from `now` (or the display string) even
    // when the other key is absent from the context.
    if (fmt && (key === 'date' || key === 'time')) {
      const raw = ctx.now ?? (key === 'date' ? ctx.date : ctx.time);
      if (raw !== undefined) return formatDateTimeValue(raw as Date | string, fmt, match);
      return match;
    }
    // Unformatted {date} / {time} also fall back to `now` so every context
    // that carries a generation timestamp resolves them consistently (spec
    // §7) — a missing display string no longer leaks the literal token.
    if ((key === 'date' || key === 'time') && !(key in ctx) && ctx.now) {
      const d = ctx.now instanceof Date ? ctx.now : new Date(ctx.now);
      if (!Number.isNaN(d.getTime())) {
        return key === 'date'
          ? d.toLocaleDateString()
          : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      }
    }
    const value = key in ctx ? ctx[key as keyof TokenContext] : undefined;
    if (value === undefined) return match;
    return String(value);
  });
}

/**
 * Format a date/time value with a mini pattern:
 *   yyyy → 2026 · yy → 26 · MM → 09 · dd → 07
 *   HH → 14 · mm → 05 · ss → 09
 * Anything else in the pattern passes through (so `yyyy-MM-dd` → `2026-09-07`).
 * If the value cannot be parsed as a date the original token is returned.
 */
export function formatDateTimeValue(
  value: Date | string,
  fmt: string,
  fallback: string,
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return fmt
    .replace(/yyyy/g, String(d.getFullYear()))
    .replace(/yy/g, String(d.getFullYear() % 100).padStart(2, '0'))
    .replace(/MM/g, pad(d.getMonth() + 1))
    .replace(/dd/g, pad(d.getDate()))
    .replace(/HH/g, pad(d.getHours()))
    .replace(/mm/g, pad(d.getMinutes()))
    .replace(/ss/g, pad(d.getSeconds()));
}

/** Split a template into literal parts and token parts (`{page}` / `{date:…}`). */
export function tokenizeTemplate(
  template: string,
): Array<{ kind: 'text' | 'token'; value: string }> {
  const parts: Array<{ kind: 'text' | 'token'; value: string }> = [];
  const re = /\{(\w+)(?::[^}]+)?\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) parts.push({ kind: 'text', value: template.slice(last, m.index) });
    parts.push({ kind: 'token', value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < template.length) parts.push({ kind: 'text', value: template.slice(last) });
  return parts;
}

export interface StaticTokenContextInput {
  metadata: DocumentMetadata;
  /** First project label (used for {projectName} in document-level contexts). */
  firstProjectLabel?: string | null;
  /** Number of files included in the document. */
  fileCount: number;
  /** Generation timestamp (defaults to now). */
  now?: Date;
}

/** Build the page-independent part of a token context from the document model. */
export function buildStaticTokenContext(input: StaticTokenContextInput): TokenContext {
  const now = input.now ?? new Date();
  return {
    title: input.metadata.title ?? '',
    author: input.metadata.author ?? '',
    date: input.metadata.date || now.toLocaleDateString(),
    time: now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    files: input.fileCount,
    projectName: input.firstProjectLabel ?? '',
    fileName: '',
    page: '',
    pages: '',
    lines: '',
    now,
  };
}
