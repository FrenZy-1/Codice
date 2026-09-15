/**
 * Layout architecture export QA (NOT a test file — run with bun).
 *
 * Generates the §27 export-artifact matrix:
 *   standard flow  × DOCX/PDF/ODT   (details + attached images)
 *   custom layout  × DOCX/PDF/ODT   (sections + section fields + block
 *                                    pattern + fileImages + divider +
 *                                    pageBreakBefore answer section)
 *
 * Usage: bun scripts/layout-export-qa.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DiscoveredFile, ProjectEntry, DocumentMetadata, FileHandle } from '@/types';
import { buildDocumentModel } from '@/lib/documentBuilder';
import { getExporter } from '@/lib/exporters';
import { presetToOptions } from '@/lib/presets/presetToOptions';
import { BUILT_IN_DOCUMENT_PRESETS } from '@/lib/presets/builtInPresets';
import {
  createBlockDef,
  createEmptyTemplate,
  createSection,
  genLayoutId,
  type CustomLayoutTemplate,
} from '@/lib/customLayouts/model';
import { resolveCustomLayout } from '@/lib/customLayouts/resolver';
import { validateCustomLayout } from '@/lib/customLayouts/validation';
import { effectiveFileOrder } from '@/lib/documentOrder';
import { setGlyphFontOverride } from '@/lib/exporters/glyphFonts';
import { readFileSync } from 'node:fs';

/* ----------------------------- fixtures ----------------------------- */

const JAVA_MAIN = `package com.example.app;

public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, Codice!");
        // tree glyphs: ├── └── │ ──
    }
}
`;

const JAVA_UTIL = `package com.example.app;

public class Util {
    static String id(String s) { return s; }
}
`;

const README = `# sclab2_0

project/
├── src/
│   └── main/
└── README.md

Notes: unicode tree must survive every exporter.
`;

// 4×4 well-formed red PNG generated with fflate (real pixels, valid IDAT —
// jsPDF rejects lenient-decoder PNGs, see worklog round-22 note).
import { deflateSync } from 'fflate';
function makeRedPng(w: number, h: number): string {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0; // filter none
    for (let x = 0; x < w; x++) {
      const o = row + 1 + x * 3;
      raw[o] = 0xc0; raw[o + 1] = 0x60; raw[o + 2] = 0x66;
    }
  }
  const idat = deflateSync(new Uint8Array(raw));
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcTable: number[] = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc);
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', Buffer.from(idat)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png.toString('base64');
}
const PNG_BASE64 = makeRedPng(320, 200);

function makeFile(
  projectId: string,
  idx: number,
  relativePath: string,
  language: string | null,
  content: string,
): DiscoveredFile {
  return {
    id: `${projectId}-f${idx}`,
    projectId,
    relativePath,
    name: relativePath.split('/').pop() || relativePath,
    directory: relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '',
    size: content.length,
    language,
    isConfig: false,
    binary: false,
    excluded: false,
    fileHandle: { getText: async () => content } as unknown as FileHandle,
  };
}

function buildProjects(): ProjectEntry[] {
  const p1Files = [
    makeFile('p1', 0, 'src/Main.java', 'java', JAVA_MAIN),
    makeFile('p1', 1, 'src/Util.java', 'java', JAVA_UTIL),
    makeFile('p1', 2, 'README.md', 'markdown', README),
  ];
  const p2Files = [
    makeFile('p2', 0, 'src/Main.java', 'java', 'public class Main2 {}\n'),
    makeFile('p2', 1, 'src/Bridge.java', 'java', 'object Bridge\n'),
  ];
  const mk = (id: string, label: string, files: DiscoveredFile[]): ProjectEntry => ({
    id,
    label,
    folderName: label,
    files,
    selectedCount: files.length,
    selectedSize: files.reduce((acc, f) => acc + f.size, 0),
    warnings: [],
    addedAt: Date.now(),
  });
  return [mk('p1', 'sclab2_0', p1Files), mk('p2', 'sclab2_1', p2Files)];
}

/* ------------------- custom layout (v2) + content ------------------- */

