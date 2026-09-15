/**
 * Custom layout resolver v2 (§3/§4/§17).
 *
 * Expands a v2 `CustomLayoutTemplate` into the flat `ResolvedLayoutBlock[]`
 * content stream consumed by the preview and all three exporters:
 *
 *   Template + Data → resolveCustomLayout() → ResolvedLayoutBlock[]
 *
 * Semantics:
 *   - Sections render once, in order (the File layout IS the document
 *     skeleton). `pageBreakBefore` starts a section on a fresh page.
 *   - Section children render in order: standalone nodes use the section's
 *     field values; block children expand ONCE PER ASSIGNED FILE (in the
 *     canonical document order, §10) — the non-negotiable one-file-one-
 *     section-one-instance rule (§3).
 *   - Block instances see their per-file field values merged OVER the
 *     owning section's field values.
 *   - Files that are assigned to NO block do not render in this layout
 *     (the File Layout editor surfaces them; export shows a warning).
 */

import type {
  DocumentFile,
  DocumentProject,
  FileDetails,
  ImageAsset,
  ResolvedCustomLayout,
} from '@/types';
import type {
  CustomLayoutTemplate,
  ResolutionContext,
  ResolvedLayoutBlock,
  TemplateNode,
  TemplateBlockType,
  TemplateFieldType,
  TemplateSection,
} from './model';
import { FILE_CONTEXT_NODES } from './model';
import { expandTokens } from '@/lib/tokens';

/** Data inputs for resolution — mirrors the relevant slice of app state. */
export interface ResolutionInputs {
  projects: DocumentProject[];
  /** Per-file user details (summary/description/note), keyed by fileId. */
  fileDetails: Record<string, FileDetails>;
  /** Per-file custom field values, keyed by fileId → fieldId → value. */
  fileFieldValues: Record<string, Record<string, string>>;
  /** Per-SECTION field values, keyed by sectionId → fieldId → value. */
  sectionFieldValues: Record<string, Record<string, string>>;
  /** Canonical presentation order of file ids within each project (§10). */
  fileOrder: Record<string, string[]>;
  /** File assignment: blockId → ordered file ids (session state, §3). */
  assignments: Record<string, string[]>;
  /** Image asset registry (id → asset) for image fields / literal images. */
  imageAssets: Record<string, ImageAsset>;
  /** Metadata (title/author/…) for token expansion. */
  metadata: { title?: string; author?: string; date?: string };
  /** Number of files in the document (for the {files} token). */
  fileCount: number;
}

/** One file lookup entry (project + file). */
interface FileEntry {
  project: DocumentProject;
  file: DocumentFile;
}

/** Build a global fileId → {project, file} index (file ids are unique). */
function buildFileIndex(projects: DocumentProject[]): Map<string, FileEntry> {
  const map = new Map<string, FileEntry>();
  for (const project of projects) {
    for (const file of project.files) {
      map.set(file.highlighted.fileId, { project, file });
    }
  }
  return map;
}

/**
 * Ordered assigned files for one block: the block's assignment list
 * filtered to files that exist, then sorted into the CANONICAL document
 * order of their projects (§10 — one shared ordering everywhere).
 */
function orderedAssignedFiles(
  blockId: string,
  inputs: ResolutionInputs,
  index: Map<string, FileEntry>,
): FileEntry[] {
  const ids = inputs.assignments[blockId] ?? [];
  const entries: FileEntry[] = [];
  for (const id of ids) {
    const entry = index.get(id);
    if (entry) entries.push(entry);
  }
  const orderOf = (entry: FileEntry): number => {
    const order = inputs.fileOrder[entry.project.id];
    if (!order) return Number.MAX_SAFE_INTEGER;
    const idx = order.indexOf(entry.file.highlighted.fileId);
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };
  return entries.sort((a, b) => {
    if (a.project.id !== b.project.id) {
      // Projects keep their relative order (projects array order).
      const pa = inputs.projects.findIndex((p) => p.id === a.project.id);
      const pb = inputs.projects.findIndex((p) => p.id === b.project.id);
      return pa - pb;
    }
    return orderOf(a) - orderOf(b);
  });
}

