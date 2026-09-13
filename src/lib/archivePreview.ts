/**
 * Archive preview — pure helpers that describe what a generated ZIP will
 * contain BEFORE it is built.
 *
 * Two consumers:
 *   - the Source ZIP snapshot (file paths + sizes are known upfront)
 *   - the separate-mode export (one document per project; names follow the
 *     same sanitize + collision-suffix rules the exporter applies)
 *
 * The tree model and the Unicode renderer live here so jsdom tests and the
 * browser share one implementation. Tree rendering uses the same box-drawing
 * glyphs (├ └ │ ─) as the document's project-structure section.
 */

export interface ArchivePreviewEntry {
  /** Path of the entry inside the archive ("src/lib/db.ts"). */
  path: string;
  /** Size in bytes, when known upfront (document exports omit it). */
  size?: number;
  /** Short right-aligned hint shown instead of the size (e.g. "12 files"). */
  badge?: string;
}

export interface ArchiveNode {
  /** Segment name ("src", "db.ts", "project.docx"). */
  name: string;
  /** Insertion-ordered children (directories first is NOT forced — the
   * renderer keeps the archive's natural path order). */
  children: ArchiveNode[];
  isFile: boolean;
  /** Aggregated subtree size (bytes) — 0 when unknown. */
  size: number;
  /** True when any descendant (or the node itself) has an unknown size. */
  partial: boolean;
  /** Short hint attached to file nodes (document exports). */
  badge?: string;
}

export interface ArchiveTreeStats {
  files: number;
  dirs: number;
  totalBytes: number;
  /** True when at least one file's size is unknown. */
  partial: boolean;
}

/** Build the archive tree from flat archive paths. */
export function buildArchiveTree(entries: ArchivePreviewEntry[]): ArchiveNode {
  const root: ArchiveNode = {
    name: '',
    children: [],
    isFile: false,
    size: 0,
    partial: false,
  };

  for (const entry of entries) {
    const segments = entry.path
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) continue;
    let node = root;
    for (let i = 0; i < segments.length; i++) {
      const name = segments[i];
      const isLast = i === segments.length - 1;
      let child = node.children.find((c) => c.name === name && c.isFile === isLast);
      if (!child) {
        child = {
          name,
          children: [],
          isFile: isLast,
          size: 0,
          partial: false,
        };
        node.children.push(child);
      }
      node = child;
    }
    // Leaf carries the entry metadata.
    node.isFile = true;
    node.size = entry.size ?? 0;
    node.partial = entry.size === undefined;
    node.badge = entry.badge;
  }

  return root;
}

/** Aggregate subtree statistics (files, directories, total bytes). */
export function archiveTreeStats(root: ArchiveNode): ArchiveTreeStats {
  let files = 0;
  let dirs = 0;
  let totalBytes = 0;
  let partial = false;

  const walk = (node: ArchiveNode) => {
    if (node.isFile) {
      files += 1;
      totalBytes += node.size;
      if (node.partial) partial = true;
      return;
    }
    if (node !== root) dirs += 1;
    for (const child of node.children) walk(child);
  };
  walk(root);

  return { files, dirs, totalBytes, partial };
}

/**
 * Render the archive tree as an indented Unicode text tree.
 *
 * Directories are grouped before files within each level (stable within
 * their group). The root itself is not rendered; only its children.
 *
 * With `{ meta: true }` each file line gains a right-hand hint — its badge
 * (e.g. "15 files") or, when the size is known, the formatted size.
 */
export function formatArchiveTree(
  root: ArchiveNode,
  opts: { meta?: boolean } = {},
): string {
  const lines: string[] = [];

  const render = (node: ArchiveNode, prefix: string) => {
    const dirs = node.children.filter((c) => !c.isFile);
    const files = node.children.filter((c) => c.isFile);
    const ordered = [...dirs, ...files];

    ordered.forEach((child, i) => {
      const last = i === ordered.length - 1;
      const connector = last ? '└── ' : '├── ';
      const suffix = child.isFile ? '' : '/';
      let meta = '';
      if (opts.meta && child.isFile) {
        if (child.badge) meta = `  —  ${child.badge}`;
        else if (!child.partial) meta = `  —  ${formatArchiveSize(child.size)}`;
      }
      lines.push(`${prefix}${connector}${child.name}${suffix}${meta}`);
      if (!child.isFile) {
        render(child, `${prefix}${last ? '    ' : '│   '}`);
      }
    });
  };

  render(root, '');
  return lines.join('\n');
}

/** Format a byte count compactly for the dialog's size column. */
export function formatArchiveSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Sanitize a project label into a document filename segment. */
function sanitizeSegment(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/^[._-]+/, '')
      .replace(/[._-]+$/, '')
      .slice(0, 100) || 'output'
  );
}

/**
 * Assign one document filename per project label, mirroring the exporter's
 * collision handling: first label keeps the plain name, later duplicates
 * get `_2`, `_3`, … before the extension. Pure and deterministic.
 */
export function assignDocumentNames(
  labels: string[],
  extension: string,
): string[] {
  const used = new Set<string>();
  const names: string[] = [];
  for (const label of labels) {
    const base = sanitizeSegment(label);
    let name = `${base}.${extension}`;
    let i = 2;
    while (used.has(name)) {
      name = `${base}_${i}.${extension}`;
      i += 1;
    }
    used.add(name);
    names.push(name);
  }
  return names;
}
