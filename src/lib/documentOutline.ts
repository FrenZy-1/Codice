/**
 * Document outline model — the table of contents of the PREVIEW.
 *
 * Builds the flat, ordered list of sections shown in the outline panel:
 * title page → table of contents → per-project sections → per-project
 * subsections (project structure tree / source files) → per-file blocks.
 * The main preview tags each section with `data-outline-id` and the panel
 * uses the same ids for scroll-to navigation and scroll-spy highlighting.
 */

export type OutlineKind =
  | 'title'
  | 'toc'
  | 'project'
  | 'structure'
  | 'files'
  | 'file';

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
      entries.push({
        id: `outline-file-${file.fileId}`,
        kind: 'file',
        label: file.relativePath,
        detail: file.language ?? undefined,
        depth: 1,
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
    case 'structure':
    case 'files':
    case 'file':
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