/** Expand template text tokens with the current instance context. */
function expandBlockText(
  text: string,
  inputs: ResolutionInputs,
  ctx: ResolutionContext,
  entry?: FileEntry,
): string {
  let fileName = '';
  let filePath = '';
  if (entry) {
    fileName = entry.file.highlighted.relativePath.split('/').pop() ?? '';
    filePath = entry.file.highlighted.relativePath;
  }
  // {filePath} is a layout-only token (not part of the shared page-token
  // catalog) — expand it first, then run the shared engine for the rest.
  return expandTokens(text.replaceAll('{filePath}', filePath), {
    title: inputs.metadata.title ?? '',
    author: inputs.metadata.author ?? '',
    date: inputs.metadata.date || new Date().toLocaleDateString(),
    files: inputs.fileCount,
    projectName: entry?.project.label ?? '',
    fileName,
  });
}

/** Extract the common text presentation props from a node's style. */
function textProps(node: TemplateNode): {
  align?: 'left' | 'center' | 'right';
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
} {
  const s = node.style;
  if (!s) return {};
  return {
    align: s.align,
    fontSizePt: s.fontSizePt,
    bold: s.bold,
    italic: s.italic,
    color: s.color,
  };
}

/** Resolve an image reference (field value = asset id) to a resolved block. */
function resolveImageRef(
  assetId: string | undefined,
  caption: boolean,
  align: 'left' | 'center' | 'right' | undefined,
  inputs: ResolutionInputs,
): ResolvedLayoutBlock | null {
  if (!assetId) return null;
  const asset = inputs.imageAssets[assetId];
  if (!asset) return null;
  return {
    kind: 'image',
    imageId: asset.id,
    name: asset.name,
    dataUrl: asset.dataUrl,
    mime: asset.mime,
    width: asset.width,
    height: asset.height,
    caption: asset.caption,
    align,
    captionVisible: caption,
  };
}

/** Format bytes like the rest of the app (matches lib/fileDiscovery). */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Field-value lookup with section-scope fallback (block → section). */
function fieldValue(ctx: ResolutionContext, fieldId: string | undefined): string {
  if (!fieldId) return '';
  return ctx.fieldValues[fieldId] ?? ctx.sectionValues?.[fieldId] ?? '';
}

/** §4 — the kind of the field a node is bound to (when known). Image-kind
 * fields hold ASSET IDS: a text/heading node bound to them must never
 * render the raw id as text (the stray "OUTPUT img-…" sequence). The
 * dedicated image node renders the actual image instead.
 */
function boundFieldKind(ctx: ResolutionContext, fieldId: string | undefined): TemplateFieldType | undefined {
  if (!fieldId) return undefined;
  return ctx.fieldKinds?.[fieldId];
}

/**
 * §25 — a panel's `textColor` is the DEFAULT color for the text inside it:
 * children that declare their own color keep it, the rest inherit the
 * panel's. Pure — returns a new list, never mutates the input.
 */
function applyPanelTextColor(
  textColor: string | undefined,
  children: ResolvedLayoutBlock[],
): ResolvedLayoutBlock[] {
  if (!textColor) return children;
  return children.map((child) => {
    if (
      (child.kind === 'paragraph' || child.kind === 'heading' || child.kind === 'labeled') &&
      !child.color
    ) {
      return { ...child, color: textColor };
    }
    if (child.kind === 'panel' && !child.textColor) {
      return { ...child, textColor };
    }
    return child;
  });
}

/**
 * Resolve one node (with its children) in the given instance context.
 * Returns 0..n resolved blocks — file-bound nodes without file context
 * produce nothing (the skip is intentional and documented).
 */
