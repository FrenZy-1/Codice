/**
 * Custom layout → preview element bridge (§17/§26).
 *
 * ONE canonical data flow:
 *   Project/File data → Document data → Custom Layout Template
 *     → (resolver) → ResolvedLayoutBlock[] → THIS module → PreviewElement[]
 *     → shared paginator → Preview
 *
 * The main preview never invents its own representation of the custom
 * template — it consumes the same resolved stream the exporters receive.
 *
 * `fileId`/`projectId` references in code/fileHeader/projectHeader blocks
 * are mapped to indexes of the preview's PaginationProject list. Blocks
 * referencing files outside the preview's (documented) window render as
 * nothing, exactly like the standard flow's preview limit.
 */

import type {
  DocumentImage,
  ResolvedCustomLayout,
  ResolvedLayoutBlock,
} from '@/types';
import type {
  PreviewElement,
  PaginationProject,
} from '@/lib/preview/documentPagination';
import {
  duplicateFilenames,
  type OutlineEntry,
} from '@/lib/documentOutline';

/** Index maps for resolving projectId/fileId references to preview indexes. */
export interface LayoutIndexMaps {
  /** projectId → projectIdx in the preview's pagination list. */
  projectIdx: Map<string, number>;
  /** `${projectId}::${fileId}` → fileIdx within that project. */
  fileIdx: Map<string, number>;
}

export function buildLayoutIndexMaps(
  projects: PaginationProject[],
): LayoutIndexMaps {
  const projectIdx = new Map<string, number>();
  const fileIdx = new Map<string, number>();
  projects.forEach((p, pi) => {
    if (p.outlineProjectId) projectIdx.set(p.outlineProjectId, pi);
    p.files.forEach((f, fi) => {
      if (f.outlineFileId) fileIdx.set(`${p.outlineProjectId}::${f.outlineFileId}`, fi);
    });
  });
  return { projectIdx, fileIdx };
}

/** Map a resolved image to a standalone image element. */
function imageElement(img: Extract<ResolvedLayoutBlock, { kind: 'image' }>): Extract<PreviewElement, { type: 'image' }> {
  const image: DocumentImage = {
    id: img.imageId,
    name: img.name,
    dataUrl: img.dataUrl,
    mime: img.mime,
    width: img.width,
    height: img.height,
    caption: img.caption,
  };
  return { type: 'image', image };
}

/** Convert one text-ish resolved block. */
function textElement(
  block: Extract<ResolvedLayoutBlock, { kind: 'heading' | 'paragraph' | 'labeled' }>,
): PreviewElement {
  // §12/§46 — carry the resolved presentation props (align/size/bold/
  // italic/color) onto the preview element so the MAIN preview renders the
  // same canonical stream the exporters and the layout studio receive.
  const props = {
    align: block.align,
    fontSizePt: block.fontSizePt,
    bold: block.bold,
    italic: block.italic,
    color: block.color,
  };
  if (block.kind === 'heading') {
    return {
      type: 'heading',
      level: block.level === 1 ? 'h1' : block.level === 2 ? 'h2' : 'h3',
      text: block.text,
      numberPrefix: '',
      breakBefore: false,
      // §17 — layout headings are outline anchors (unique per instance).
      outlineId: (block.anchorId ?? block.nodeId)
        ? `outline-h-${block.anchorId ?? block.nodeId}`
        : undefined,
      ...props,
    };
  }
  if (block.kind === 'labeled') {
    return { type: 'fileDetail', label: block.label, text: block.text, ...props };
  }
  return { type: 'paragraph', text: block.text, ...props };
}

/**
 * Convert the resolved custom layout into preview elements.
 * Unknown/unrenderable blocks are skipped — never invented (§17).
 */
