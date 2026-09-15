import { describe, it, expect } from 'vitest';
import {
  buildDocumentOutline,
  formatOutlineText,
  outlineGlyph,
  outlineAnchorId,
  type OutlineProjectInput,
} from '@/lib/documentOutline';

function project(overrides: Partial<OutlineProjectInput> = {}): OutlineProjectInput {
  return {
    id: 'p1',
    label: 'sample-app',
    files: [
      {
        fileId: 'f1',
        relativePath: 'src/App.java',
        language: 'java',
        sizeBytes: 328,
      },
      {
        fileId: 'f2',
        relativePath: 'README.md',
        language: 'markdown',
        sizeBytes: 145,
      },
    ],
    ...overrides,
  };
}

describe('buildDocumentOutline', () => {
  it('emits title page, TOC, projects and files in document order', () => {
    const entries = buildDocumentOutline({
      projects: [project()],
      includeTitlePage: true,
      hasTitle: true,
      includeToc: true,
      includeStructure: false,
    });
    expect(entries.map((e) => e.kind)).toEqual([
      'title',
      'toc',
      'project',
      'files',
      'file',
      'file',
    ]);
    expect(entries.map((e) => e.id)).toEqual([
      'outline-title',
      'outline-toc',
      'outline-project-p1',
      'outline-files-p1',
      'outline-file-f1',
      'outline-file-f2',
    ]);
  });

  it('omits the title entry when the title page is disabled or untitled', () => {
    const disabled = buildDocumentOutline({
      projects: [project()],
      includeTitlePage: false,
      hasTitle: true,
      includeToc: false,
      includeStructure: false,
    });
    const untitled = buildDocumentOutline({
      projects: [project()],
      includeTitlePage: true,
      hasTitle: false,
      includeToc: false,
      includeStructure: false,
    });
    expect(disabled.some((e) => e.kind === 'title')).toBe(false);
    expect(untitled.some((e) => e.kind === 'title')).toBe(false);
  });

  it('omits the TOC entry when disabled', () => {
    const entries = buildDocumentOutline({
      projects: [],
      includeTitlePage: true,
      hasTitle: true,
      includeToc: false,
      includeStructure: false,
    });
    expect(entries.some((e) => e.kind === 'toc')).toBe(false);
  });

  it('marks files as depth 1 and sections as depth 0', () => {
    const entries = buildDocumentOutline({
      projects: [project()],
      includeTitlePage: false,
      hasTitle: false,
      includeToc: false,
      includeStructure: false,
    });
    expect(entries.map((e) => e.depth)).toEqual([0, 1, 1, 1]);
  });

  it('inserts the Project Structure subsection when includeStructure is set', () => {
    const entries = buildDocumentOutline({
      projects: [project()],
      includeTitlePage: false,
      hasTitle: false,
      includeToc: false,
      includeStructure: true,
    });
    expect(entries.map((e) => e.kind)).toEqual([
      'project',
      'structure',
      'files',
      'file',
      'file',
    ]);
    const structure = entries[1];
    expect(structure.label).toBe('Project Structure');
    expect(structure.depth).toBe(1);
    expect(structure.id).toBe('outline-structure-p1');
  });

  it('pluralizes the project file count detail', () => {
    const one = buildDocumentOutline({
      projects: [project({ files: [project().files[0]] })],
      includeTitlePage: false,
      hasTitle: false,
      includeToc: false,
      includeStructure: false,
    });
    const many = buildDocumentOutline({
      projects: [project()],
      includeTitlePage: false,
      hasTitle: false,
      includeToc: false,
      includeStructure: false,
    });
    expect(one[0].detail).toBe('1 file');
    expect(many[0].detail).toBe('2 files');
  });

  it('carries the file language as detail when present', () => {
    const entries = buildDocumentOutline({
      projects: [
        project({
          files: [
            { fileId: 'x1', relativePath: 'a.txt', language: null, sizeBytes: 1 },
          ],
        }),
      ],
      includeTitlePage: false,
      hasTitle: false,
      includeToc: false,
      includeStructure: false,
    });
    // entries: [project ('1 file'), files subsection ('1 file'), file]
    expect(entries[2].kind).toBe('file');
    expect(entries[2].detail).toBeUndefined();
    expect(entries[0].detail).toBe('1 file');
  });

  it('interleaves multiple projects with their own files', () => {
    const entries = buildDocumentOutline({
      projects: [
        project(),
        project({ id: 'p2', label: 'second', files: [] }),
      ],
      includeTitlePage: false,
      hasTitle: false,
      includeToc: false,
      includeStructure: false,
    });
    expect(entries.map((e) => e.label)).toEqual([
      'sample-app',
      'Source Files',
      // §16 — unique filenames show the NAME only; the path is the tooltip.
      'App.java',
      'README.md',
      'second',
      'Source Files',
    ]);
    expect(entries[2].tooltip).toBe('sample-app/src/App.java');
    const second = entries[4];
    expect(second.kind).toBe('project');
    expect(second.detail).toBe('0 files');
  });

  it('returns an empty outline with everything disabled', () => {
    expect(
      buildDocumentOutline({
        projects: [],
        includeTitlePage: false,
        hasTitle: true,
        includeToc: false,
        includeStructure: false,
      }),
    ).toEqual([]);
  });
});

describe('formatOutlineText', () => {
  it('indents by depth and appends details as suffixes', () => {
    const entries = buildDocumentOutline({
      projects: [project()],
      includeTitlePage: false,
      hasTitle: false,
      includeToc: false,
      includeStructure: false,
    });
    const text = formatOutlineText(entries);
    expect(text.split('\n')).toEqual([
      '▣ sample-app  (2 files)',
      '  ⋮ Source Files  (2 files)',
      // §16 — filename-only label for unique names.
      '  · App.java  (java)',
      '  · README.md  (markdown)',
    ]);
  });

  it('omits the detail suffix when an entry has none', () => {
    const text = formatOutlineText([
      { id: 't', kind: 'title', label: 'Title page', depth: 0 },
    ]);
    expect(text).toBe('❖ Title page');
  });

  it('returns an empty string for an empty outline', () => {
    expect(formatOutlineText([])).toBe('');
  });
});

describe('outline helpers', () => {
  it('anchor ids are stable and DOM-safe', () => {
    const entries = buildDocumentOutline({
      projects: [project()],
      includeTitlePage: true,
      hasTitle: true,
      includeToc: true,
      includeStructure: false,
    });
    for (const entry of entries) {
      expect(outlineAnchorId(entry)).toBe(entry.id);
      expect(entry.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('every outline kind has a glyph', () => {
    for (const kind of [
      'title',
      'toc',
      'project',
      'structure',
      'files',
      'file',
    ] as const) {
      expect(outlineGlyph(kind).length).toBeGreaterThan(0);
    }
  });

  it('glyphs are stable per kind', () => {
    expect(outlineGlyph('title')).toBe('❖');
    expect(outlineGlyph('toc')).toBe('☰');
    expect(outlineGlyph('project')).toBe('▣');
    expect(outlineGlyph('structure')).toBe('⌗');
    expect(outlineGlyph('files')).toBe('⋮');
    expect(outlineGlyph('file')).toBe('·');
  });
});