function resolveNode(
  node: TemplateNode,
  inputs: ResolutionInputs,
  ctx: ResolutionContext,
  entry: FileEntry | undefined,
): ResolvedLayoutBlock[] {
  const style = node.style ?? {};
  const details = entry ? inputs.fileDetails[entry.file.highlighted.fileId] : undefined;

  switch (node.type) {
    case 'text': {
      // §4 — text nodes bound to IMAGE-kind fields render nothing: the
      // image node renders the actual image; the raw asset id is data,
      // never document text.
      if (node.fieldId && boundFieldKind(ctx, node.fieldId) === 'image') return [];
      const source = node.fieldId ? fieldValue(ctx, node.fieldId) : (node.text ?? '');
      const text = expandBlockText(source, inputs, ctx, entry);
      if (!text.trim()) return [];
      if (style.label && node.fieldId) {
        const label = expandBlockText(labelFor(ctx, node.fieldId) || 'Text', inputs, ctx, entry);
        return [{ kind: 'labeled', label, text, ...textProps(node) }];
      }
      return [{ kind: 'paragraph', text, nodeId: node.id, ...textProps(node) }];
    }
    case 'heading': {
      // §4 — same guard for headings bound to image-kind fields.
      if (node.fieldId && boundFieldKind(ctx, node.fieldId) === 'image') return [];
      const source = node.fieldId ? fieldValue(ctx, node.fieldId) : (node.text ?? '');
      const text = expandBlockText(source, inputs, ctx, entry);
      if (!text.trim()) return [];
      return [{
        kind: 'heading',
        level: style.level ?? 2,
        text,
        nodeId: node.id,
        // §17 — block headings repeat per file: the anchor is unique per
        // instance; standalone headings anchor by node id alone.
        anchorId: entry ? `${node.id}-f-${entry.file.highlighted.fileId}` : node.id,
        ...textProps(node),
      }];
    }
    case 'description': {
      if (!entry || !details?.description?.trim()) return [];
      return [{ kind: 'labeled', label: 'Description', text: details.description, ...textProps(node) }];
    }
    case 'summary': {
      if (!entry || !details?.summary?.trim()) return [];
      return [{ kind: 'labeled', label: 'Summary', text: details.summary, ...textProps(node) }];
    }
    case 'note': {
      if (!entry || !details?.note?.trim()) return [];
      return [{ kind: 'labeled', label: 'Note', text: details.note, ...textProps(node) }];
    }
    case 'file': {
      if (!entry) return [];
      return [
        { kind: 'fileHeader', projectId: entry.project.id, fileId: entry.file.highlighted.fileId },
        { kind: 'code', projectId: entry.project.id, fileId: entry.file.highlighted.fileId },
      ];
    }
    case 'code': {
      if (!entry) return [];
      return [{ kind: 'code', projectId: entry.project.id, fileId: entry.file.highlighted.fileId }];
    }
    case 'fileName': {
      if (!entry) return [];
      const name = entry.file.highlighted.relativePath.split('/').pop() ?? '';
      if (!name) return [];
      return [{ kind: 'paragraph', text: name, ...textProps(node) }];
    }
    case 'filePath': {
      if (!entry) return [];
      return [
        {
          kind: 'paragraph',
          text: entry.file.highlighted.relativePath,
          ...textProps(node),
        },
      ];
    }
    case 'language': {
      if (!entry) return [];
      const lang = entry.file.language;
      if (!lang) return [];
      return [{ kind: 'paragraph', text: lang, ...textProps(node) }];
    }
    case 'fileSize': {
      if (!entry) return [];
      return [
        {
          kind: 'paragraph',
          text: formatFileSize(entry.file.sizeBytes),
          ...textProps(node),
        },
      ];
    }
    case 'lineCount': {
      if (!entry) return [];
      return [
        {
          kind: 'paragraph',
          text: String(entry.file.highlighted.lines.length),
          ...textProps(node),
        },
      ];
    }
    case 'fileImages': {
      if (!entry) return [];
      const out: ResolvedLayoutBlock[] = [];
      for (const img of entry.file.images ?? []) {
        out.push({
          kind: 'image',
          imageId: img.id,
          name: img.name,
          dataUrl: img.dataUrl,
          mime: img.mime,
          width: img.width,
          height: img.height,
          caption: img.caption,
          align: style.align,
          captionVisible: style.caption !== false,
        });
      }
      return out;
    }
    case 'image': {
      if (node.fieldId) {
        const img = resolveImageRef(
          fieldValue(ctx, node.fieldId),
          style.caption !== false,
          style.align,
          inputs,
        );
        return img ? [img] : [];
      }
      // Literal library image: asset id carried in text.
      const img = resolveImageRef(node.text || undefined, style.caption !== false, style.align, inputs);
      return img ? [img] : [];
    }
    case 'project': {
      const project = entry?.project;
      if (!project) return [];
      return [{ kind: 'projectHeader', projectId: project.id }];
    }
    case 'metadata':
      return [{ kind: 'metadata' }];
    case 'toc':
      return [{ kind: 'toc' }];
    case 'pageBreak':
      return [{ kind: 'pageBreak' }];
    case 'spacer':
      return [{ kind: 'spacer', heightPt: Math.max(4, style.heightPt ?? 12) }];
    case 'divider':
      return [
        {
          kind: 'divider',
          heightPt: Math.max(0.75, style.heightPt ?? 1),
          fillColor: style.fillColor ?? undefined,
        },
      ];
    case 'panel': {
      const children = (node.children?.[0] ?? []).flatMap((c) =>
        resolveNode(c, inputs, ctx, entry),
      );
      if (children.length === 0) {
        // Empty panel with an explicit height = a filled box (divider bar /
        // spacer block, §6). Without an explicit height it renders nothing.
        const h = style.heightPt;
        if (!h || h <= 0) return [];
        return [
          {
            kind: 'divider',
            heightPt: Math.max(0.75, h),
            fillColor: style.fillColor ?? undefined,
          },
        ];
      }
      return [
        {
          kind: 'panel',
          nodeId: node.id,
          fillColor: style.fillColor ?? undefined,
          borderColor: style.borderColor ?? undefined,
          borderWidthPt: style.borderWidthPt,
          radiusPt: style.radiusPt,
          paddingPt: style.paddingPt,
          textColor: style.textColor ?? undefined,
          children: applyPanelTextColor(style.textColor, children),
        },
      ];
    }
    case 'columns': {
      const count = style.columns ?? 2;
      const columns: ResolvedLayoutBlock[][] = [];
      for (let i = 0; i < count; i++) {
        const stack = node.children?.[i] ?? [];
        columns.push(stack.flatMap((c) => resolveNode(c, inputs, ctx, entry)));
      }
      if (columns.every((c) => c.length === 0)) return [];
      return [{ kind: 'columns', nodeId: node.id, count: count as 2 | 3, columns }];
    }
    default:
      return [];
  }
}

