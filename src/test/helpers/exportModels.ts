/**
 * Shared DocumentModel builders for exporter-focused tests.
 *
 * Keeps model construction in ONE place so per-format layout tests can build
 * realistic (multi-project, structured) models without repeating boilerplate.
 */

import type {
  DocumentModel,
  DocumentOptions,
  HighlightedFile,
  HighlightToken,
} from '../../types';
import { defaultDocumentOptions } from '../../lib/defaultOptions';

/** One token covering the whole line (what Shiki emits for plain text). */
function fullToken(text: string, color: string): HighlightToken[] {
  return text.length === 0
    ? []
    : [{ start: 0, length: text.length, scopes: [], color }];
}

/** Build a minimal HighlightedFile whose lines all use the given color. */
export function makeHighlightedFile(
  relativePath: string,
  code: string,
  color = '#24292e',
): HighlightedFile {
  return {
    fileId: relativePath,
    relativePath,
    language: relativePath.split('.').pop() ?? null,
    lines: code.split('\n').map((text, i) => ({
      lineNumber: i + 1,
      text,
      tokens: fullToken(text, color),
    })),
  };
}

export interface ModelProjectInput {
  label: string;
  files: Array<{
    path: string;
    language: string;
    highlighted: HighlightedFile;
  }>;
  structurePaths?: string[];
}

/** Build a complete DocumentModel from compact project descriptions. */
export function buildProjectsModel(
  projects: ModelProjectInput[],
  options?: Partial<DocumentOptions>,
): DocumentModel {
  return {
    metadata: {
      title: 'Preview Model',
      subtitle: '',
      author: 'Codice QA',
      version: '',
      description: '',
    },
    options: { ...defaultDocumentOptions(), ...options },
    projects: projects.map((p, i) => ({
      id: `p${i + 1}`,
      label: p.label,
      folderName: p.label,
      files: p.files.map((f) => ({
        projectId: `p${i + 1}`,
        projectLabel: p.label,
        relativePath: f.path,
        language: f.language,
        highlighted: f.highlighted,
        sizeBytes: f.highlighted.lines.reduce(
          (acc, l) => acc + l.text.length + 1,
          0,
        ),
      })),
      structurePaths: p.structurePaths ?? p.files.map((f) => f.path),
    })),
    generatedAt: new Date('2024-01-01T12:00:00Z').toISOString(),
  };
}
