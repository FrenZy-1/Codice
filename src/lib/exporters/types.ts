/**
 * Exporter abstraction.
 *
 * Each exporter takes a `DocumentModel` and returns a Blob. The exporter is
 * intentionally independent of the file parsing / highlighting layer so new
 * output formats can be added without touching the rest of the pipeline.
 */

import type { DocumentModel, ExportOptions, ExportResult } from '@/types';

export interface DocumentExporter {
  /** Format id this exporter handles. */
  readonly format: 'docx' | 'pdf' | 'odt';
  /** Human-readable label. */
  readonly label: string;
  /** MIME type of the produced blob. */
  readonly mimeType: string;
  /** File extension (without dot). */
  readonly extension: string;
  /** Convert a DocumentModel into a binary Blob. */
  export(model: DocumentModel, options: ExportOptions): Promise<ExportResult>;
}

/** Wrap an exporter call with timing and error normalization. */
export async function runExport(
  exporter: DocumentExporter,
  model: DocumentModel,
  options: ExportOptions,
): Promise<ExportResult> {
  const start = performance.now();
  try {
    const result = await exporter.export(model, options);
    return result;
  } catch (err) {
    const elapsed = performance.now() - start;
    const message =
      err instanceof Error ? err.message : 'Unknown export error';
    throw new Error(
      `${exporter.format.toUpperCase()} export failed after ${Math.round(elapsed)}ms: ${message}`,
    );
  }
}