function buildLayout(): CustomLayoutTemplate {
  const t = createEmptyTemplate('QA Tasks');
  const s1 = t.sections[0];
  s1.name = 'Task 01';
  const titleField = { id: 'fldTitle', label: 'Task Title', kind: 'text' as const, required: true };
  const outField = { id: 'fldOut', label: 'Output', kind: 'textarea' as const, required: false };
  const shotField = { id: 'fldShot', label: 'Output Screenshot', kind: 'image' as const, required: true };
  s1.fields.push(titleField, outField, shotField);
  const codeBlock = createBlockDef(
    'Code block',
    [
      { type: 'heading', text: '{fileName}', style: { level: 2 } },
      { type: 'description' },
      { type: 'file' },
      { type: 'fileImages' },
      { type: 'divider', style: { heightPt: 1, fillColor: '#999999' } },
    ],
    [{ id: 'fldNote', label: 'Per-file note', kind: 'text', required: false }],
  );
  s1.children.push(
    {
      kind: 'node',
      id: genLayoutId('ch'),
      node: { id: genLayoutId('n'), type: 'heading', fieldId: titleField.id, style: { level: 1 } },
    },
    {
      kind: 'node',
      id: genLayoutId('ch'),
      node: { id: genLayoutId('n'), type: 'text', fieldId: outField.id, style: { label: true } },
    },
    { kind: 'block', id: genLayoutId('ch'), block: codeBlock },
    {
      kind: 'node',
      id: genLayoutId('ch'),
      node: { id: genLayoutId('n'), type: 'image', fieldId: shotField.id },
    },
  );
  // Answers section on a fresh page (§18)
  const s2 = createSection('descriptionAnswer', 'Answers');
  s2.pageBreakBefore = true;
  t.sections.push(s2);
  return t;
}

/* ----------------------------- main ----------------------------- */

// Headless harness: inject the glyph fallback fonts from disk (the browser
// fetches them from /fonts — same data, same exporter behavior, §21).
setGlyphFontOverride({
  normal: readFileSync(resolve(process.cwd(), 'public/fonts/DejaVuSansMono.ttf')).toString('base64'),
  bold: readFileSync(resolve(process.cwd(), 'public/fonts/DejaVuSansMono-Bold.ttf')).toString('base64'),
});

const outDir = resolve(process.cwd(), 'download/layout-exports-qa');
mkdirSync(outDir, { recursive: true });

const preset = BUILT_IN_DOCUMENT_PRESETS[0];
const options = presetToOptions(preset);
const projects = buildProjects();
const selectedAll = new Set(projects.flatMap((p) => p.files.map((f) => f.id)));
const metadata: DocumentMetadata = {
  title: 'Layout QA',
  subtitle: 'Custom layout export verification',
  author: 'QA Harness',
  date: '',
};

const layout = buildLayout();
const section1 = layout.sections[0];
const blockChild = section1.children.find((c) => c.kind === 'block') as {
  kind: 'block';
  block: { id: string };
};
const assignments = { [blockChild.block.id]: ['p1-f0', 'p2-f0', 'p1-f1'] };
const fileDetails = {
  'p1-f0': { description: 'Entry point of the app.', summary: 'Prints a greeting.', note: 'Tree glyphs: ├ └ │ ─' },
  'p1-f1': { description: 'Small helper.' },
};
const fileImages = { 'p1-f0': ['imgShot1'], 'p2-f0': ['imgShot1'] };
const imageAssets = {
  imgShot1: {
    id: 'imgShot1',
    name: 'output.png',
    dataUrl: `data:image/png;base64,${PNG_BASE64}`,
    mime: 'image/png' as const,
    width: 4,
    height: 4,
    sizeBytes: PNG_BASE64.length,
    caption: 'Program output',
    addedAt: 1,
  },
};
const sectionFieldValues: Record<string, Record<string, string>> = {
  [section1.id]: {
    fldTitle: 'Task 01 — Student Records',
    fldOut: 'The program prints the greeting and exits.',
    fldShot: 'imgShot1',
  },
};
// Fill the Answers section's required fields by label.
{
  const answers = layout.sections[1];
  const values: Record<string, string> = {};
  for (const f of answers.fields) {
    if (f.label === 'Description') values[f.id] = 'Chapter 1 wrap-up.';
    if (f.label === 'Answer') values[f.id] = 'All requirements are satisfied.';
  }
  sectionFieldValues[answers.id] = values;
}

