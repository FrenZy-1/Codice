/**
 * §41 — golden-path export matrix. A realistic 2-project document (with a
 * duplicate filename across projects), a 3-section layout (Task, Task,
 * Description + Answer) with section content, an image, panels and file
 * blocks — exported through the REAL exporters and inspected at byte level:
 *
 *   DOCX — section fields once, block instances per file, image media part.
 *   PDF  — text layer contains the structure; page breaks honored.
 *   ODT  — Pictures/ entry + manifest; code styles; structure order.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { docxExporter } from '../lib/exporters/docxExporter';
import { pdfExporter } from '../lib/exporters/pdfExporter';
import { odtExporter } from '../lib/exporters/odtExporter';
import { resolveCustomLayout } from '@/lib/customLayouts/resolver';
import {
  createBlockDef,
  createSection,
  templateSections,
  type CustomLayoutTemplate,
} from '@/lib/customLayouts/model';
import { buildDocumentModel } from '@/lib/documentBuilder';
import { defaultDocumentOptions } from '@/lib/defaultOptions';
import { DEFAULT_PRESET_ID, getPreset } from '@/lib/presets/presets';
import { migratePreset } from '@/lib/presets/presetMigration';
import { presetToOptions } from '@/lib/presets/presetToOptions';
import type { DocumentModel, DocumentProject, ImageAsset, ProjectEntry } from '@/types';

/**
 * A 4x4 PNG with a WELL-FORMED zlib stream — jsPDF must decode PNGs (unlike
 * DOCX/ODT which embed raw bytes). See customLayoutExport.test.ts for the
 * full rationale; real user images are canvas re-encoded at import time.
 */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAP0lEQVR42gE0AMv/AAD/gDzXlHivqLSHvAAK/4BG15SCr6i+h7wAFP+AUNeUjK+oyIe8AB7/gFrXlJavqNKHvNG6HKF5IX2RAAAAAElFTkSuQmCC';

const SHOT: ImageAsset = {
  id: 'img-golden',
  name: 'golden-shot.png',
  mime: 'image/png',
  dataUrl: TINY_PNG,
  width: 4,
  height: 4,
  caption: 'The golden screenshot',
  sizeBytes: 100,
  addedAt: 0,
};

function makeProject(id: string, label: string, files: Array<{ id: string; path: string; code: string }>): ProjectEntry {
  return {
    id,
    label,
    folderName: label,
    files: files.map((f) => ({
      id: f.id,
      projectId: id,
      name: f.path.split('/').pop() ?? f.path,
      relativePath: f.path,
      directory: f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '',
      size: f.code.length,
      language: 'java',
      isConfig: false,
      binary: false,
      excluded: false,
      fileHandle: {
        getText: async () => f.code,
      },
    })),
    selectedCount: files.length,
    selectedSize: files.reduce((a, f) => a + f.code.length, 0),
    warnings: [],
    addedAt: 0,
  };
}

function goldenTemplate(): CustomLayoutTemplate {
  const out = { id: 'fld-out', label: 'Output', kind: 'textarea' as const, required: false };
  const shot = { id: 'fld-shot', label: 'Output Screenshot', kind: 'image' as const, required: false };
  const answer = { id: 'fld-answer', label: 'Answer', kind: 'textarea' as const, required: true };

  const s1 = createSection('task', 'Task 01');
  s1.fields = [out, shot];
  s1.children = [
    { kind: 'node', node: { id: 'n1-h', type: 'heading', text: '{fileName}', style: { level: 2 } } },
    { kind: 'block', block: createBlockDef('Code block', [{ type: 'file' }]) },
    { kind: 'node', node: { id: 'n1-o', type: 'text', fieldId: out.id, style: { label: true } } },
    { kind: 'node', node: { id: 'n1-i', type: 'image', fieldId: shot.id } },
  ];

  const s2 = createSection('task', 'Task 02');
  s2.pageBreakBefore = true;
  // Only a block — fields derive from content (none here).
  s2.fields = [];
  s2.children = [
    { kind: 'block', block: createBlockDef('Code block 2', [{ type: 'file' }]) },
  ];

  const s3 = createSection('descriptionAnswer', 'Task 03 — Answers');
  s3.pageBreakBefore = true;
  s3.fields = [answer];
  s3.children = [{ kind: 'node', node: { id: 'n3-a', type: 'text', fieldId: answer.id } }];

  return {
    id: 'golden-tpl',
    name: 'Golden path',
    version: 3,
    createdAt: 0,
    updatedAt: 0,
    rootChildren: [
      { kind: 'section', section: s1 },
      { kind: 'section', section: s2 },
      { kind: 'section', section: s3 },
    ],
    fields: [],
  };
}

