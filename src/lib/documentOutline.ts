/**
 * Document outline model — the table of contents of the PREVIEW.
 *
 * Builds the flat, ordered list of sections shown in the outline panel:
 * title page → table of contents → per-project sections → per-project
 * subsections (project structure tree / source files) → per-file blocks.
 * The main preview tags each section with `data-outline-id` and the panel
 * uses the same ids for scroll-to navigation and scroll-spy highlighting.
 */

/**
 * Outline-worthy kinds — the consistent rule (§39): every RESOLVED element
 * that is a navigable document landmark gets an entry:
 *   title / toc / project / structure / files / file / heading / panel /
 *   columns (as a panel-family landmark) / image / divider.
 * Pure spacing elements (spacer, pageBreak) are NOT navigable landmarks —
 * they are excluded by rule, not by omission.
 */
export type OutlineKind =
  | 'title'
  | 'toc'
  | 'project'
  | 'structure'
  | 'files'
  | 'file'
  | 'heading'
  | 'panel'
  | 'image'
  | 'divider';

export interface OutlineEntry {
  /** Stable anchor id, also used as `data-outline-id` in the preview. */
  id: string;
  kind: OutlineKind;
  /** Primary label (project label / file path). */
  label: string;
  /** Secondary info (language · size). */
  detail?: string;
  /** Indentation depth: 0 = top-level section, 1 = subsection within a project. */
  depth: 0 | 1;
  /** File rows: owning project id — reorder operations stay within it (§15). */
  projectId?: string;
  /** File rows: the file id — reorder target (§14). */
  fileId?: string;
  /** §16 — full hover text (the path behind a filename-only label). */
  tooltip?: string;
}

/**
 * §16 — Output pill labels show the FILENAME only; the full path lives in
 * the row tooltip. When two or more files share the same filename the path
 * is shown inline to disambiguate them. Pure — shared by the standard and
 * the custom-layout outline builders.
 */
export function outlineFileLabel(
  relativePath: string,
  duplicateNames: Set<string>,
): { label: string; showPath: boolean } {
  const name = relativePath.split('/').pop() ?? relativePath;
  return { label: name, showPath: duplicateNames.has(name) };
}

/** Filenames that occur more than once across the given files. */
export function duplicateFilenames(paths: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const p of paths) {
    const name = p.split('/').pop() ?? p;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const dup = new Set<string>();
  for (const [name, count] of counts) if (count > 1) dup.add(name);
  return dup;
}

/** Anchor id for the preview DOM. */
export function outlineAnchorId(entry: OutlineEntry): string {
  return entry.id;
}

export interface OutlineProjectInput {
  id: string;
  label: string;
  files: Array<{
    fileId: string;
    relativePath: string;
    language: string | null;
    sizeBytes: number;
  }>;
}

export interface BuildOutlineInput {
  projects: OutlineProjectInput[];
  includeTitlePage: boolean;
  hasTitle: boolean;
  includeToc: boolean;
  /** Whether the preview renders the "Project Structure" tree section. */
  includeStructure: boolean;
}

/** Pure outline builder — mirrors the preview's section order. */
export function buildDocumentOutline(input: BuildOutlineInput): OutlineEntry[] {
  const entries: OutlineEntry[] = [];

  if (input.includeTitlePage && input.hasTitle) {
    entries.push({
      id: 'outline-title',
      kind: 'title',
      label: 'Title page',
      depth: 0,
    });
  }

  if (input.includeToc) {
    entries.push({
      id: 'outline-toc',
      kind: 'toc',
      label: 'Table of Contents',
      depth: 0,
    });
  }

  const dupNames = duplicateFilenames(
    input.projects.flatMap((p) => p.files.map((f) => f.relativePath)),
  );

  input.projects.forEach((project) => {
    entries.push({
      id: `outline-project-${project.id}`,
      kind: 'project',
      label: project.label,
      detail:
        project.files.length === 1
          ? '1 file'
          : `${project.files.length} files`,
      depth: 0,
    });
    // Subsections mirror the preview body order: the structure tree comes
    // before the "Source Files" heading, and both precede the file blocks.
    if (input.includeStructure) {
      entries.push({
        id: `outline-structure-${project.id}`,
        kind: 'structure',
        label: 'Project Structure',
        depth: 1,
      });
    }
    entries.push({
      id: `outline-files-${project.id}`,
      kind: 'files',
      label: 'Source Files',
      detail:
        project.files.length === 1
          ? '1 file'
          : `${project.files.length} files`,
      depth: 1,
    });
    for (const file of project.files) {
      const { label, showPath } = outlineFileLabel(file.relativePath, dupNames);
      entries.push({
        id: `outline-file-${file.fileId}`,
        kind: 'file',
        label: showPath ? file.relativePath : label,
        detail: file.language ?? undefined,
        depth: 1,
        projectId: project.id,
        fileId: file.fileId,
        tooltip: `${project.label}/${file.relativePath}`,
      });
    }
  });

  return entries;
}

/** Pick a small glyph for each outline kind (kept textual for a11y). */
export function outlineGlyph(kind: OutlineKind): string {
  switch (kind) {
    case 'title':
      return '❖';
    case 'toc':
      return '☰';
    case 'project':
      return '▣';
    case 'structure':
      return '⌗';
    case 'files':
      return '⋮';
    case 'file':
      return '·';
    case 'heading':
      return '§';
    case 'panel':
      return '▭';
    case 'image':
      return '⊡';
    case 'divider':
      return '—';
  }
}

/** Semantic hue family used by the outline panel to tint glyphs per kind. */
export function outlineKindTone(
  kind: OutlineKind,
): 'accent' | 'warning' | 'success' | 'muted' {
  switch (kind) {
    case 'title':
      return 'accent';
    case 'toc':
      return 'warning';
    case 'project':
      return 'success';
    case 'panel':
      return 'accent';
    case 'structure':
    case 'files':
    case 'file':
    case 'heading':
    case 'image':
    case 'divider':
      return 'muted';
  }
}

/**
 * Render the outline as plain text — one indented line per section.
 *
 * Used by the outline panel's copy action so the document structure can be
 * pasted into notes, PR descriptions or commit messages.
 */
export function formatOutlineText(entries: OutlineEntry[]): string {
  if (entries.length === 0) return '';
  return entries
    .map((entry) => {
      const indent = '  '.repeat(entry.depth);
      const suffix = entry.detail ? `  (${entry.detail})` : '';
      return `${indent}${outlineGlyph(entry.kind)} ${entry.label}${suffix}`;
    })
    .join('\n');
}