export function customLayoutToElements(
  resolved: ResolvedCustomLayout,
  projects: PaginationProject[],
  maps: LayoutIndexMaps = buildLayoutIndexMaps(projects),
): PreviewElement[] {
  // §39 — positional divider anchor counter (see the divider case).
  let dividerSeq = 0;
  const convert = (blocks: ResolvedLayoutBlock[]): PreviewElement[] => {
    const out: PreviewElement[] = [];
    for (const block of blocks) {
      switch (block.kind) {
        case 'heading':
        case 'paragraph':
        case 'labeled':
          out.push(textElement(block));
          break;
        case 'fileHeader': {
          const pi = maps.projectIdx.get(block.projectId);
          const fi = maps.fileIdx.get(`${block.projectId}::${block.fileId}`);
          if (pi === undefined || fi === undefined) break;
          out.push({
            type: 'fileHeader',
            projectIdx: pi,
            fileIdx: fi,
            outlineId: `outline-file-${block.fileId}`,
          });
          break;
        }
        case 'code': {
          const pi = maps.projectIdx.get(block.projectId);
          const fi = maps.fileIdx.get(`${block.projectId}::${block.fileId}`);
          if (pi === undefined || fi === undefined) break;
          out.push({
            type: 'code',
            projectIdx: pi,
            fileIdx: fi,
            fromLine: 0,
            toLine: Number.MAX_SAFE_INTEGER,
            startLineNumber: 1,
            // §15 — the code block is a navigation fallback anchor when a
            // layout renders no fileHeader for this file.
            outlineId: `outline-file-${block.fileId}`,
          });
          break;
        }
        case 'image':
          out.push({
            ...imageElement(block),
            // §39 — standalone layout images are navigable landmarks.
            outlineId: `outline-image-${block.imageId}`,
          });
          break;
        case 'pageBreak':
          out.push({ type: 'pageBreak' });
          break;
        case 'spacer':
          out.push({ type: 'spacer', height: block.heightPt * (4 / 3) });
          break;
        case 'divider':
          out.push({
            type: 'divider',
            heightPx: Math.max(1, block.heightPt * (4 / 3)),
            fillColor: block.fillColor ?? undefined,
            // §39 — positional anchor: dividers have no model id, so the
            // conversion index provides a stable-per-resolution anchor.
            outlineId: `outline-divider-${dividerSeq++}`,
          });
          break;
        case 'panel':
          out.push({
            type: 'panel',
            fillColor: block.fillColor,
            borderColor: block.borderColor,
            borderWidthPt: block.borderWidthPt,
            radiusPt: block.radiusPt,
            paddingPt: block.paddingPt,
            heightPt: block.heightPt,
            textColor: block.textColor,
            outlineId: block.nodeId ? `outline-panel-${block.nodeId}` : undefined,
            children: convert(block.children),
          });
          break;
        case 'columns':
          out.push({
            type: 'columns',
            count: block.count,
            outlineId: block.nodeId ? `outline-panel-${block.nodeId}` : undefined,
            columns: block.columns.map(convert),
          });
          break;
        case 'toc':
          out.push({ type: 'toc', outlineId: 'outline-toc' });
          break;
        case 'metadata':
          out.push({ type: 'titlePage', outlineId: 'outline-title' });
          break;
        case 'projectHeader': {
          const pi = maps.projectIdx.get(block.projectId);
          if (pi === undefined) break;
          out.push({ type: 'projectHeader', projectIdx: pi, outlineId: `outline-project-${block.projectId}` });
          break;
        }
        default:
          break;
      }
    }
    return out;
  };

  return convert(resolved.blocks);
}

/**
 * Outline for the applied custom layout — mirrors the resolved stream so
 * the Outline panel navigates layout documents exactly like standard ones
 * (§13: ONE synchronized outline model; the pill can never disappear just
 * because a layout uses code-only or heading blocks).
 */