/** Find the label of a field by id (searches nothing global — labels are
 * carried on the nodes via a lookup the caller builds). */
function labelFor(ctx: ResolutionContext, fieldId: string): string {
  return ctx.fieldLabels?.[fieldId] ?? '';
}

/**
 * Resolve one block definition instance for one assigned file.
 * Block field values merge OVER the owning section's values (§4).
 */
function resolveBlockInstance(
  blockNodes: TemplateNode[],
  inputs: ResolutionInputs,
  ctx: ResolutionContext,
  entry: FileEntry,
): ResolvedLayoutBlock[] {
  const fileCtx: ResolutionContext = {
    fieldValues: {
      ...(ctx.sectionValues ?? {}),
      ...(inputs.fileFieldValues[entry.file.highlighted.fileId] ?? {}),
    },
    sectionValues: ctx.sectionValues,
    fieldLabels: ctx.fieldLabels,
    file: { projectId: entry.project.id, fileId: entry.file.highlighted.fileId },
  };
  return blockNodes.flatMap((n) => resolveNode(n, inputs, fileCtx, entry));
}

/**
 * Resolve the whole template into the final content stream.
 * Pure — no React, no DOM, no exporter specifics (§17).
 *
 * Guarantees (§3/§7):
 *   - FILE-LEVEL standalone content resolves first (a document title
 *     heading, a closing summary… — content that belongs to no Section).
 *   - Every Section of the layout appears in every resolved document, in
 *     layout order — Sections are the document skeleton and are NEVER
 *     divided between projects/exports. A Section whose content resolves
 *     to nothing for the current data still keeps its structural presence
 *     via a fallback heading carrying the section's name.
 */