const PROJECT_A = makeProject('pa', 'Project A', [
  { id: 'fa1', path: 'src/Main.java', code: 'public class Main {\n  // A main\n}\n' },
  { id: 'fa2', path: 'src/Util.java', code: 'package util;\npublic class Util {\n  // helper\n}\n' },
]);
// Project B contains a file with the SAME relative path as Project A's —
// the §12 collision case — plus its own Main content.
const PROJECT_B = makeProject('pb', 'Project B', [
  { id: 'fb1', path: 'src/Main.java', code: 'public class Main {\n  // B main — distinct file, same path\n}\n' },
  { id: 'fb2', path: 'README.md', code: '# Project B readme\n' },
]);

const SECTION_VALUES: Record<string, Record<string, string>> = {};

async function buildModel(projects: ProjectEntry[]): Promise<DocumentModel> {
  const preset = getPreset(DEFAULT_PRESET_ID);
  const options = preset ? presetToOptions(migratePreset(preset as unknown as Parameters<typeof migratePreset>[0])) : defaultDocumentOptions();
  const model = await buildDocumentModel(
    projects.map((p) => ({
      project: p,
      selectedFileIds: new Set(p.files.map((f) => f.id)),
      order: undefined,
    })),
    options,
    { title: 'Golden Path', author: 'QA', description: '', course: '', university: '', version: '' },
    undefined,
    {
      fileDetails: {},
      fileImages: {},
      imageAssets: [SHOT],
    },
  );
  const tpl = goldenTemplate();
  const sections = templateSections(tpl);
  const sectionId1 = sections[0].id;
  const sectionId2 = sections[1].id;
  const sectionId3 = sections[2].id;
  const blockId1 = (sections[0].children.find((c) => c.kind === 'block') as { block: { id: string } }).block.id;
  const blockId2 = (sections[1].children.find((c) => c.kind === 'block') as { block: { id: string } }).block.id;
  const values: Record<string, Record<string, string>> = {
    [sectionId1]: {
      'fld-out': 'Program output: it works.',
      'fld-shot': 'img-golden',
    },
    [sectionId3]: { 'fld-answer': 'The answer is 42.' },
  };
  SECTION_VALUES[sectionId1] = values[sectionId1];
  SECTION_VALUES[sectionId2] = {};
  SECTION_VALUES[sectionId3] = values[sectionId3];
  model.customLayout = resolveCustomLayout(tpl, {
    projects: model.projects as unknown as DocumentProject[],
    fileDetails: {},
    fileFieldValues: {},
    sectionFieldValues: values,
    documentFieldValues: {},
    fileOrder: {},
    assignments: {
      [blockId1]: ['fa1', 'fa2'],
      [blockId2]: ['fb1', 'fb2'],
    },
    imageAssets: { 'img-golden': SHOT },
    metadata: { title: 'Golden Path', author: 'QA' },
    fileCount: 4,
  });
  return model;
}

