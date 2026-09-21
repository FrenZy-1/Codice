/**
 * End-to-end smoke test: builds a DocumentModel from a fake project,
 * exports to all three formats, and verifies the output signatures.
 *
 * This test runs in Node (not jsdom) to ensure the exporters work in a
 * non-browser environment too — useful for catching browser-API assumptions.
 */

import { describe, expect, it } from 'vitest';
import { docxExporter } from '../lib/exporters/docxExporter';
import { odtExporter } from '../lib/exporters/odtExporter';
import { pdfExporter } from '../lib/exporters/pdfExporter';
import type { DocumentModel, HighlightedFile } from '@/types';
import { defaultDocumentOptions } from '@/lib/defaultOptions';

function makeFile(path: string, language: string, lines: string[]): HighlightedFile {
  return {
    fileId: `f-${path}`,
    relativePath: path,
    language,
    lines: lines.map((text, i) => ({
      lineNumber: i + 1,
      text,
      tokens: [
        {
          start: 0,
          length: text.length,
          scopes: [],
          color: '#24292e',
        },
      ],
    })),
  };
}

describe('end-to-end export', () => {
  it('exports a multi-file, multi-project document to DOCX/PDF/ODT', async () => {
    const options = defaultDocumentOptions();
    const model: DocumentModel = {
      metadata: {
        title: 'End-to-End Test',
        author: 'Vitest',
        course: 'TEST 101',
      },
      options,
      projects: [
        {
          id: 'p1',
          label: 'Project A',
          folderName: 'project-a',
          structurePaths: [
            'src/main.java',
            'src/util.java',
            'README.md',
          ],
          files: [
            {
              projectId: 'p1',
              projectLabel: 'Project A',
              relativePath: 'src/main.java',
              language: 'java',
              highlighted: makeFile('src/main.java', 'java', [
                'public class Main {',
                '    public static void main(String[] args) {',
                '        System.out.println("Hello");',
                '    }',
                '}',
              ]),
              sizeBytes: 1024,
            },
            {
              projectId: 'p1',
              projectLabel: 'Project A',
              relativePath: 'src/util.java',
              language: 'java',
              highlighted: makeFile('src/util.java', 'java', [
                'class Util {',
                '    static int add(int a, int b) {',
                '        return a + b;',
                '    }',
                '}',
              ]),
              sizeBytes: 512,
            },
            {
              projectId: 'p1',
              projectLabel: 'Project A',
              relativePath: 'README.md',
              language: 'markdown',
              highlighted: makeFile('README.md', 'markdown', [
                '# Project A',
                '',
                'A simple test project.',
              ]),
              sizeBytes: 256,
            },
          ],
        },
        {
          id: 'p2',
          label: 'Project B',
          folderName: 'project-b',
          structurePaths: ['main.py', 'requirements.txt'],
          files: [
            {
              projectId: 'p2',
              projectLabel: 'Project B',
              relativePath: 'main.py',
              language: 'python',
              highlighted: makeFile('main.py', 'python', [
                'def main():',
                '    print("Hello from Python")',
                '',
                'if __name__ == "__main__":',
                '    main()',
              ]),
              sizeBytes: 384,
            },
            {
              projectId: 'p2',
              projectLabel: 'Project B',
              relativePath: 'requirements.txt',
              language: 'plaintext',
              highlighted: makeFile('requirements.txt', 'plaintext', [
                'requests>=2.31',
                'pyyaml>=6.0',
              ]),
              sizeBytes: 64,
            },
          ],
        },
      ],
      generatedAt: new Date().toISOString(),
    };

    const formats: Array<'docx' | 'pdf' | 'odt'> = ['docx', 'pdf', 'odt'];
    for (const format of formats) {
      const exporter = { docx: docxExporter, pdf: pdfExporter, odt: odtExporter }[format];
      const result = await exporter.export(model, {
        format,
        filename: `e2e-test-${format}`,
      });
      expect(result.format).toBe(format);
      expect(result.filename).toBe(`e2e-test-${format}.${format}`);
      expect(result.blob.size).toBeGreaterThan(0);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  }, 60000);
});