export function buildLayoutOutline(
  resolved: ResolvedCustomLayout,
  projects: PaginationProject[],
): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const projectById = new Map(
    projects.map((p, i) => [p.outlineProjectId ?? String(i), p] as const),
  );
  // One outline entry per file — fileHeader + code both carry the anchor;
  // dedupe so the panel never lists a file twice (§15).
  const seenFiles = new Set<string>();
  const seenHeadings = new Set<string>();
  // §39 — panel/column/image/divider landmark dedupe + positional anchors.
  const seenPanels = new Set<string>();
  const seenImages = new Set<string>();
  let dividerSeq = 0;

  const walk = (blocks: ResolvedLayoutBlock[]) => {
    for (const block of blocks) {
      if (block.kind === 'metadata') {
        entries.push({ id: 'outline-title', kind: 'title', label: 'Title page', depth: 0 });
      } else if (block.kind === 'toc') {
        entries.push({ id: 'outline-toc', kind: 'toc', label: 'Table of Contents', depth: 0 });
      } else if (block.kind === 'projectHeader') {
        const p = projectById.get(block.projectId);
        entries.push({
          id: `outline-project-${block.projectId}`,
          kind: 'project',
          label: p?.label ?? block.projectId,
          detail: p ? (p.files.length === 1 ? '1 file' : `${p.files.length} files`) : undefined,
          depth: 0,
        });
      } else if (block.kind === 'heading') {
        // §17 — document structure: file-level / section / block headings
        // (TOC-worthy outline content), each with a stable per-instance
        // anchor (block headings repeat per file — dedupe defensively).
        const anchor = block.anchorId ?? block.nodeId;
        if (anchor && !seenHeadings.has(anchor)) {
          seenHeadings.add(anchor);
          entries.push({
            id: `outline-h-${anchor}`,
            kind: 'heading',
            label: block.text,
            depth: block.level === 1 ? 0 : 1,
            tooltip: 'Heading in the document layout',
          });
        }
      } else if (block.kind === 'panel') {
        // §39 — panels are navigable landmarks (before descending into
        // their content, so the panel entry precedes its children).
        if (block.nodeId && !seenPanels.has(block.nodeId)) {
          seenPanels.add(block.nodeId);
          entries.push({
            id: `outline-panel-${block.nodeId}`,
            kind: 'panel',
            label: 'Panel',
            detail: block.children.length > 0 ? `${block.children.length} item${block.children.length === 1 ? '' : 's'}` : undefined,
            depth: 1,
            tooltip: 'Panel container in the document layout',
          });
        }
        walk(block.children);
      } else if (block.kind === 'columns') {
        // §39 — columns are panel-family landmarks.
        if (block.nodeId && !seenPanels.has(block.nodeId)) {
          seenPanels.add(block.nodeId);
          entries.push({
            id: `outline-panel-${block.nodeId}`,
            kind: 'panel',
            label: `Columns (${block.count})`,
            depth: 1,
            tooltip: 'Column layout in the document layout',
          });
        }
        for (const col of block.columns) walk(col);
      } else if (block.kind === 'image') {
        // §39 — standalone images are navigable landmarks (deduped by id:
        // file-attachment images repeat per file instance).
        if (!seenImages.has(block.imageId)) {
          seenImages.add(block.imageId);
          entries.push({
            id: `outline-image-${block.imageId}`,
            kind: 'image',
            label: block.caption?.trim() || block.name,
            depth: 1,
            tooltip: block.caption?.trim() || `Image — ${block.name}`,
          });
        }
      } else if (block.kind === 'divider') {
        // §39 — dividers are navigable landmarks (positional anchor shared
        // with the element conversion: same resolution order).
        const anchor = `outline-divider-${dividerSeq++}`;
        entries.push({
          id: anchor,
          kind: 'divider',
          label: 'Divider',
          depth: 1,
          tooltip: 'Divider rule in the document layout',
        });
      } else if (block.kind === 'fileHeader' || block.kind === 'code') {
        const fileId = block.fileId;
        if (seenFiles.has(fileId)) continue;
        seenFiles.add(fileId);
        const p = projectById.get(block.projectId);
        const file = p?.files.find((f) => f.outlineFileId === fileId);
        const path = file?.path ?? fileId;
        const name = path.split('/').pop() ?? path;
        entries.push({
          id: `outline-file-${fileId}`,
          kind: 'file',
          // §16 — filename by default; the path only to disambiguate
          // duplicate filenames; full path always in the tooltip.
          label: file ? (fileDuplicateNames.has(name) ? path : name) : fileId,
          detail: file?.language,
          depth: 1,
          tooltip: file && p ? `${p.label}/${file.path}` : path,
          // Reorder support — same canonical state as the standard outline.
          projectId: block.projectId,
          fileId,
        });
      }
    }
  };

  // Pre-compute duplicate filenames across the visible files (§16).
  const fileDuplicateNames = duplicateFilenames(
    projects.flatMap((p) => p.files.map((f) => f.path)),
  );

  walk(resolved.blocks);
  return entries;
}
