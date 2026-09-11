/**
 * Exporter registry.
 *
 * Exporters are looked up by format id. To add a new format, implement the
 * `DocumentExporter` interface and register it here.
 */

import type { DocumentExporter } from './types';
import { docxExporter } from './docxExporter';
import { pdfExporter } from './pdfExporter';
import { odtExporter } from './odtExporter';

export const EXPORTERS: Record<string, DocumentExporter> = {
  docx: docxExporter,
  pdf: pdfExporter,
  odt: odtExporter,
};

/** Look up an exporter by format. */
export function getExporter(format: 'docx' | 'pdf' | 'odt'): DocumentExporter {
  const exporter = EXPORTERS[format];
  if (!exporter) {
    throw new Error(`Unknown export format: ${format}`);
  }
  return exporter;
}

export type { DocumentExporter } from './types';
export { runExport } from './types';
