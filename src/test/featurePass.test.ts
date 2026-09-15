/**
 * Tests for the large feature pass:
 *   - document ordering (§13-§15/§36)
 *   - custom layout model + resolver + validation + storage (§16-§31)
 *   - preview bridge (§32/§33)
 *   - pagination of new element types (panels/columns/pageBreak/images)
 *   - standalone files discovery (§4)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  effectiveFileOrder,
  moveFileInOrder,
  reorderFileTo,
} from '@/lib/documentOrder';
import {
  createEmptyTemplate,
  createExampleTemplate,
  createSection,
  createBlockDef,
  cloneTemplate,
  genLayoutId,
  migrateTemplateV1,
  SECTION_TYPE_PRESETS,
  type CustomLayoutTemplate,
  type CustomLayoutTemplateV1,
  type TemplateSection,
  type SectionChild,
} from '@/lib/customLayouts/model';
import { resolveCustomLayout } from '@/lib/customLayouts/resolver';
import {
  validateCustomLayout,
  formatMissingRequirements,
  unassignedFileIds,
} from '@/lib/customLayouts/validation';
import {
  loadCustomLayouts,
  storeCustomLayout,
  updateCustomLayout,
  deleteCustomLayout,
  duplicateCustomLayout,
  exportLayoutJson,
  importLayoutJson,
} from '@/lib/customLayouts/storage';
import {
  customLayoutToElements,
  buildLayoutIndexMaps,
  buildLayoutOutline,
} from '@/lib/customLayouts/previewElements';
import {
  buildDocumentElements,
  paginateDocument,
  type PaginationProject,
} from '@/lib/preview/documentPagination';
import { discoverStandaloneFiles } from '@/lib/fileDiscovery';
import { fitImageBox, dataUrlToBytes } from '@/lib/imageAssets';
import type {
  DiscoveredFile,
  DocumentImage,
  DocumentProject,
  ImageAsset,
} from '@/types';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeFile(id: string, relativePath: string): DiscoveredFile {
  return {
    id,
    projectId: 'p1',
    relativePath,
    name: relativePath.split('/').pop() ?? relativePath,
    directory: '',
    size: 100,
    language: 'kotlin',
    isConfig: false,
    binary: false,
    excluded: false,
  };
}

function makeDocProject(
  id: string,
  label: string,
  fileIds: string[],
): DocumentProject {
  return {
    id,
    label,
    folderName: label,
    structurePaths: fileIds.map((f) => `${f}.kt`),
    files: fileIds.map((fid) => ({
      projectId: id,
      projectLabel: label,
      relativePath: `${fid}.kt`,
      language: 'kotlin',
      highlighted: {
        fileId: fid,
        relativePath: `${fid}.kt`,
        language: 'kotlin',
        lines: [{ lineNumber: 1, text: `val x = 1 // ${fid}`, tokens: [] }],
      },
      sizeBytes: 100,
    })),
  };
}

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mP8z8AARIQBExMDDQMDAwCVAgVDPMSZAAAAAElFTkSuQmCC';

function makeImage(id: string, over: Partial<ImageAsset> = {}): ImageAsset {
  return {
    id,
    name: `${id}.png`,
    dataUrl: TINY_PNG,
    mime: 'image/png',
    width: 800,
    height: 600,
    sizeBytes: 100,
    addedAt: 1,
    ...over,
  };
}

const BASE_FILTER = {
  excludedDirs: [] as string[],
  excludedExtensions: [] as string[],
  excludedFilenames: [] as string[],
  includeGlobs: [] as string[],
  excludeGlobs: [] as string[],
  includeSource: true,
  includeConfig: true,
  includeMarkdown: true,
  customExtensions: [] as string[],
};

/* ------------------------------------------------------------------ */
/* §13-§15/§36 — document ordering                                     */
/* ------------------------------------------------------------------ */