describe('§41 golden-path export matrix', () => {
  it('resolves: section fields once per section, block instances per file, correct section order', async () => {
    const model = await buildModel([PROJECT_A, PROJECT_B]);
    const blocks = model.customLayout!.blocks;
    const texts = blocks
      .filter((b) => b.kind === 'heading' || b.kind === 'paragraph' || b.kind === 'labeled')
      .map((b) => (b as { text?: string }).text ?? '');

    // Section field content renders ONCE per section (not per file).
    expect(texts.filter((t) => t === 'Program output: it works.')).toHaveLength(1);
    expect(texts.filter((t) => t === 'The answer is 42.')).toHaveLength(1);
    // Both files named Main.java render — §12, both survive.
    const codeBlocks = blocks.filter((b) => b.kind === 'code') as Array<{ fileId: string }>;
    expect(codeBlocks.map((c) => c.fileId).sort()).toEqual(['fa1', 'fa2', 'fb1', 'fb2']);
    // Section order preserved: Task 01 content → Task 02 → Answers.
    expect(texts.indexOf('Program output: it works.')).toBeLessThan(texts.indexOf('The answer is 42.'));
    // The image resolved.
    expect(blocks.some((b) => b.kind === 'image')).toBe(true);
  });

  it('DOCX embeds the structure and the image as a real media part', async () => {
    const model = await buildModel([PROJECT_A, PROJECT_B]);
    const blob = await docxExporter.export(model, { format: 'docx', filename: 'golden' });
    const zip = await JSZip.loadAsync(blob.blob);
    const xml = await zip.file('word/document.xml')!.async('string');
    const text = xml.replace(/<[^>]+>/g, ' ');

    expect(text.match(/Program output: it works\./g)?.length).toBe(1);
    expect(text.match(/The answer is 42\./g)?.length).toBe(1);
    // Distinct Main.java bodies both present (duplicate path, both files).
    expect(text).toContain('// A main');
    expect(text).toContain('// B main — distinct file, same path');
    // Image embedded as media.
    const media = Object.keys(zip.files).filter((n) => n.startsWith('word/media/'));
    expect(media.length).toBeGreaterThan(0);
  });

  it('PDF text layer contains the section content, structure and image XObject', async () => {
    const model = await buildModel([PROJECT_A, PROJECT_B]);
    const result = await pdfExporter.export(model, { format: 'pdf', filename: 'golden' });
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(new TextDecoder('latin1').decode(bytes.slice(0, 5))).toBe('%PDF-');
    const raw = new TextDecoder('latin1').decode(bytes);
    // Section fields once + answer + both duplicate-path file bodies.
    expect(raw).toContain('Program output: it works.');
    expect(raw).toContain('The answer is 42.');
    expect(raw).toContain('// A main');
    expect(raw).toContain('// B main');
    // The section screenshot is embedded as real pixels.
    expect(raw).toContain('/Subtype /Image');
    // pageBreakBefore on sections 2+3 → multiple pages.
    const pages = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(2);
  });

  it('ODT registers the image in Pictures/ + manifest and keeps the structure', async () => {
    const model = await buildModel([PROJECT_A, PROJECT_B]);
    const blob = await odtExporter.export(model, { format: 'odt', filename: 'golden' });
    const zip = await JSZip.loadAsync(blob.blob);
    const content = await zip.file('content.xml')!.async('string');
    const manifest = await zip.file('META-INF/manifest.xml')!.async('string');

    expect(Object.keys(zip.files).some((n) => n.startsWith('Pictures/'))).toBe(true);
    expect(manifest).toMatch(/Pictures\//);
    expect(content).toContain('Program output: it works.');
    expect(content).toContain('The answer is 42.');
    expect(content).toContain('// A main');
    expect(content).toContain('// B main');
  });

  it('per-project (separate) models keep the FULL section structure with only their files', async () => {
    const modelA = await buildModel([PROJECT_A]);
    const textsA = modelA.customLayout!.blocks
      .filter((b) => b.kind === 'heading' || b.kind === 'paragraph' || b.kind === 'labeled')
      .map((b) => (b as { text?: string }).text ?? '');
    // §3 — every section present: Task 01 content + Task 02 fallback + Answer.
    expect(textsA).toContain('Program output: it works.');
    expect(textsA).toContain('Task 02'); // §3 structural fallback
    expect(textsA).toContain('The answer is 42.');
    // Only project A's files rendered.
    const codesA = modelA.customLayout!.blocks.filter((b) => b.kind === 'code') as Array<{ fileId: string }>;
    expect(codesA.map((c) => c.fileId).sort()).toEqual(['fa1', 'fa2']);

    const modelB = await buildModel([PROJECT_B]);
    const codesB = modelB.customLayout!.blocks.filter((b) => b.kind === 'code') as Array<{ fileId: string }>;
    expect(codesB.map((c) => c.fileId).sort()).toEqual(['fb1', 'fb2']);
    const textsB = modelB.customLayout!.blocks
      .filter((b) => b.kind === 'heading' || b.kind === 'paragraph' || b.kind === 'labeled')
      .map((b) => (b as { text?: string }).text ?? '');
    expect(textsB).toContain('The answer is 42.');
    // §3 — section content flows into EVERY project document; only files differ.
    expect(textsB).toContain('Program output: it works.');
    // B's section-2 block HAS B's files → real content, no fallback there.
    expect(textsB).not.toContain('Task 02');
  });
});
