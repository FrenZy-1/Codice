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
function imageElement(img: Extract<ResolvedLayoutBlock, { kind: 'image' }>): PreviewElement {
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
  if (block.kind === 'heading') {
    return {
      type: 'heading',
      level: block.level === 1 ? 'h1' : block.level === 2 ? 'h2' : 'h3',
      text: block.text,
      numberPrefix: '',
      breakBefore: false,
    };
  }
  if (block.kind === 'labeled') {
    return { type: 'fileDetail', label: block.label, text: block.text };
  }
  return { type: 'paragraph', text: block.text };
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
          out.push(imageElement(block));
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
            children: convert(block.children),
          });
          break;
        case 'columns':
          out.push({
            type: 'columns',
            count: block.count,
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
): Array<{ id: string; kind: 'title' | 'toc' | 'project' | 'file'; label: string; detail?: string; depth: 0 | 1 }> {
  const entries: Array<{
    id: string;
    kind: 'title' | 'toc' | 'project' | 'file';
    label: string;
    detail?: string;
    depth: 0 | 1;
  }> = [];
  const projectById = new Map(
    projects.map((p, i) => [p.outlineProjectId ?? String(i), p] as const),
  );
  // One outline entry per file — fileHeader + code both carry the anchor;
  // dedupe so the panel never lists a file twice (§15).
  const seenFiles = new Set<string>();

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
      } else if (block.kind === 'fileHeader' || block.kind === 'code') {
        const fileId = block.fileId;
        if (seenFiles.has(fileId)) continue;
        seenFiles.add(fileId);
        const p = projectById.get(block.projectId);
        const file = p?.files.find((f) => f.outlineFileId === fileId);
        entries.push({
          id: `outline-file-${fileId}`,
          kind: 'file',
          label: file?.path ?? fileId,
          detail: file?.language,
          depth: 1,
        });
      } else if (block.kind === 'panel') {
        walk(block.children);
      } else if (block.kind === 'columns') {
        for (const col of block.columns) walk(col);
      }
    }
  };
  walk(resolved.blocks);
  return entries;
}