// §5 — validate BEFORE generating anything (mirrors the ExportPanel flow).
const docProjectsForValidation = projects.map((p) => ({
  id: p.id,
  label: p.label,
  folderName: p.label,
  structurePaths: [],
  files: p.files.map((f) => ({
    projectId: p.id,
    projectLabel: p.label,
    relativePath: f.relativePath,
    language: f.language,
    highlighted: { fileId: f.id, relativePath: f.relativePath, language: f.language, lines: [] },
    sizeBytes: f.size,
  })),
}));
const missing = validateCustomLayout({
  template: layout,
  projects: docProjectsForValidation,
  fileDetails,
  fileFieldValues: { 'p1-f0': { fldNote: 'inline note' } },
  sectionFieldValues,
  fileAssignments: assignments,
});
if (missing.length > 0) {
  console.error('VALIDATION FAILED — export blocked:', missing);
  process.exit(1);
}

// --- Standard flow (details + attached images) ---
const standardModel = await buildDocumentModel(
  projects.map((p) => ({ project: p, selectedFileIds: new Set(p.files.map((f) => f.id)) })),
  options,
  metadata,
  undefined,
  { fileDetails, fileImages, imageAssets: Object.values(imageAssets) },
);

// --- Custom layout flow (sections + resolved stream) ---
const layoutModel = await buildDocumentModel(
  projects.map((p) => ({ project: p, selectedFileIds: new Set(p.files.map((f) => f.id)) })),
  options,
  metadata,
  undefined,
  { fileDetails, fileImages, imageAssets: Object.values(imageAssets) },
);
layoutModel.customLayout = resolveCustomLayout(layout, {
  projects: layoutModel.projects,
  fileDetails,
  fileFieldValues: { 'p1-f0': { fldNote: 'inline note' } },
  sectionFieldValues,
  fileOrder: {},
  assignments,
  imageAssets,
  metadata,
  fileCount: layoutModel.projects.reduce((acc, p) => acc + p.files.length, 0),
});

for (const [tag, model] of [
  ['standard', standardModel],
  ['layout', layoutModel],
] as const) {
  for (const fmt of ['docx', 'pdf', 'odt'] as const) {
    const exporter = getExporter(fmt);
    const result = await exporter.export(model, { format: fmt, filename: `qa-${tag}` });
    const buf = Buffer.from(await result.blob.arrayBuffer());
    const target = resolve(outDir, `qa-${tag}.${fmt}`);
    writeFileSync(target, buf);
    console.log(`${tag} ${fmt}: ${target} (${buf.length} bytes, ${Math.round(result.elapsedMs)}ms)`);
  }
}

// Quick structural assertions on the resolved stream itself.
const resolved = layoutModel.customLayout!;
const kinds = resolved.blocks.map((b) => b.kind);
const taskTitleCount = kinds.filter((k) => k === 'heading').length;
const images = kinds.filter((k) => k === 'image').length;
const dividers = kinds.filter((k) => k === 'divider').length;
const pageBreaks = kinds.filter((k) => k === 'pageBreak').length;
const codeBlocks = kinds.filter((k) => k === 'code').length;
console.log('resolved stream:', JSON.stringify({ headings: taskTitleCount, images, dividers, pageBreaks, codeBlocks }));
if (codeBlocks !== 3) throw new Error(`expected 3 block instances (one per assigned file), got ${codeBlocks}`);
if (images !== 3) throw new Error(`expected 3 images (screenshot × 3 files via fileImages + field image), got ${images}`);
if (pageBreaks !== 1) throw new Error(`expected 1 page break (Answers section), got ${pageBreaks}`);
if (dividers !== 3) throw new Error(`expected 3 dividers, got ${dividers}`);
console.log('LAYOUT EXPORT QA OK');
