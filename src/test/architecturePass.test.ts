/**
 * Architecture correctness pass — the File → Section → Block → Field
 * hierarchy, synchronization guarantees, and the regression fixes from the
 * architecture-correctness spec:
 *
 *   §3  Sections must never divide between separate exports (fallback
 *       heading keeps every section structurally present).
 *   §4  Image-kind fields must never render as raw text.
 *   §5/§6  Section fields are derived from Section Content order.
 *   §7  File-level standalone content.
 *   §9  Section types append exactly once per explicit action.
 *   §12 Duplicate relative paths survive a merge (no silent file loss).
 *   §16/§17 Outline = filename labels + document structure headings.
 *   §25 Panel colors with stable node identity.
 *   §26 Stable ids everywhere.
 */
import { describe, it, expect } from 'vitest';
import {
  appendSectionPreset,
  createBlockDef,
  duplicateBlockDef,
  duplicateSection,
  createEmptyTemplate,
  createSection,
  cloneTemplate,
  nodeFieldIds,
  normalizeTemplate,
  sectionFieldIdsInContentOrder,
  sectionFieldsInContentOrder,
  templateSections,
  type CustomLayoutTemplate,
  type RootChild,
  type TemplateNode,
  type TemplateSection,
} from '@/lib/customLayouts/model';
import { resolveCustomLayout, type ResolutionInputs } from '@/lib/customLayouts/resolver';
import { buildLayoutOutline, customLayoutToElements } from '@/lib/customLayouts/previewElements';
import type { PaginationProject } from '@/lib/preview/documentPagination';
import { duplicateFilenames, outlineFileLabel } from '@/lib/documentOutline';
import { buildTree } from '@/components/FileTree/FileTree';
import { getGuideSections, getShortcuts } from '@/components/common/HelpDialog';
import type { DiscoveredFile, DocumentProject, ImageAsset } from '@/types';

/* ------------------------------------------------------------------ */
/* Fixtures (v3 model: rootChildren + derived fields, no wrapper ids)  */
/* ------------------------------------------------------------------ */

function proj(id: string, label: string, files: Array<{ id: string; path: string }>): DocumentProject {
  return {
    id,
    label,
    folderName: label,
    structurePaths: files.map((f) => f.path),
    files: files.map((f) => ({
      projectId: id,
      projectLabel: label,
      relativePath: f.path,
      language: 'java',
      highlighted: { fileId: f.id, relativePath: f.path, language: 'java', lines: [] },
      sizeBytes: 10,
    })),
  };
}

const P1 = proj('p1', 'P1', [{ id: 'f1', path: 'src/App.java' }]);
const P2 = proj('p2', 'P2', [{ id: 'f2', path: 'src/Main.java' }]);

function twoSectionTemplate(): CustomLayoutTemplate {
  const b1 = createBlockDef('B1', [
    { type: 'heading', text: '{fileName}', style: { level: 2 } },
    { type: 'code' },
  ]);
  const b2 = createBlockDef('B2', [
    { type: 'heading', text: '{fileName}', style: { level: 2 } },
    { type: 'code' },
  ]);
  const s1 = createSection('custom', 'Section 1');
  s1.children = [
    { kind: 'node', node: { id: 'n-h1', type: 'heading', text: 'Section 1 H', style: { level: 1 } } },
    { kind: 'block', block: b1 },
  ];
  // Section 2 has ONLY a block — when its block has no files in the current
  // document, the §3 fallback heading is the section's only presence.
  const s2 = createSection('custom', 'Section 2');
  s2.pageBreakBefore = true;
  s2.children = [{ kind: 'block', block: b2 }];
  return {
    id: 'tpl',
    name: 'T',
    version: 3,
    createdAt: 0,
    updatedAt: 0,
    rootChildren: [
      { kind: 'section', section: s1 },
      { kind: 'section', section: s2 },
    ],
    fields: [],
  };
}

function blockOf(tpl: CustomLayoutTemplate, sectionIdx: number) {
  const child = templateSections(tpl)[sectionIdx].children.find((c) => c.kind === 'block');
  if (!child || child.kind !== 'block') throw new Error('no block');
  return child.block;
}

function inputsFor(projects: DocumentProject[]): ResolutionInputs {
  return {
    projects,
    fileDetails: {},
    fileFieldValues: {},
    sectionFieldValues: {},
    documentFieldValues: {},
    fileOrder: { p1: ['f1'], p2: ['f2'] },
    assignments: {},
    imageAssets: {},
    metadata: {},
    fileCount: projects.reduce((a, p) => a + p.files.length, 0),
  };
}

