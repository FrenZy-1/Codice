/**
 * Document model builder.
 *
 * Takes the user's selected files + metadata + options and produces a
 * `DocumentModel` ready to be passed to an exporter. This module also
 * performs the syntax highlighting (using the configured theme) and is the
 * main slow path for large projects — it should run inside a Web Worker.
 *
 * Ordering (spec §13-§15/§36): files within each project are emitted in the
 * canonical document order (`fileOrder[projectId]`) — never the raw
 * discovery order — so the preview, the Outline, and all three exporters
 * process reordered files in exactly the order the user arranged.
 *
 * Per-file content (spec §6-§12): user details (summary/description/note)
 * and attached images ride INSIDE the document model so every exporter sees
 * them without reaching into UI state.
 */

import type {
  DiscoveredFile,
  DocumentModel,
  DocumentOptions,
  DocumentFile,
  DocumentProject,
  DocumentImage,
  DocumentMetadata,
  FileDetails,
  HighlightedFile,
  ImageAsset,
  ProjectEntry,
} from '@/types';
import { highlightFile } from '@/lib/highlight/highlighter';
import { effectiveFileOrder } from '@/lib/documentOrder';

/** Input for one project: the entry + its selection + presentation order. */
export interface ProjectInput {
  project: ProjectEntry;
  selectedFileIds: Set<string>;
  /** Canonical document order of file ids (undefined = default order). */
  order?: string[];
}

/** Per-file user content attached to the model (all optional). */
export interface DocumentUserContent {
  fileDetails?: Record<string, FileDetails>;
  /** Image asset ids attached to each file, in attachment order. */
  fileImages?: Record<string, string[]>;
  /** Image asset registry used to resolve attachment ids. */
  imageAssets?: ImageAsset[];
}

/** Build a DocumentModel from selected projects and files. */
export async function buildDocumentModel(
  projects: ProjectInput[],
  options: DocumentOptions,
  metadata: DocumentMetadata,
  onProgress?: (done: number, total: number, currentPath?: string) => void,
  userContent: DocumentUserContent = {},
): Promise<DocumentModel> {
  // Collect all files to process so we can show progress — in DOCUMENT
  // order (§36): reordered files are processed exactly as arranged.
  const allFiles: Array<{ project: ProjectEntry; file: DiscoveredFile }> = [];
  for (const { project, selectedFileIds, order } of projects) {
    const ordered = effectiveFileOrder(project.files, order);
    for (const file of ordered) {
      if (!file.excluded && selectedFileIds.has(file.id)) {
        allFiles.push({ project, file });
      }
    }
  }

  const total = allFiles.length;
  let done = 0;

  const assetMap = new Map<string, ImageAsset>(
    (userContent.imageAssets ?? []).map((a) => [a.id, a]),
  );

  const projectMap = new Map<string, DocumentProject>();

  for (const { project, file } of allFiles) {
    onProgress?.(done, total, file.relativePath);
    let highlighted: HighlightedFile;
    try {
      const text = file.fileHandle
        ? await file.fileHandle.getText()
        : '';
      highlighted = await highlightFile(
        file.id,
        file.relativePath,
        file.language,
        text,
        options.syntaxTheme,
      );
    } catch (err) {
      // Skip unreadable files but keep them in the doc with an error message.
      const message =
        err instanceof Error ? err.message : 'Could not read file';
      highlighted = {
        fileId: file.id,
        relativePath: file.relativePath,
        language: null,
        lines: [
          {
            lineNumber: 1,
            text: `[Error: ${message}]`,
            tokens: [
              {
                start: 0,
                length: message.length + 8,
                scopes: [],
                color: '#cb2431',
                bold: true,
              },
            ],
          },
        ],
      };
    }

    const details = userContent.fileDetails?.[file.id];
    const imageIds = userContent.fileImages?.[file.id] ?? [];
    const images: DocumentImage[] = [];
    for (const id of imageIds) {
      const asset = assetMap.get(id);
      if (asset) {
        images.push({
          id: asset.id,
          name: asset.name,
          dataUrl: asset.dataUrl,
          mime: asset.mime,
          width: asset.width,
          height: asset.height,
          caption: asset.caption,
        });
      }
    }

    const docFile: DocumentFile = {
      projectId: project.id,
      projectLabel: project.label,
      relativePath: file.relativePath,
      language: file.language,
      highlighted,
      sizeBytes: file.size,
      ...(details ? { details } : {}),
      ...(images.length > 0 ? { images } : {}),
    };

    let dp = projectMap.get(project.id);
    if (!dp) {
      dp = {
        id: project.id,
        label: project.label,
        folderName: project.folderName,
        files: [],
        structurePaths: [],
      };
      projectMap.set(project.id, dp);
    }
    dp.files.push(docFile);
    dp.structurePaths.push(file.relativePath);

    done++;
    onProgress?.(done, total, file.relativePath);
  }

  // NOTE: files are intentionally NOT re-sorted here — `allFiles` was built
  // in the canonical document order per project (§36). Structure paths keep
  // the same presentation order so the tree mirrors the document.
  for (const dp of projectMap.values()) {
    dp.structurePaths = dp.files.map((f) => f.relativePath);
  }

  return {
    metadata,
    options,
    projects: Array.from(projectMap.values()),
    generatedAt: new Date().toISOString(),
  };
}
