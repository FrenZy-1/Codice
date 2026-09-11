import { describe, expect, it } from 'vitest';
import { presetToOptions } from '../lib/presets/presetToOptions';
import { getBuiltInPreset } from '../lib/presets/builtInPresets';
import { docxExporter } from '../lib/exporters/docxExporter';
import { pdfExporter } from '../lib/exporters/pdfExporter';
import { odtExporter } from '../lib/exporters/odtExporter';
import type { DocumentModel, HighlightedFile } from '@/types';
import JSZip from 'jszip';

/** Build a minimal document model with the given preset. */
function buildModel(): DocumentModel {
  const preset = getBuiltInPreset('university')!;
  const options = presetToOptions(preset);
  const file1: HighlightedFile = {
    fileId: 'f1',
    relativePath: 'src/Main.java',
    language: 'java',
    lines: [
      {
        lineNumber: 1,
        text: 'public class Main { }',
        tokens: [{ start: 0, length: 21, scopes: [], color: '#24292e' }],
      },
    ],
  };
  const file2: HighlightedFile = {
    fileId: 'f2',
    relativePath: 'src/Util.java',
    language: 'java',
    lines: [
      {
        lineNumber: 1,
        text: 'class Util { }',
        tokens: [{ start: 0, length: 14, scopes: [], color: '#24292e' }],
      },
    ],
  };
  return {
    metadata: { title: 'Test' },
    options,
    projects: [
      {
        id: 'p1',
        label: 'Project A',
        folderName: 'project-a',
        files: [
          {
            projectId: 'p1',
            projectLabel: 'Project A',
            relativePath: 'src/Main.java',
            language: 'java',
            highlighted: file1,
            sizeBytes: 100,
          },
        ],
        structurePaths: ['src/Main.java'],
      },
      {
        id: 'p2',
        label: 'Project B',
        folderName: 'project-b',
        files: [
          {
            projectId: 'p2',
            projectLabel: 'Project B',
            relativePath: 'src/Util.java',
            language: 'java',
            highlighted: file2,
            sizeBytes: 80,
          },
        ],
        structurePaths: ['src/Util.java'],
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

/** Read a Blob's first bytes safely (jsdom's Blob may not have arrayBuffer()). */
async function readFirstBytes(blob: Blob, n: number): Promise<Uint8Array> {
  const slice = blob.slice(0, n);
  if (typeof (slice as any).arrayBuffer === 'function') {
    const buf = await (slice as any).arrayBuffer();
    return new Uint8Array(buf);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      resolve(new Uint8Array(buf));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(slice);
  });
}

/** Read an entire Blob as ArrayBuffer (jsdom-safe). */
async function readArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof (blob as any).arrayBuffer === 'function') {
    return await (blob as any).arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('multi-project export — combined mode', () => {
  it('exports a single document containing all projects', async () => {
    const model = buildModel();
    const result = await docxExporter.export(model, {
      format: 'docx',
      filename: 'combined-test',
    });
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.filename).toBe('combined-test.docx');
  });
});

describe('multi-project export — separate mode (ZIP)', () => {
  it('produces a valid ZIP when packaging separate exports', async () => {
    const model = buildModel();
    const zip = new JSZip();
    for (const project of model.projects) {
      const singleProjectModel: DocumentModel = {
        ...model,
        projects: [project],
      };
      const result = await docxExporter.export(singleProjectModel, {
        format: 'docx',
        filename: project.label,
      });
      zip.file(result.filename, result.blob);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    expect(zipBlob.size).toBeGreaterThan(0);

    // Verify it's a valid ZIP by re-reading it.
    const arrayBuf = await readArrayBuffer(zipBlob);
    const reopened = await JSZip.loadAsync(arrayBuf);
    const fileNames = Object.keys(reopened.files);
    expect(fileNames).toContain('Project A.docx');
    expect(fileNames).toContain('Project B.docx');
  });

  it('each separate export is a valid DOCX', async () => {
    const model = buildModel();
    for (const project of model.projects) {
      const singleProjectModel: DocumentModel = {
        ...model,
        projects: [project],
      };
      const result = await docxExporter.export(singleProjectModel, {
        format: 'docx',
        filename: project.label,
      });
      // DOCX files start with PK ZIP signature.
      const buf = await readFirstBytes(result.blob, 2);
      expect(buf[0]).toBe(0x50);
      expect(buf[1]).toBe(0x4b);
    }
  });
});

describe('same preset feeds all exporters', () => {
  it('DOCX, PDF, ODT all accept the same DocumentModel', async () => {
    const model = buildModel();
    const docxResult = await docxExporter.export(model, {
      format: 'docx',
      filename: 'all-formats-test',
    });
    const pdfResult = await pdfExporter.export(model, {
      format: 'pdf',
      filename: 'all-formats-test',
    });
    const odtResult = await odtExporter.export(model, {
      format: 'odt',
      filename: 'all-formats-test',
    });
    expect(docxResult.blob.size).toBeGreaterThan(0);
    expect(pdfResult.blob.size).toBeGreaterThan(0);
    expect(odtResult.blob.size).toBeGreaterThan(0);
  }, 30000);
});