const headingTexts = (blocks: Array<{ kind: string; text?: string }>) =>
  blocks.filter((b) => b.kind === 'heading').map((b) => b.text);

/* ------------------------------------------------------------------ */
/* §3 — sections never divide between exports                          */
/* ------------------------------------------------------------------ */

describe('§3 section isolation across export documents', () => {
  it('each separate project document contains BOTH sections (combined + separate)', () => {
    const tpl = twoSectionTemplate();
    const assignments = {
      [blockOf(tpl, 0).id]: ['f1'],
      [blockOf(tpl, 1).id]: ['f2'],
    };

    const combined = resolveCustomLayout(tpl, { ...inputsFor([P1, P2]), assignments });
    const combinedHeads = headingTexts(combined.blocks);
    expect(combinedHeads).toContain('Section 1 H');
    // Section 2's block pattern renders its file heading {fileName}.
    expect(combinedHeads).toContain('Main.java');
    expect(combinedHeads).not.toContain('Section 2'); // no fallback needed

    // Separate per project: every document still carries the FULL skeleton.
    const r1 = resolveCustomLayout(tpl, { ...inputsFor([P1]), assignments });
    const heads1 = headingTexts(r1.blocks);
    expect(heads1).toContain('Section 1 H');
    expect(heads1).toContain('App.java'); // P1's file in section 1's block
    // Section 2 has no P1 files → its structural fallback heading (the
    // section's own name) keeps it present in P1's document.
    expect(heads1).toContain('Section 2');

    const r2 = resolveCustomLayout(tpl, { ...inputsFor([P2]), assignments });
    const heads2 = headingTexts(r2.blocks);
    expect(heads2).toContain('Main.java'); // P2's file in section 2's block
    // Section 1 has a literal heading in P2's document too — structure kept.
    expect(heads2).toContain('Section 1 H');
  });

  it('the fallback heading is stable and outline-addressable (nodeId from section id)', () => {
    const tpl = twoSectionTemplate();
    const r = resolveCustomLayout(tpl, { ...inputsFor([P1]), assignments: {} });
    const fallback = r.blocks.find((b) => b.kind === 'heading' && b.text === 'Section 2');
    expect(fallback).toBeDefined();
    expect((fallback as { nodeId?: string }).nodeId).toBe(`sec-${templateSections(tpl)[1].id}`);
  });

  it('a section with content never gets a fallback heading', () => {
    const tpl = twoSectionTemplate();
    const r = resolveCustomLayout(tpl, {
      ...inputsFor([P1, P2]),
      assignments: { [blockOf(tpl, 1).id]: ['f2'] },
    });
    const heads = headingTexts(r.blocks);
    // Section 2's block renders f2 → real content, no 'Section 2' fallback.
    expect(heads).toContain('Main.java');
    expect(heads.filter((t) => t === 'Section 2')).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* §4 — image-kind fields never render as text                         */
/* ------------------------------------------------------------------ */

describe('§4 image-field rendering guard', () => {
  const asset: ImageAsset = {
    id: 'img-ix0ct3uphyw',
    name: 'shot.png',
    mime: 'image/png',
    dataUrl: 'data:image/png;base64,x',
    width: 10,
    height: 10,
    caption: '',
    sizeBytes: 100,
    addedAt: 0,
  };

  function imageFieldTemplate() {
    const tpl = twoSectionTemplate();
    const s1 = templateSections(tpl)[0];
    s1.fields = [{ id: 'f-shot', label: 'Output', kind: 'image', required: false }];
    s1.children = [
      { kind: 'node', node: { id: 'n-img', type: 'image', fieldId: 'f-shot' } },
      { kind: 'node', node: { id: 'n-txt', type: 'text', fieldId: 'f-shot', style: { label: true } } },
      { kind: 'node', node: { id: 'n-h', type: 'heading', fieldId: 'f-shot', text: '' } },
    ];
    return tpl;
  }

  it('the image renders as an image node — never as "OUTPUT img-…" text', () => {
    const tpl = imageFieldTemplate();
    const r = resolveCustomLayout(tpl, {
      ...inputsFor([P1]),
      sectionFieldValues: { [templateSections(tpl)[0].id]: { 'f-shot': 'img-ix0ct3uphyw' } },
      imageAssets: { 'img-ix0ct3uphyw': asset },
    });
    expect(r.blocks.some((b) => b.kind === 'image')).toBe(true);
    expect(r.blocks.some((b) => b.kind === 'labeled' || b.kind === 'paragraph')).toBe(false);
    const img = r.blocks.find((b) => b.kind === 'image') as { imageId: string };
    expect(img.imageId).toBe('img-ix0ct3uphyw');
  });

  it('an unknown/missing asset renders nothing visual — never the raw id', () => {
    const tpl = imageFieldTemplate();
    const r = resolveCustomLayout(tpl, {
      ...inputsFor([P1]),
      sectionFieldValues: { [templateSections(tpl)[0].id]: { 'f-shot': 'img-missing' } },
    });
    // No image block, no text-ish block carrying the raw id — the section
    // only keeps its §3 structural fallback heading.
    expect(r.blocks.some((b) => b.kind === 'image' || b.kind === 'labeled' || b.kind === 'paragraph')).toBe(false);
    expect(JSON.stringify(r.blocks)).not.toContain('img-missing');
  });
});

/* ------------------------------------------------------------------ */
/* §5/§6 — section fields derive from section content                  */
/* ------------------------------------------------------------------ */

describe('§5/§6 section field synchronization', () => {
  function makeSection(): TemplateSection {
    const s = createSection('custom', 'S');
    s.fields = [
      { id: 'fld-a', label: 'Alpha', kind: 'text', required: false },
      { id: 'fld-b', label: 'Beta', kind: 'textarea', required: true },
      { id: 'fld-orphan', label: 'Orphan', kind: 'text', required: false },
    ];
    s.children = [
      { kind: 'node', node: { id: 'n1', type: 'text', fieldId: 'fld-b' } },
      { kind: 'node', node: { id: 'n2', type: 'heading', fieldId: 'fld-a', text: '' } },
      { kind: 'node', node: { id: 'n3', type: 'text', text: 'literal' } },
    ];
    return s;
  }

  it('content order controls the field order (§6)', () => {
    const s = makeSection();
    expect(sectionFieldIdsInContentOrder(s)).toEqual(['fld-b', 'fld-a']);
    const derived = sectionFieldsInContentOrder(s);
    expect(derived.map((f) => f.id)).toEqual(['fld-b', 'fld-a']);
    expect(derived[0].required).toBe(true);
  });

  it('normalizeTemplate drops orphan fields and keeps definitions in sync (§5)', () => {
    const tpl = createEmptyTemplate('T');
    const rootChild = tpl.rootChildren[0];
    if (rootChild.kind !== 'section') throw new Error('expected a section');
    rootChild.section = makeSection();
    const normalized = normalizeTemplate(tpl);
    expect(templateSections(normalized)[0].fields.map((f) => f.id)).toEqual(['fld-b', 'fld-a']);
  });

  it('deleting a field strips bindings inside containers, top-level bound nodes get filtered (strip helper)', async () => {
    const { stripFieldBindings } = await import('@/components/CustomLayout/SectionContentEditor');
    // Mirrors the SectionEditor's onDeleteField usage: top-level bound nodes
    // are filtered; nested bindings (panel children) are stripped in place.
    const panelNode: TemplateNode = {
      id: 'n-panel',
      type: 'panel',
      children: [[{ id: 'n-in', type: 'text', fieldId: 'fld-b' }]],
    };
    stripFieldBindings(panelNode, 'fld-b');
    expect(nodeFieldIds(panelNode)).not.toContain('fld-b');
    expect(panelNode.children?.[0]).toHaveLength(0);
  });

  it('panel children with field bindings count as section fields', () => {
    const s = createSection('custom', 'S');
    s.fields = [{ id: 'fld-p', label: 'Panel text', kind: 'text', required: false }];
    s.children = [
      {
        kind: 'node',
        node: {
          id: 'np',
          type: 'panel',
          children: [[{ id: 'n-in', type: 'text', fieldId: 'fld-p' }]],
        },
      },
    ];
    expect(sectionFieldIdsInContentOrder(s)).toEqual(['fld-p']);
  });
});

/* ------------------------------------------------------------------ */
/* §7 — file-level standalone content                                  */
/* ------------------------------------------------------------------ */

describe('§7 file-level standalone content', () => {
  it('resolves BEFORE the sections and appears in every document', () => {
    const tpl = twoSectionTemplate();
    // v3 — file-level standalone nodes are leading entries of the ONE
    // ordered rootChildren container, so they resolve before the sections.
    const fileNodes: RootChild[] = [
      { kind: 'node', node: { id: 'fn1', type: 'heading', text: 'Document Title', style: { level: 1 } } },
      { kind: 'node', node: { id: 'fn2', type: 'text', text: 'Closing summary' } },
    ];
    tpl.rootChildren = [...fileNodes, ...tpl.rootChildren];
    for (const projects of [[P1, P2], [P1], [P2]]) {
      const r = resolveCustomLayout(tpl, { ...inputsFor(projects), assignments: {} });
      expect(headingTexts(r.blocks)[0]).toBe('Document Title');
      expect(r.blocks[1]).toMatchObject({ kind: 'paragraph', text: 'Closing summary' });
    }
  });

  it('normalizeTemplate guarantees the rootChildren array (migration safety)', () => {
    const tpl = twoSectionTemplate();
    // A hand-edited/corrupted template without the canonical root container.
    delete (tpl as { rootChildren?: RootChild[] }).rootChildren;
    const normalized = normalizeTemplate(tpl);
    expect(normalized.rootChildren).toEqual([]);
    expect(normalized.fields).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* §9 — section types append exactly once per action                   */
/* ------------------------------------------------------------------ */

describe('§9 section type seeding', () => {
  it('appending the same preset twice creates two explicit copies — never phantom merges', () => {
    const s = createSection('custom', 'S');
    expect(s.fields).toHaveLength(0);
    appendSectionPreset(s, 'task');
    const afterOnce = cloneTemplate(s);
    appendSectionPreset(s, 'task');
    // Each explicit action adds exactly one structure (+2 fields each).
    expect(afterOnce.fields).toHaveLength(2);
    expect(s.fields).toHaveLength(4);
    expect(s.children).toHaveLength(4); // heading+text, heading+text
  });

  it('appendSectionPreset updates the section type marker', () => {
    const s = createSection('custom', 'S');
    appendSectionPreset(s, 'codeOutput');
    expect(s.type).toBe('codeOutput');
  });
});

/* ------------------------------------------------------------------ */
/* §12 — duplicate paths in a merged project                           */
/* ------------------------------------------------------------------ */

describe('§12 merged duplicate paths stay independent', () => {
  it('both same-path files render as separate block instances', () => {
    const merged = proj('merged', 'M', [
      { id: 'fa', path: 'src/app/main/org/example/Foo.kt' },
      { id: 'fb', path: 'src/app/main/org/example/Foo.kt' },
    ]);
    const tpl = twoSectionTemplate();
    const r = resolveCustomLayout(tpl, {
      ...inputsFor([merged]),
      assignments: { [blockOf(tpl, 0).id]: ['fa', 'fb'] },
    });
    const codes = r.blocks.filter((b) => b.kind === 'code');
    expect(codes).toHaveLength(2);
    expect(new Set(codes.map((b) => (b as { fileId: string }).fileId))).toEqual(
      new Set(['fa', 'fb']),
    );
  });

  it('buildTree keeps both same-path files as separate rows (no tree loss)', () => {
    const mk = (id: string, path: string): DiscoveredFile => ({
      id,
      projectId: 'merged',
      name: path.split('/').pop() ?? path,
      relativePath: path,
      directory: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
      size: 10,
      language: 'kotlin',
      isConfig: false,
      binary: false,
      excluded: false,
    });
    const tree = buildTree([mk('fa', 'src/app/main/org/example/Foo.kt'), mk('fb', 'src/app/main/org/example/Foo.kt')]);
    const src = tree.children.get('src');
    const app = src?.children.get('app');
    const main = app?.children.get('main');
    const org = main?.children.get('org');
    const example = org?.children.get('example');
    const leaf = example?.children.get('Foo.kt');
    expect(leaf).toBeDefined();
    expect(leaf!.files.map((f) => f.id)).toEqual(['fa', 'fb']);
  });
});

/* ------------------------------------------------------------------ */
/* §16/§17 — outline structure + filename labels                       */
/* ------------------------------------------------------------------ */

function paginationProjectsOf(projects: DocumentProject[]): PaginationProject[] {
  return projects.map((p) => ({
    label: p.label,
    path: `${p.label}/`,
    structure: p.structurePaths,
    outlineProjectId: p.id,
    files: p.files.map((f) => ({
      name: f.relativePath.split('/').pop() ?? f.relativePath,
      path: f.relativePath,
      language: 'java',
      size: f.sizeBytes,
      outlineFileId: f.highlighted.fileId,
    })),
  }));
}

describe('§16/§17 outline from the resolved document', () => {
  it('emits heading entries with stable anchors + file entries', () => {
    const tpl = twoSectionTemplate();
    const r = resolveCustomLayout(tpl, {
      ...inputsFor([P1, P2]),
      assignments: {
        [blockOf(tpl, 0).id]: ['f1'],
        [blockOf(tpl, 1).id]: ['f2'],
      },
    });
    const projects = paginationProjectsOf([P1, P2]);
    const outline = buildLayoutOutline(r, projects);
    const kinds = outline.map((e) => e.kind);
    expect(kinds).toContain('heading');
    const headingEntry = outline.find((e) => e.kind === 'heading' && e.label === 'Section 1 H');
    expect(headingEntry?.id).toBe('outline-h-n-h1');
    // The combined resolution has content in both sections → no fallbacks.
    expect(outline.some((e) => e.label === 'Section 1' || e.label === 'Section 2')).toBe(false);
    const fileEntry = outline.find((e) => e.kind === 'file');
    expect(fileEntry?.id).toBe('outline-file-f1');
  });

  it('preview elements carry the matching heading anchors', () => {
    const tpl = twoSectionTemplate();
    const r = resolveCustomLayout(tpl, {
      ...inputsFor([P1, P2]),
      assignments: {},
    });
    const elements = customLayoutToElements(r, paginationProjectsOf([P1, P2]));
    const headings = elements.filter((e) => e.type === 'heading') as Array<{
      text: string;
      outlineId?: string;
    }>;
    expect(headings.find((h) => h.text === 'Section 1 H')?.outlineId).toBe('outline-h-n-h1');
  });

  it('block headings repeated per file get UNIQUE outline anchors (no duplicate keys)', () => {
    const tpl = twoSectionTemplate();
    const b1 = blockOf(tpl, 0);
    const b2 = blockOf(tpl, 1);
    const r = resolveCustomLayout(tpl, {
      ...inputsFor([P1, P2]),
      assignments: { [b1.id]: ['f1'], [b2.id]: ['f2'] },
    });
    const elements = customLayoutToElements(r, paginationProjectsOf([P1, P2]));
    const outlineIds = elements
      .filter((e) => e.type === 'heading')
      .map((e) => (e as { outlineId?: string }).outlineId)
      .filter((id): id is string => Boolean(id));
    expect(new Set(outlineIds).size).toBe(outlineIds.length);
    // The outline panel never receives two entries with the same id.
    const outline = buildLayoutOutline(r, paginationProjectsOf([P1, P2]));
    const ids = outline.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('unique filenames show the name; duplicates show paths; tooltip always has the path (§16)', () => {
    expect(duplicateFilenames(['src/a/Main.java', 'src/b/Main.java', 'src/Other.java'])).toEqual(
      new Set(['Main.java']),
    );
    const dup = new Set(['Main.java']);
    expect(outlineFileLabel('src/a/Main.java', dup)).toEqual({
      label: 'Main.java',
      showPath: true,
    });
    expect(outlineFileLabel('src/Other.java', dup).showPath).toBe(false);

    // Layout outline: _qa_a/README.md + _qa_b/README.md are duplicates.
    const tpl = twoSectionTemplate();
    const pA = proj('pa', 'A', [{ id: 'r1', path: 'README.md' }]);
    const pB = proj('pb', 'B', [{ id: 'r2', path: 'README.md' }, { id: 'u1', path: 'src/Util.java' }]);
    const r = resolveCustomLayout(tpl, {
      ...inputsFor([pA, pB]),
      assignments: { [blockOf(tpl, 0).id]: ['r1', 'r2', 'u1'] },
    });
    const outline = buildLayoutOutline(r, paginationProjectsOf([pA, pB]));
    const files = outline.filter((e) => e.kind === 'file');
    const readmeA = files.find((f) => f.fileId === 'r1');
    const util = files.find((f) => f.fileId === 'u1');
    // Both README.md share the name → the (root) path is shown; the tooltip
    // always disambiguates by project.
    expect(readmeA?.tooltip).toBe('A/README.md');
    expect(util?.tooltip).toBe('B/src/Util.java');
    expect(util?.label).toBe('Util.java');
  });
});

/* ------------------------------------------------------------------ */
/* §25 — panel identity + text color propagation                       */
/* ------------------------------------------------------------------ */

describe('§25 panel styling with stable node identity', () => {
  it('resolved panels carry their node id and propagate textColor to children', () => {
    const tpl = twoSectionTemplate();
    templateSections(tpl)[0].children = [
      {
        kind: 'node',
        node: {
          id: 'n-panel',
          type: 'panel',
          style: { fillColor: '#eef', borderColor: '#333', textColor: '#123456' },
          children: [[
            { id: 'n-in1', type: 'text', text: 'inside panel' },
            { id: 'n-in2', type: 'text', text: 'own color', style: { color: '#abcdef' } },
          ]],
        },
      },
    ];
    const r = resolveCustomLayout(tpl, { ...inputsFor([P1]), assignments: {} });
    const panel = r.blocks.find((b) => b.kind === 'panel') as {
      nodeId?: string;
      textColor?: string;
      fillColor?: string;
      children: Array<{ kind: string; color?: string }>;
    };
    expect(panel.nodeId).toBe('n-panel');
    expect(panel.fillColor).toBe('#eef');
    expect(panel.textColor).toBe('#123456');
    // Children without their own color inherit the panel's; styled children win.
    expect(panel.children[0]).toMatchObject({ color: '#123456' });
    expect(panel.children[1]).toMatchObject({ color: '#abcdef' });
  });

  it('two panels with identical content have DIFFERENT node ids (§25/§26)', () => {
    const tpl = twoSectionTemplate();
    templateSections(tpl)[0].children = [
      { kind: 'node', node: { id: 'n-pa', type: 'panel', children: [[{ id: 'n-pa-in', type: 'text', text: 'Output' }]] } },
      { kind: 'node', node: { id: 'n-pb', type: 'panel', children: [[{ id: 'n-pb-in', type: 'text', text: 'Output' }]] } },
    ];
    const r = resolveCustomLayout(tpl, { ...inputsFor([P1]), assignments: {} });
    const panels = r.blocks.filter((b) => b.kind === 'panel') as Array<{ nodeId?: string }>;
    expect(panels).toHaveLength(2);
    expect(panels[0].nodeId).not.toBe(panels[1].nodeId);
  });
});

/* ------------------------------------------------------------------ */
/* §26 — stable ids                                                    */
/* ------------------------------------------------------------------ */

describe('§26 stable identity', () => {
  it('normalizeTemplate fills missing ids on children AND nodes (incl. containers)', () => {
    const tpl = createEmptyTemplate('T');
    const section = templateSections(tpl)[0];
    section.children = [
      {
        kind: 'node',
        node: {
          id: '',
          type: 'columns',
          style: { columns: 2 },
          children: [[{ id: '', type: 'text', text: 'x' }], []],
        },
      },
      // Block children are section children too — their node ids are filled.
      { kind: 'block', block: { id: 'blk-fix', name: 'B', fields: [], nodes: [{ id: '', type: 'code' }] } },
    ];
    const normalized = normalizeTemplate(tpl);
    const children = templateSections(normalized)[0].children;
    // Identity is the node id (v3 removed wrapper ids) — always filled.
    const nodeChild = children[0].kind === 'node' ? children[0].node : null;
    expect(nodeChild?.id).toBeTruthy();
    expect(nodeChild?.children?.[0][0].id).toBeTruthy();
    const blockChild = children[1].kind === 'block' ? children[1].block : null;
    expect(blockChild?.nodes[0].id).toBeTruthy();
  });

  it('clones never share references', () => {
    const tpl = createEmptyTemplate('T');
    const copy = cloneTemplate(tpl);
    templateSections(copy)[0].name = 'changed';
    expect(templateSections(tpl)[0].name).not.toBe('changed');
  });
});

/* ------------------------------------------------------------------ */
/* §23 — help guide coverage                                           */
/* ------------------------------------------------------------------ */

describe('§23 help guide documents the real system', () => {
  const guide = getGuideSections();

  it('explains hierarchy, binding, and the key terminology', () => {
    const ids = guide.map((g) => g.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'model',
        'binding',
        'section-types',
        'file-assignment',
        'images',
        'exports',
        'covers',
        'projects',
        'pages',
        'styling',
        'formats',
      ]),
    );
    // Key terminology — the model section defines the real v3 hierarchy.
    const model = guide.find((g) => g.id === 'model');
    const terms = (model?.terms ?? []).map((t) => t.term);
    expect(terms).toEqual(expect.arrayContaining(['File', 'Section', 'Block', 'Node / Field']));
  });

  it('the binding section explains static vs bound values with token examples', () => {
    const binding = guide.find((g) => g.id === 'binding');
    const text = (binding?.paragraphs ?? []).join(' ');
    expect(text).toContain('{fileName}');
    expect(text).toContain('bound');
  });

  it('shortcuts catalogue stays available alongside the guide', () => {
    const shortcuts = getShortcuts(false);
    expect(shortcuts.length).toBeGreaterThanOrEqual(7);
    expect(shortcuts.find((s) => s.keys.includes('Esc'))).toBeDefined();
  });

  it('R12 — common workflows section covers the required recipe list', () => {
    const workflows = guide.find((g) => g.id === 'workflows');
    expect(workflows).toBeDefined();
    const terms = (workflows?.terms ?? []).map((t) => t.term).join(' | ');
    const text = (workflows?.terms ?? []).map((t) => `${t.term} ${t.text}`).join(' ');
    // The required workflow topics (64A.16), each covering its keyword:
    expect(text).toMatch(/per file|per-file/i); // repeat-per-file
    expect(text).toMatch(/OUTSIDE any section/); // outside-section nodes
    expect(text).toMatch(/Export groups/); // different exports
    expect(text).toMatch(/layout PER export|per-export/i); // per-export layouts
    expect(text).toMatch(/shared layout/i); // shared layout
    expect(text).toMatch(/Appearance-only/); // appearance-only changes
    expect(text).toMatch(/custom cover page/i); // custom cover
    expect(text).toMatch(/fields instead of static text/); // binding
    expect(terms).toContain('Repeating a section per file');
    // The exports section documents the R11/R12 group interactions.
    const exportsGuide = guide.find((g) => g.id === 'exports');
    const exportsText = (exportsGuide?.terms ?? []).map((t) => t.text).join(' ');
    expect(exportsText).toMatch(/pencil button/); // rename
    expect(exportsText).toMatch(/dragging the row handle|press ↑\/↓/); // reorder
    expect(exportsText).toMatch(/drag a project from the sidebar/); // drag-to-assign
    expect(exportsText).toMatch(/\{title\}, \{group\}, \{date\}/); // filename tokens
  });
});

/* ------------------------------------------------------------------ */
/* §39 — duplicate section/block with fresh identity                   */
/* ------------------------------------------------------------------ */

describe('§39 duplication keeps identity fresh', () => {
  it('duplicateSection remaps field ids and block-node ids (bindings stay intact)', () => {
    const tpl = twoSectionTemplate();
    const s1 = templateSections(tpl)[0];
    // Bind a field and reference it from a node.
    s1.fields = [{ id: 'fld-x', label: 'X', kind: 'text', required: false }];
    s1.children = [
      { kind: 'node', node: { id: 'n-x', type: 'text', fieldId: 'fld-x' } },
      { kind: 'block', block: createBlockDef('B', [{ type: 'code' }]) },
    ];
    const copy = duplicateSection(s1);
    expect(copy.id).not.toBe(s1.id);
    expect(copy.fields[0].id).not.toBe('fld-x');
    const node = copy.children[0].kind === 'node' ? copy.children[0].node : null;
    expect(node?.fieldId).toBe(copy.fields[0].id);
    expect(node?.id).not.toBe('n-x');
    // Block duplicates start unassigned (fresh block id).
    const blockChild = copy.children[1].kind === 'block' ? copy.children[1].block : null;
    expect(blockChild?.id).not.toBe(createBlockDef('B', []).id);
    // Original untouched.
    expect(s1.fields[0].id).toBe('fld-x');
  });

  it('duplicateBlockDef produces a new id, name suffix and fresh field ids', () => {
    const b = createBlockDef('Code block', [{ type: 'code' }], [
      { id: 'fld-1', label: 'Note', kind: 'text', required: false },
    ]);
    const copy = duplicateBlockDef(b);
    expect(copy.id).not.toBe(b.id);
    expect(copy.name).toBe('Code block (copy)');
    expect(copy.fields[0].id).not.toBe('fld-1');
    expect(copy.nodes[0].id).not.toBe(b.nodes[0].id);
  });
});