export function resolveCustomLayout(
  template: CustomLayoutTemplate,
  inputs: ResolutionInputs,
): ResolvedCustomLayout {
  const index = buildFileIndex(inputs.projects);
  const blocks: ResolvedLayoutBlock[] = [];

  for (const section of template.sections) {
    const sectionValues = inputs.sectionFieldValues[section.id] ?? {};
    // §3 — resolve the section into its own slice first so the page-break
    // marker never masquerades as "content" (an empty section must still
    // keep its structural place instead of emitting a bare empty page).
    const sectionBlocks: ResolvedLayoutBlock[] = [];

    for (const child of section.children) {
      if (child.kind === 'node') {
        // Standalone section content — no file context.
        const ctx: ResolutionContext = {
          fieldValues: sectionValues,
          sectionValues,
          fieldLabels: fieldLabelMap(section),
          fieldKinds: fieldKindMap(section),
        };
        sectionBlocks.push(...resolveNode(child.node, inputs, ctx, undefined));
      } else {
        // Block pattern — exactly one instance per assigned file (§3).
        const labelMap = {
          ...fieldLabelMap(section),
          ...fieldLabelMapOfBlock(child.block),
        };
        const kindMap = fieldKindMapOfBlock(section, child.block);
        for (const entry of orderedAssignedFiles(child.block.id, inputs, index)) {
          const ctx: ResolutionContext = {
            fieldValues: sectionValues,
            sectionValues,
            fieldLabels: labelMap,
            fieldKinds: kindMap,
          };
          sectionBlocks.push(...resolveBlockInstance(child.block.nodes, inputs, ctx, entry));
        }
      }
    }

    // §3 — a Section that produced ZERO content for this document (no
    // filled fields, no assigned files in this document's scope) still
    // keeps its place in the document skeleton. The fallback heading is
    // the section's own name from the layout — never invented data. The
    // nodeId is derived from the section id, so the outline anchor is
    // stable across resolutions.
    if (sectionBlocks.length === 0 && section.children.length > 0) {
      sectionBlocks.push({
        kind: 'heading',
        level: 2,
        text: expandBlockText(section.name, inputs, {
          fieldValues: sectionValues,
          sectionValues,
        }),
        nodeId: `sec-${section.id}`,
      });
    }

    if (section.pageBreakBefore && blocks.length > 0) {
      blocks.push({ kind: 'pageBreak' });
    }
    blocks.push(...sectionBlocks);
  }

  // §7 — FILE-LEVEL standalone content resolves BEFORE the sections
  // (it models content above the whole section flow, e.g. a title).
  const fileChildren = template.children ?? [];
  const fileLevel: ResolvedLayoutBlock[] = [];
  if (fileChildren.length > 0) {
    const ctx: ResolutionContext = { fieldValues: {}, fieldLabels: {}, fieldKinds: {} };
    for (const child of fileChildren) {
      if (child.kind === 'node') {
        fileLevel.push(...resolveNode(child.node, inputs, ctx, undefined));
      }
    }
  }

  return {
    templateId: template.id,
    templateName: template.name,
    blocks: [...fileLevel, ...blocks],
  };
}

/** fieldId → label map for a section's own fields (for labeled rendering). */
function fieldLabelMap(section: { fields: Array<{ id: string; label: string }> }): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of section.fields) map[f.id] = f.label;
  return map;
}

function fieldLabelMapOfBlock(block: { fields: Array<{ id: string; label: string }> }): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of block.fields) map[f.id] = f.label;
  return map;
}

/** fieldId → kind map for a section's fields (§4 image-field guard). */
function fieldKindMap(section: TemplateSection): Record<string, TemplateFieldType> {
  const map: Record<string, TemplateFieldType> = {};
  for (const f of section.fields) map[f.id] = f.kind;
  return map;
}

/** Combined section + block field kinds for block instances (§4). */
function fieldKindMapOfBlock(
  section: TemplateSection,
  block: { fields: Array<{ id: string; kind: TemplateFieldType }> },
): Record<string, TemplateFieldType> {
  return { ...fieldKindMap(section), ...Object.fromEntries(block.fields.map((f) => [f.id, f.kind])) };
}
