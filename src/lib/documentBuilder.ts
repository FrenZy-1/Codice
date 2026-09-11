/**
 * Document model builder.
 *
 * Takes the user's selected files + metadata + options and produces a
 * `DocumentModel` ready to be passed to an exporter. This module also
 * performs the syntax highlighting (using the configured theme) and is the
 * main slow path for large projects — it should run inside a Web Worker.
 */

import type {
  DiscoveredFile,
  DocumentModel,
  DocumentOptions,
  DocumentFile,
  DocumentProject,
  DocumentMetadata,
  HighlightedFile,
  ProjectEntry,
} from '@/types';
import { highlightFile } from '@/lib/highlight/highlighter';

/** Build a DocumentModel from selected projects and files. */
export async function buildDocumentModel(
  projects: Array<{
    project: ProjectEntry;
    selectedFileIds: Set<string>;
  }>,
  options: DocumentOptions,
  metadata: DocumentMetadata,
  onProgress?: (done: number, total: number, currentPath?: string) => void,
): Promise<DocumentModel> {
  // Collect all files to process so we can show progress.
  const allFiles: Array<{ project: ProjectEntry; file: DiscoveredFile }> = [];
  for (const { project, selectedFileIds } of projects) {
    for (const file of project.files) {
      if (!file.excluded && selectedFileIds.has(file.id)) {
        allFiles.push({ project, file });
      }
    }
  }

  const total = allFiles.length;
  let done = 0;

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

    const docFile: DocumentFile = {
      projectId: project.id,
      projectLabel: project.label,
      relativePath: file.relativePath,
      language: file.language,
      highlighted,
      sizeBytes: file.size,
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

  // Sort files within each project by relative path.
  for (const dp of projectMap.values()) {
    dp.files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    dp.structurePaths.sort();
  }

  return {
    metadata,
    options,
    projects: Array.from(projectMap.values()),
    generatedAt: new Date().toISOString(),
  };
}