describe('document ordering (§13-§15/§36)', () => {
  const files = [makeFile('a', 'A.kt'), makeFile('b', 'B.kt'), makeFile('c', 'C.kt')];

  it('defaults to discovery order when no order is stored', () => {
    expect(effectiveFileOrder(files, undefined).map((f) => f.id)).toEqual(['a', 'b', 'c']);
  });

  it('applies the stored arrangement first, appending never-ordered files', () => {
    expect(effectiveFileOrder(files, ['c']).map((f) => f.id)).toEqual(['c', 'a', 'b']);
    expect(effectiveFileOrder(files, ['b', 'c', 'a']).map((f) => f.id)).toEqual(['b', 'c', 'a']);
  });

  it('drops stale ids (files that no longer exist)', () => {
    expect(effectiveFileOrder(files, ['z', 'b']).map((f) => f.id)).toEqual(['b', 'a', 'c']);
  });

  it('moves a file by a relative offset within the same project only', () => {
    expect(moveFileInOrder(undefined, files, 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(moveFileInOrder(undefined, files, 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveFileInOrder(undefined, files, 'c', 5)).toEqual(['a', 'b', 'c']);
  });

  it('reorders to an absolute position (drag and drop)', () => {
    expect(reorderFileTo(undefined, files, 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(reorderFileTo(['c', 'a', 'b'], files, 'c', 2)).toEqual(['a', 'b', 'c']);
  });

  it('keeps unknown file ids out of the result', () => {
    expect(moveFileInOrder(undefined, files, 'nope', 1)).toEqual(['a', 'b', 'c']);
  });
});

/* ------------------------------------------------------------------ */
/* §16-§24 — custom layout model                                       */
/* ------------------------------------------------------------------ */

describe('custom layout model v2 (§1-§4/§16-§24)', () => {
  it('creates a starter template with one Task section (§1)', () => {
    const t = createEmptyTemplate('Coursework');
    expect(t.name).toBe('Coursework');
    expect(t.version).toBe(2);
    expect(t.sections).toHaveLength(1);
    const s = t.sections[0];
    expect(s.type).toBe('task');
    expect(s.fields.map((f) => f.label)).toEqual(['Task Title', 'Description']);
    expect(s.children.every((c) => c.kind === 'node')).toBe(true);
  });

  it('clones deeply — no shared references between copies (§8/§24)', () => {
    const t = createEmptyTemplate('A');
    const copy = cloneTemplate(t);
    copy.sections[0].name = 'mutated';
    copy.sections[0].fields.push({ id: 'x', label: 'x', kind: 'text', required: true });
    expect(t.sections[0].name).not.toBe('mutated');
    expect(t.sections[0].fields).toHaveLength(2);
  });

  it('generates unique ids', () => {
    const a = genLayoutId('b');
    const b = genLayoutId('b');
    expect(a).not.toBe(b);
  });

  it('section type presets populate a correct initial structure (§1/§27)', () => {
    for (const preset of Object.values(SECTION_TYPE_PRESETS)) {
      const s = createSection(preset.id);
      expect(s.type).toBe(preset.id);
      if (preset.id === 'task') {
        expect(s.fields.map((f) => f.label)).toEqual(['Task Title', 'Description']);
        expect(s.children).toHaveLength(2);
      }
      if (preset.id === 'descriptionAnswer') {
        const labels = s.fields.map((f) => f.label);
        expect(labels).toContain('Answer');
        expect(s.fields.find((f) => f.label === 'Answer')?.required).toBe(true);
      }
    }
  });

  it('example template mirrors the acceptance example (§29/§0)', () => {
    const t = createExampleTemplate();
    expect(t.sections.map((s) => s.type)).toEqual(['task', 'descriptionAnswer']);
    const taskSection = t.sections[0];
    const blockChild = taskSection.children.find(
      (c): c is Extract<SectionChild, { kind: 'block' }> => c.kind === 'block',
    );
    expect(blockChild).toBeTruthy();
    expect(blockChild!.block.nodes.map((n) => n.type)).toEqual([
      'heading',
      'description',
      'file',
      'note',
      'fileImages',
    ]);
    // required section fields exist for validation
    expect(taskSection.fields.filter((f) => f.required).map((f) => f.label)).toContain('Task Title');
    expect(taskSection.fields.filter((f) => f.required).map((f) => f.label)).toContain('Output Screenshot');
  });

  it('migrates legacy v1 templates into the hierarchy (§9)', () => {
    const v1: CustomLayoutTemplateV1 = {
      id: 'old',
      name: 'Legacy',
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      repeat: 'eachFile',
      fields: [{ id: 'fld1', label: 'Note field', kind: 'text', required: false }],
      blocks: [
        { id: 'b1', type: 'heading', text: '{fileName}', style: { level: 2 } },
        { id: 'b2', type: 'code' },
      ],
    };
    const v2 = migrateTemplateV1(v1);
    expect(v2.version).toBe(2);
    expect(v2.sections).toHaveLength(1);
    // File-bound v1 nodes fold into a block definition…
    const blockChild = v2.sections[0].children.find(
      (c): c is Extract<SectionChild, { kind: 'block' }> => c.kind === 'block',
    );
    expect(blockChild).toBeTruthy();
    expect(blockChild!.block.nodes.map((n) => n.type)).toEqual(['code']);
    // …while standalone nodes (heading) remain section content.
    const nodeChildren = v2.sections[0].children.filter((c) => c.kind === 'node');
    expect(nodeChildren).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* §3/§4/§17 — resolver semantics (sections, blocks, fields)           */
/* ------------------------------------------------------------------ */

describe('custom layout resolver v2 (§3/§4/§17)', () => {
  const projects = [makeDocProject('p1', 'Proj One', ['f1', 'f2'])];
  const inputs = (over: Partial<Parameters<typeof resolveCustomLayout>[1]> = {}) => ({
    projects,
    fileDetails: {},
    fileFieldValues: {},
    sectionFieldValues: {},
    fileOrder: {},
    assignments: {},
    imageAssets: {},
    metadata: { title: 'My Doc', author: 'Ada' },
    fileCount: 2,
    ...over,
  });

  function oneSectionTemplate(build: (s: TemplateSection) => void): CustomLayoutTemplate {
    const t = createEmptyTemplate('T');
    t.sections = [];
    const s = createSection('custom', 'S');
    build(s);
    t.sections.push(s);
    return t;
  }

  it('renders sections once, in order; block instances repeat per assigned file (§3)', () => {
    const t = createEmptyTemplate('T');
    const block = createBlockDef('Code', [{ type: 'heading', text: '{fileName}', style: { level: 2 } }]);
    t.sections[0].children.push({ kind: 'block', id: genLayoutId('ch'), block });
    const resolved = resolveCustomLayout(t, inputs({
      assignments: { [block.id]: ['f1', 'f2'] },
    }));
    expect(resolved.blocks).toHaveLength(2);
    expect(resolved.blocks[0]).toMatchObject({ kind: 'heading', text: 'f1.kt' });
    expect(resolved.blocks[1]).toMatchObject({ kind: 'heading', text: 'f2.kt' });
  });

  it('a file with NO block assignment renders no file content, but the section keeps its structural place (§3 fallback)', () => {
    const t = createEmptyTemplate('T');
    const block = createBlockDef('Code', [{ type: 'file' }]);
    t.sections[0].children.push({ kind: 'block', id: genLayoutId('ch'), block });
    const resolved = resolveCustomLayout(t, inputs());
    // §3 — an empty section must not silently vanish: the fallback heading
    // carries the section's own name so every document shows the full
    // Section structure of the layout.
    expect(resolved.blocks).toHaveLength(1);
    expect(resolved.blocks[0]).toMatchObject({ kind: 'heading', text: t.sections[0].name });
  });

  it('the block pattern repeats exactly ONCE per file — never duplicates (§3/§27)', () => {
    const t = createEmptyTemplate('T');
    const block = createBlockDef('Code', [
      { type: 'heading', text: '{fileName}', style: { level: 2 } },
      { type: 'code' },
    ]);
    t.sections[0].children.push({ kind: 'block', id: genLayoutId('ch'), block });
    const resolved = resolveCustomLayout(t, inputs({
      assignments: { [block.id]: ['f1', 'f2'] },
    }));
    const headings = resolved.blocks.filter((b) => b.kind === 'heading');
    const codes = resolved.blocks.filter((b) => b.kind === 'code');
    expect(headings).toHaveLength(2);
    expect(codes).toHaveLength(2);
    expect(headings.map((h) => (h as { text: string }).text)).toEqual(['f1.kt', 'f2.kt']);
  });

  it('assigned files render in the CANONICAL document order, not assignment order (§10)', () => {
    const t = createEmptyTemplate('T');
    const block = createBlockDef('Code', [{ type: 'heading', text: '{fileName}', style: { level: 1 } }]);
    t.sections[0].children.push({ kind: 'block', id: genLayoutId('ch'), block });
    const resolved = resolveCustomLayout(t, inputs({
      assignments: { [block.id]: ['f2', 'f1'] },      // deliberately reversed
      fileOrder: { p1: ['f1', 'f2'] },                 // canonical order
    }));
    expect(resolved.blocks.map((b) => (b as { text: string }).text)).toEqual(['f1.kt', 'f2.kt']);
  });

  it('section fields resolve once per section — NOT once per file (§4/§27)', () => {
    const t = createEmptyTemplate('T');
    const block = createBlockDef('Code', [{ type: 'code' }]);
    const titleField = { id: 'title', label: 'Task Title', kind: 'text' as const, required: false };
    t.sections[0].fields.push(titleField);
    t.sections[0].children.push(
      { kind: 'node', id: genLayoutId('ch'), node: { id: genLayoutId('n'), type: 'text', fieldId: 'title' } },
      { kind: 'block', id: genLayoutId('ch'), block },
    );
    const resolved = resolveCustomLayout(t, inputs({
      assignments: { [block.id]: ['f1', 'f2'] },
      sectionFieldValues: { [t.sections[0].id]: { title: 'Chapter 1' } },
    }));
    const paragraphs = resolved.blocks.filter((b) => b.kind === 'paragraph');
    expect(paragraphs).toHaveLength(1); // once, not once per file
    expect(paragraphs[0]).toMatchObject({ text: 'Chapter 1' });
    expect(resolved.blocks.filter((b) => b.kind === 'code')).toHaveLength(2);
  });

  it('block fields bind per file; section fields are the fallback scope (§4)', () => {
    const t = createEmptyTemplate('T');
    const noteField = { id: 'nf', label: 'Per-file note', kind: 'text' as const, required: false };
    const block = createBlockDef('Code', [
      { type: 'text', fieldId: 'nf' },
    ], [noteField]);
    t.sections[0].children.push({ kind: 'block', id: genLayoutId('ch'), block });
    const resolved = resolveCustomLayout(t, inputs({
      assignments: { [block.id]: ['f1', 'f2'] },
      fileFieldValues: { f1: { nf: 'first' }, f2: { nf: 'second' } },
    }));
    expect(resolved.blocks.map((b) => (b as { text: string }).text)).toEqual(['first', 'second']);
  });

  it('binds description/summary/note to the CURRENT file details (§8)', () => {
    const t = createEmptyTemplate('T');
    const block = createBlockDef('Details', [
      { type: 'description' },
      { type: 'summary' },
      { type: 'note' },
    ]);
    t.sections[0].children.push({ kind: 'block', id: genLayoutId('ch'), block });
    const resolved = resolveCustomLayout(t, inputs({
      assignments: { [block.id]: ['f1', 'f2'] },
      fileDetails: {
        f1: { description: 'D1', summary: 'S1', note: 'N1' },
        f2: { description: 'D2' },
      },
    }));
    // f1: 3 labeled blocks; f2: only description
    expect(resolved.blocks).toHaveLength(4);
    expect(resolved.blocks[0]).toMatchObject({ kind: 'labeled', label: 'Description', text: 'D1' });
    expect(resolved.blocks[3]).toMatchObject({ kind: 'labeled', label: 'Description', text: 'D2' });
  });

  it('fileImages node expands the file\'s attached images with captions (§7/§16)', () => {
    const t = createEmptyTemplate('T');
    const block = createBlockDef('Imgs', [{ type: 'fileImages' }]);
    t.sections[0].children.push({ kind: 'block', id: genLayoutId('ch'), block });
    const docProject = makeDocProject('p1', 'Proj One', ['f1', 'f2']);
    docProject.files[0].images = [
      { id: 'img1', name: 'a.png', dataUrl: TINY_PNG, mime: 'image/png', width: 4, height: 4, caption: 'First shot' },
      { id: 'img2', name: 'b.png', dataUrl: TINY_PNG, mime: 'image/png', width: 4, height: 4 },
    ];
    const resolved = resolveCustomLayout(t, inputs({ projects: [docProject], assignments: { [block.id]: ['f1'] } }));
    const images = resolved.blocks.filter((b) => b.kind === 'image');
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({ kind: 'image', imageId: 'img1', caption: 'First shot' });
  });

  it('resolves section-scope image fields from the section value store (§7)', () => {
    const t = createEmptyTemplate('T');
    const shotField = { id: 'shot', label: 'Screenshot', kind: 'image' as const, required: false };
    t.sections[0].fields.push(shotField);
    t.sections[0].children.push(
      { kind: 'node', id: genLayoutId('ch'), node: { id: genLayoutId('n'), type: 'image', fieldId: 'shot' } },
    );
    const asset = makeImage('img1');
    const resolved = resolveCustomLayout(t, inputs({
      imageAssets: { img1: asset },
      sectionFieldValues: { [t.sections[0].id]: { shot: 'img1' } },
    }));
    expect(resolved.blocks).toHaveLength(1);
    expect(resolved.blocks[0]).toMatchObject({ kind: 'image', imageId: 'img1', dataUrl: TINY_PNG });
  });

  it('resolves image fields from the per-file (block) scope (§37)', () => {
    const t = createEmptyTemplate('T');
    const shotField = { id: 'shot', label: 'Screenshot', kind: 'image' as const, required: false };
    const block = createBlockDef('Imgs', [{ type: 'image', fieldId: 'shot' }], [shotField]);
    t.sections[0].children.push({ kind: 'block', id: genLayoutId('ch'), block });
    const asset = makeImage('img1');
    const resolved = resolveCustomLayout(t, inputs({
      imageAssets: { img1: asset },
      assignments: { [block.id]: ['f1', 'f2'] },
      fileFieldValues: { f1: { shot: 'img1' } },
    }));
    expect(resolved.blocks).toHaveLength(1); // only f1 has a value
    expect(resolved.blocks[0]).toMatchObject({ kind: 'image', imageId: 'img1' });
  });

  it('expands {filePath} and shared tokens in text nodes', () => {
    const t = createEmptyTemplate('T');
    const block = createBlockDef('Txt', [{ type: 'text', text: '{filePath} ({projectName})' }]);
    t.sections[0].children.push({ kind: 'block', id: genLayoutId('ch'), block });
    const resolved = resolveCustomLayout(t, inputs({
      assignments: { [block.id]: ['f1'] },
    }));
    expect(resolved.blocks[0]).toMatchObject({
      kind: 'paragraph',
      text: 'f1.kt (Proj One)',
    });
  });

  it('renders new per-file meta fields: fileName/filePath/language/fileSize/lineCount (§4)', () => {
    const t = createEmptyTemplate('T');
    const block = createBlockDef('Meta', [
      { type: 'fileName' },
      { type: 'filePath' },
      { type: 'language' },
      { type: 'fileSize' },
      { type: 'lineCount' },
    ]);
    t.sections[0].children.push({ kind: 'block', id: genLayoutId('ch'), block });
    const resolved = resolveCustomLayout(t, inputs({
      assignments: { [block.id]: ['f1'] },
    }));
    const texts = resolved.blocks.map((b) => (b.kind === 'paragraph' ? b.text : ''));
    expect(texts).toEqual(['f1.kt', 'f1.kt', 'kotlin', '100 B', '1']);
  });

  it('resolves panels, columns and dividers with their children (§6)', () => {
    const t = oneSectionTemplate(() => {});
    const s = t.sections[0];
    s.children.push(
      {
        kind: 'node',
        id: genLayoutId('ch'),
        node: {
          id: genLayoutId('n'),
          type: 'columns',
          style: { columns: 2 },
          children: [
            [{ id: genLayoutId('n'), type: 'text', text: 'left' }],
            [{ id: genLayoutId('n'), type: 'text', text: 'right' }],
          ],
        },
      },
      {
        kind: 'node',
        id: genLayoutId('ch'),
        node: {
          id: genLayoutId('n'),
          type: 'panel',
          style: { fillColor: '#eee' },
          children: [[{ id: genLayoutId('n'), type: 'text', text: 'inside' }]],
        },
      },
      { kind: 'node', id: genLayoutId('ch'), node: { id: genLayoutId('n'), type: 'divider', style: { heightPt: 2, fillColor: '#333' } } },
    );
    const resolved = resolveCustomLayout(t, inputs());
    expect(resolved.blocks[0]).toMatchObject({ kind: 'columns', count: 2 });
    expect(resolved.blocks[1]).toMatchObject({ kind: 'panel', fillColor: '#eee' });
    expect(resolved.blocks[2]).toMatchObject({ kind: 'divider', heightPt: 2, fillColor: '#333' });
  });

  it('empty panels with a height become filled boxes; without height they vanish', () => {
    const t = createEmptyTemplate('T');
    const s = t.sections[0];
    s.children.push(
      { kind: 'node', id: genLayoutId('ch'), node: { id: genLayoutId('n'), type: 'panel', style: { heightPt: 12, fillColor: '#ccc' }, children: [[]] } },
      { kind: 'node', id: genLayoutId('ch'), node: { id: genLayoutId('n'), type: 'panel', style: {}, children: [[]] } },
    );
    const resolved = resolveCustomLayout(t, inputs());
    expect(resolved.blocks).toHaveLength(1);
    expect(resolved.blocks[0]).toMatchObject({ kind: 'divider', heightPt: 12, fillColor: '#ccc' });
  });

  it('pageBreakBefore on a section starts it on a fresh page (§18)', () => {
    const t = createEmptyTemplate('T');
    t.sections[0].children.push(
      { kind: 'node', id: genLayoutId('ch'), node: { id: genLayoutId('n'), type: 'text', text: 'one' } },
    );
    const s2 = createSection('custom', 'Two');
    s2.pageBreakBefore = true;
    s2.children.push({ kind: 'node', id: genLayoutId('ch'), node: { id: genLayoutId('n'), type: 'text', text: 'two' } });
    t.sections.push(s2);
    const resolved = resolveCustomLayout(t, inputs());
    expect(resolved.blocks.map((b) => b.kind)).toEqual(['paragraph', 'pageBreak', 'paragraph']);
  });

  it('file-bound nodes without a file context are skipped instead of failing (§35)', () => {
    const t = createEmptyTemplate('T');
    t.sections[0].children.push(
      { kind: 'node', id: genLayoutId('ch'), node: { id: genLayoutId('n'), type: 'description' } },
      { kind: 'node', id: genLayoutId('ch'), node: { id: genLayoutId('n'), type: 'text', text: 'ok' } },
    );
    const resolved = resolveCustomLayout(t, inputs());
    expect(resolved.blocks).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* §5 — required-field validation (through the layout structure)        */
/* ------------------------------------------------------------------ */

describe('custom layout validation v2 (§5)', () => {
  function v2Template(): CustomLayoutTemplate {
    const t = createEmptyTemplate('T');
    const s = t.sections[0];
    s.fields.push({ id: 'out', label: 'Output', kind: 'textarea', required: true });
    const block = createBlockDef('Code', [{ type: 'code' }], [
      { id: 'shot', label: 'Output Screenshot', kind: 'image', required: true },
    ]);
    s.children.push({ kind: 'block', id: genLayoutId('ch'), block });
    return t;
  }

  function blockOf(t: CustomLayoutTemplate): string {
    for (const child of t.sections[0].children) {
      if (child.kind === 'block') return child.block.id;
    }
    throw new Error('no block child');
  }

  it('flags section fields once and block fields per assigned file (§5)', () => {
    const t = v2Template();
    const blockId = blockOf(t);
    const missing = validateCustomLayout({
      template: t,
      projects: [makeDocProject('p1', 'P', ['f1', 'f2'])],
      fileDetails: {},
      fileFieldValues: { f1: { shot: 'img1' } },
      sectionFieldValues: {},
      fileAssignments: { [blockId]: ['f1', 'f2'] },
    });
    // 1 section missing "Output" + f2 missing "Output Screenshot"
    expect(missing).toHaveLength(2);
    const sectionIssue = missing.find((m) => m.sectionName === 'Task 01');
    expect(sectionIssue).toBeTruthy();
    expect(sectionIssue!.fields).toEqual(['Output']);
    const fileIssue = missing.find((m) => m.fileId === 'f2');
    expect(fileIssue).toBeTruthy();
    expect(fileIssue!.instance).toBe('f2.kt');
    expect(fileIssue!.blockName).toBe('Code');
    expect(fileIssue!.fields).toEqual(['Output Screenshot']);
  });

  it('passes when every required value is filled', () => {
    const t = v2Template();
    const blockId = blockOf(t);
    const missing = validateCustomLayout({
      template: t,
      projects: [makeDocProject('p1', 'P', ['f1'])],
      fileDetails: {},
      fileFieldValues: { f1: { shot: 'img1' } },
      sectionFieldValues: { [t.sections[0].id]: { out: 'works' } },
      fileAssignments: { [blockId]: ['f1'] },
    });
    expect(missing).toHaveLength(0);
  });

  it('identifies the exact section/block/file causing the failure (§5/§27)', () => {
    const t = v2Template();
    const blockId = blockOf(t);
    const missing = validateCustomLayout({
      template: t,
      projects: [makeDocProject('p1', 'P', ['f1'])],
      fileDetails: {},
      fileFieldValues: {},
      sectionFieldValues: {},
      fileAssignments: { [blockId]: ['f1'] },
    });
    const formatted = formatMissingRequirements(missing);
    expect(formatted).toContain('Section "Task 01" is missing: • Output');
    expect(formatted).toContain('f1.kt (block: Code) is missing: • Output Screenshot');
  });

  it('unassigned files are reported as a NON-blocking warning (§3)', () => {
    const t = v2Template();
    const blockId = blockOf(t);
    const unassigned = unassignedFileIds({
      template: t,
      projects: [makeDocProject('p1', 'P', ['f1', 'f2'])],
      fileDetails: {},
      fileFieldValues: {},
      sectionFieldValues: {},
      fileAssignments: { [blockId]: ['f1'] },
    });
    expect(unassigned).toEqual(['f2']);
  });

  it('does not validate files that are not selected', () => {
    const t = v2Template();
    const blockId = blockOf(t);
    const missing = validateCustomLayout({
      template: t,
      projects: [makeDocProject('p1', 'P', [])], // f1 not selected
      fileDetails: {},
      fileFieldValues: {},
      // section values are filled so ONLY the (skipped) file issue could flag
      sectionFieldValues: { [t.sections[0].id]: { out: 'works' } },
      fileAssignments: { [blockId]: ['f1'] },
    });
    expect(missing).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* §30 — template persistence (v2 storage + migration)                  */
/* ------------------------------------------------------------------ */

describe('custom layout persistence (§30)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('stores, updates, duplicates and deletes templates', () => {
    const t = createEmptyTemplate('A');
    expect(storeCustomLayout(t)).toHaveLength(1);
    const renamed = { ...cloneTemplate(t), name: 'B' };
    expect(updateCustomLayout(renamed).map((x) => x.name)).toEqual(['B']);

    const { templates, copy } = duplicateCustomLayout(renamed);
    expect(templates).toHaveLength(2);
    expect(copy.id).not.toBe(t.id);
    expect(copy.name).toBe('B copy');

    expect(deleteCustomLayout(t.id)).toHaveLength(1);
  });

  it('round-trips through versioned JSON (export/import)', () => {
    const t = createEmptyTemplate('Exportable');
    t.sections[0].fields.push({ id: 'f1', label: 'Shot', kind: 'image', required: true });
    const json = exportLayoutJson(t);
    const imported = importLayoutJson(json);
    expect(imported.name).toBe('Exportable');
    expect(imported.version).toBe(2);
    expect(imported.sections[0].fields).toEqual(t.sections[0].fields);
    expect(imported.id).not.toBe(t.id); // fresh id avoids collisions
    expect(loadCustomLayouts()).toHaveLength(1);
  });

  it('migrates a stored v1 template on load (§9/§30)', () => {
    const v1 = {
      id: 'old1',
      name: 'Legacy stored',
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      repeat: 'eachFile',
      fields: [],
      blocks: [{ id: 'b1', type: 'code' }],
    };
    window.localStorage.setItem(
      'codice-custom-layouts-v1',
      JSON.stringify([v1]),
    );
    const loaded = loadCustomLayouts();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].version).toBe(2);
    expect(loaded[0].sections).toHaveLength(1);
    const blockChild = loaded[0].sections[0].children.find(
      (c): c is Extract<SectionChild, { kind: 'block' }> => c.kind === 'block',
    );
    expect(blockChild).toBeTruthy();
    expect(blockChild!.block.nodes.map((n) => n.type)).toEqual(['code']);
  });

  it('rejects invalid import JSON with a clear error', () => {
    expect(() => importLayoutJson('not json')).toThrow();
    expect(() => importLayoutJson('{"foo":1}')).toThrow(/not a Codice/);
  });
});

/* ------------------------------------------------------------------ */
/* §17/§33 — preview bridge (incl. the §13 outline regression)          */
/* ------------------------------------------------------------------ */

describe('custom layout → preview bridge (§17/§33)', () => {
  it('maps project/file references to pagination indexes', () => {
    const projects: PaginationProject[] = [
      {
        label: 'P',
        path: 'P/',
        structure: [],
        outlineProjectId: 'p1',
        files: [
          { name: 'f1.kt', path: 'f1.kt', language: 'kotlin', size: 1, outlineFileId: 'f1' },
        ],
      },
    ];
    const maps = buildLayoutIndexMaps(projects);
    expect(maps.projectIdx.get('p1')).toBe(0);
    expect(maps.fileIdx.get('p1::f1')).toBe(0);
    expect(maps.fileIdx.get('p1::nope')).toBeUndefined();
  });

  it('converts resolved blocks into preview elements with outline anchors', () => {
    const projects: PaginationProject[] = [
      {
        label: 'P',
        path: 'P/',
        structure: [],
        outlineProjectId: 'p1',
        files: [
          { name: 'f1.kt', path: 'f1.kt', language: 'kotlin', size: 1, outlineFileId: 'f1' },
        ],
      },
    ];
    const resolved = {
      templateId: 't',
      templateName: 'T',
      blocks: [
        { kind: 'metadata' },
        { kind: 'toc' },
        { kind: 'projectHeader', projectId: 'p1' },
        { kind: 'fileHeader', projectId: 'p1', fileId: 'f1' },
        { kind: 'code', projectId: 'p1', fileId: 'f1' },
        { kind: 'labeled', label: 'Summary', text: 'S' },
      ] as Parameters<typeof customLayoutToElements>[0]['blocks'],
    };
    const els = customLayoutToElements(resolved, projects);
    expect(els.map((e) => e.type)).toEqual([
      'titlePage',
      'toc',
      'projectHeader',
      'fileHeader',
      'code',
      'fileDetail',
    ]);
    const fileHeader = els.find((e) => e.type === 'fileHeader')!;
    expect((fileHeader as { outlineId?: string }).outlineId).toBe('outline-file-f1');

    const outline = buildLayoutOutline(resolved, projects);
    expect(outline.map((o) => o.kind)).toEqual(['title', 'toc', 'project', 'file']);
  });

  it('§13 REGRESSION — code-only layouts still produce outline entries', () => {
    // A layout that renders only a `code` block (no fileHeader) used to
    // produce ZERO outline entries, which made the Outline pill disappear.
    const projects: PaginationProject[] = [
      {
        label: 'P',
        path: 'P/',
        structure: [],
        outlineProjectId: 'p1',
        files: [
          { name: 'f1.kt', path: 'f1.kt', language: 'kotlin', size: 1, outlineFileId: 'f1' },
          { name: 'f2.kt', path: 'f2.kt', language: 'kotlin', size: 1, outlineFileId: 'f2' },
        ],
      },
    ];
    const resolved = {
      templateId: 't',
      templateName: 'T',
      blocks: [
        { kind: 'code', projectId: 'p1', fileId: 'f1' },
        { kind: 'code', projectId: 'p1', fileId: 'f2' },
      ] as Parameters<typeof customLayoutToElements>[0]['blocks'],
    };
    const outline = buildLayoutOutline(resolved, projects);
    expect(outline.map((o) => o.id)).toEqual(['outline-file-f1', 'outline-file-f2']);

    // code elements carry the navigation anchor for open-in-preview (§15)
    const els = customLayoutToElements(resolved, projects);
    const codes = els.filter((e) => e.type === 'code');
    expect(codes.every((e) => (e as { outlineId?: string }).outlineId === 'outline-file-f1' || (e as { outlineId?: string }).outlineId === 'outline-file-f2')).toBe(true);
  });

  it('dividers map to divider preview elements (§6)', () => {
    const resolved = {
      templateId: 't',
      templateName: 'T',
      blocks: [
        { kind: 'divider', heightPt: 2, fillColor: '#333' },
      ] as unknown as Parameters<typeof customLayoutToElements>[0]['blocks'],
    };
    const els = customLayoutToElements(resolved, []);
    expect(els[0]).toMatchObject({ type: 'divider', heightPx: expect.any(Number), fillColor: '#333' });
  });

  it('drops references outside the preview window without inventing content', () => {
    const projects: PaginationProject[] = [];
    const resolved = {
      templateId: 't',
      templateName: 'T',
      blocks: [
        { kind: 'fileHeader', projectId: 'p1', fileId: 'f1' },
        { kind: 'code', projectId: 'p1', fileId: 'f1' },
      ] as Parameters<typeof customLayoutToElements>[0]['blocks'],
    };
    expect(customLayoutToElements(resolved, projects)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Pagination of the new element types                                 */
/* ------------------------------------------------------------------ */

describe('pagination of new element types (§6/§12/§25/§26/§19)', () => {
  const preset = {
    page: {
      size: 'A4' as const,
      landscape: false,
      marginTopMm: 20,
      marginBottomMm: 20,
      marginLeftMm: 20,
      marginRightMm: 20,
      pageHeaderShow: false,
      pageFooterShow: false,
    },
    typography: {
      bodyFontSizePt: 11,
      lineSpacing: 1.4,
      paragraphSpacingPt: 6,
      bodyWeight: 'normal' as const,
    },
    headings: {
      h1: { sizePt: 18, lineHeight: 1.2, spaceBeforePt: 12, spaceAfterPt: 6 },
      h2: { sizePt: 14, lineHeight: 1.2, spaceBeforePt: 10, spaceAfterPt: 4 },
      h3: { sizePt: 12, lineHeight: 1.2, spaceBeforePt: 8, spaceAfterPt: 4 },
      h4: { sizePt: 11, lineHeight: 1.2, spaceBeforePt: 8, spaceAfterPt: 4 },
    },
    code: { fontSizePt: 9, lineHeight: 1.35, paddingPt: 6, wrapLongLines: false },
    fileHeaders: {},
  } as unknown as ConstructorParameters<typeof Object>[0];

  const projects: PaginationProject[] = [
    {
      label: 'P',
      path: 'P/',
      structure: [],
      files: [
        {
          name: 'f1.kt',
          path: 'f1.kt',
          language: 'kotlin',
          size: 1,
          outlineFileId: 'f1',
        },
      ],
    },
  ];

  const accessors = {
    getLineCount: () => 3,
    getLineText: (_f: unknown, i: number) => `line ${i}`,
  };

  function paginate(elements: Parameters<typeof paginateDocument>[0]) {
    return paginateDocument(elements, preset as any, projects, accessors as any);
  }

  it('pageBreak elements actually split pages (§19)', () => {
    const pages = paginate([
      { type: 'paragraph', text: 'before' },
      { type: 'pageBreak' },
      { type: 'paragraph', text: 'after' },
    ]);
    expect(pages).toHaveLength(2);
  });

  it('fileDetail elements carry labels and paginate like paragraphs (§6)', () => {
    const pages = paginate([
      { type: 'fileDetail', label: 'Description', text: 'x'.repeat(200) },
    ]);
    expect(pages).toHaveLength(1);
    expect(pages[0].elements[0]).toMatchObject({ type: 'fileDetail', label: 'Description' });
  });

  it('standalone images paginate with captions (§12)', () => {
    const img: DocumentImage = {
      id: 'i1',
      name: 'shot.png',
      dataUrl: TINY_PNG,
      mime: 'image/png',
      width: 400,
      height: 300,
      caption: 'Figure 1',
    };
    const pages = paginate([{ type: 'image', image: img }]);
    expect(pages).toHaveLength(1);
    expect(pages[0].elements[0]).toMatchObject({ type: 'image', image: img });
  });

  it('panels and columns measure as containers (§25/§26)', () => {
    const pages = paginate([
      {
        type: 'panel',
        fillColor: '#eee',
        paddingPt: 8,
        children: [{ type: 'paragraph', text: 'in panel' }],
      },
      {
        type: 'columns',
        count: 2,
        columns: [
          [{ type: 'paragraph', text: 'left' }],
          [{ type: 'paragraph', text: 'right' }],
        ],
      },
    ]);
    expect(pages).toHaveLength(1);
    expect(pages[0].elements[0].type).toBe('panel');
    expect(pages[0].elements[1].type).toBe('columns');
  });

  it('buildDocumentElements emits description BEFORE code and summary/note AFTER (§6)', () => {
    const withDetails: PaginationProject[] = [
      {
        label: 'P',
        path: 'P/',
        structure: [],
        files: [
          {
            name: 'f1.kt',
            path: 'f1.kt',
            language: 'kotlin',
            size: 1,
            outlineFileId: 'f1',
            details: { description: 'D', summary: 'S', note: 'N' },
            images: [
              {
                id: 'i1',
                name: 'a.png',
                dataUrl: TINY_PNG,
                mime: 'image/png',
                width: 10,
                height: 10,
              },
            ],
          },
        ],
      },
    ];
    const els = buildDocumentElements(
      // minimal preset slice used by the builder
      {
        titlePage: { enabled: false },
        misc: { includeToc: false, numberHeadings: false },
        projectStructure: { enabled: false },
        pageBreaks: { beforeProject: false, beforeFile: false, beforeH1: false },
        headings: {
          h1: { numbered: false },
          h2: { numbered: false },
        },
      } as unknown as Parameters<typeof buildDocumentElements>[0],
      withDetails,
    );
    const types = els.map((e) => e.type);
    const descIdx = types.indexOf('fileDetail');
    const codeIdx = types.indexOf('code');
    const imgIdx = types.indexOf('image');
    const summaryIdx = types.lastIndexOf('fileDetail');
    expect(descIdx).toBeGreaterThan(-1);
    expect(descIdx).toBeLessThan(codeIdx);
    expect(imgIdx).toBe(codeIdx + 1); // image right after code
    expect(summaryIdx).toBeGreaterThan(codeIdx);
    // label order: description … summary … note
    const labels = els
      .filter((e) => e.type === 'fileDetail')
      .map((e) => (e as { label: string }).label);
    expect(labels).toEqual(['Description', 'Summary', 'Note']);
  });
});

/* ------------------------------------------------------------------ */
/* §4 — standalone files                                               */
/* ------------------------------------------------------------------ */

describe('standalone file discovery (§4)', () => {
  it('creates first-class project entries with the fixed standalone id', async () => {
    const files = [
      new File(['hello'], 'notes.txt', { type: 'text/plain' }),
      new File(['# md'], 'readme.md', { type: 'text/markdown' }),
    ];
    const { files: discovered, project } = await discoverStandaloneFiles(files, BASE_FILTER);
    expect(project.id).toBe('codice-standalone');
    expect(project.label).toBe('Standalone files');
    expect(discovered.map((f) => f.name)).toEqual(['notes.txt', 'readme.md']);
    expect(discovered.every((f) => f.projectId === 'codice-standalone')).toBe(true);
  });

  it('skips binary and oversized files with warnings, and errors when nothing readable remains', async () => {
    await expect(
      discoverStandaloneFiles([new File(['x'], 'photo.png', { type: 'image/png' })], BASE_FILTER),
    ).rejects.toThrow(/No readable standalone files/);

    const { project } = await discoverStandaloneFiles(
      [
        new File(['x'], 'photo.png', { type: 'image/png' }),
        new File(['text'], 'ok.txt', { type: 'text/plain' }),
      ],
      BASE_FILTER,
    );
    expect(project.warnings.some((w) => /binary/.test(w.message))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* §10-§12 — image helpers                                             */
/* ------------------------------------------------------------------ */

describe('image helpers (§10-§12)', () => {
  it('aspect-fits images into the export box without upscaling', () => {
    expect(fitImageBox(800, 600, 400, 400)).toEqual({ w: 400, h: 300 });
    expect(fitImageBox(100, 50, 400, 400)).toEqual({ w: 100, h: 50 });
    expect(fitImageBox(0, 0, 400, 400)).toEqual({ w: 400, h: 400 });
  });

  it('decodes data URLs to real bytes (export embedding, §12)', () => {
    const bytes = dataUrlToBytes(TINY_PNG);
    expect(bytes[0]).toBe(0x89); // PNG magic
    expect(bytes.length).toBeGreaterThan(50);
  });
});
