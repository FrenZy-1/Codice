/**
 * Custom layout template model — v2 ("Layout Architecture" spec §1-§4).
 *
 * A CustomLayoutTemplate answers "what content does my document contain and
 * in what order/arrangement" — deliberately SEPARATE from the style preset
 * (§17), which answers "how does it look".
 *
 * The v2 hierarchy mirrors the document semantics:
 *
 *   File layout  = ordered list of SECTIONS (the document skeleton)
 *     Section    = typed content group (Task, Code+Output, …) containing
 *       - standalone SECTION FIELDS (Task Title, Output, Answer, Image…)
 *       - standalone content NODES (headings, spacers, panels, TOC…)
 *       - BLOCK definitions (the repeated per-file pattern)
 *         Block     = ordered NODE list + per-file BLOCK FIELDS
 *           Field   = a named content slot (text/textarea/image)
 *
 * A Block is a PATTERN, not data: for every file assigned to it (session
 * state — see useAppState.layoutAssignments) the resolver emits exactly one
 * block instance (§3 "one file → one section → one block instance").
 *
 * The template never contains document data — resolution (resolver.ts)
 * turns template + data into a flat `ResolvedLayoutBlock[]` stream that the
 * preview and all three exporters consume (§17/§26).
 */

export type TemplateFieldType = 'text' | 'textarea' | 'image';

/** A reusable custom content slot declared by a section or block (§4). */
export interface TemplateFieldDefinition {
  id: string;
  label: string;
  kind: TemplateFieldType;
  required: boolean;
}

export type TemplateBlockType =
  // text-ish
  | 'text'
  | 'heading'
  // standard per-file fields (§4 block fields)
  | 'description'
  | 'summary'
  | 'note'
  | 'code'
  | 'file'
  | 'fileName'
  | 'filePath'
  | 'language'
  | 'fileSize'
  | 'lineCount'
  | 'fileImages'
  // media / structure
  | 'image'
  | 'project'
  | 'metadata'
  | 'toc'
  | 'pageBreak'
  | 'spacer'
  | 'divider'
  | 'panel'
  | 'columns';

/** Visual style overrides applied on top of the active style preset. */
export interface TemplateBlockStyle {
  align?: 'left' | 'center' | 'right';
  /** Text/heading font size override (pt). */
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
  /** Text color override (hex). */
  color?: string;
  /** Panel/column/divider fill color (hex or null). */
  fillColor?: string | null;
  borderColor?: string | null;
  borderWidthPt?: number;
  radiusPt?: number;
  paddingPt?: number;
  /** Spacer/divider height (pt). */
  heightPt?: number;
  /** Heading depth for heading blocks (1=H1 … 3=H3). */
  level?: 1 | 2 | 3;
  /** Column count for columns containers. */
  columns?: 2 | 3;
  /** Show image captions (default true). */
  caption?: boolean;
  /** Render a field node with its label above the value (labeled style). */
  label?: boolean;
}

/**
 * One node of the content graph — structure + placement, never data.
 * Nodes with a `fieldId` bind to a field value at resolve time (block
 * fields resolve per file, section fields resolve per section).
 */
export interface TemplateNode {
  id: string;
  type: TemplateBlockType;
  /** Field-backed nodes (text/heading/image bind to custom fields). */
  fieldId?: string;
  /** Literal text (tokens like {fileName} are expanded at resolve time). */
  text?: string;
  style?: TemplateBlockStyle;
  /**
   * Children of a container:
   *   - panel: one stack of nodes
   *   - columns: N stacks (one per column, length = style.columns)
   */
  children?: TemplateNode[][];
}

/** A BLOCK definition — the repeated visual/content pattern for ONE file
 * (§3). The block's nodes may contain file-bound field nodes (code,
 * description, {fileName} tokens…) and custom field bindings. */
export interface TemplateBlockDef {
  id: string;
  /** Display name, e.g. "Code block" or "Main pattern". */
  name: string;
  /** Block-level custom fields — values are stored PER FILE (§4). */
  fields: TemplateFieldDefinition[];
  /** Ordered content nodes rendered once per assigned file. */
  nodes: TemplateNode[];
}

/** One entry of a section's ordered content list (§2). */
export type SectionChild =
  | { kind: 'node'; id: string; node: TemplateNode }
  | { kind: 'block'; id: string; block: TemplateBlockDef };

/** Section type — a STARTING structure preset, never a rigid schema (§1). */
export type SectionTypeId =
  | 'task'
  | 'codeOutput'
  | 'descriptionCodeOutput'
  | 'descriptionAnswer'
  | 'output'
  | 'summary'
  | 'custom';

export interface TemplateSection {
  id: string;
  name: string;
  type: SectionTypeId;
  /** Section-scope fields — values are stored PER SECTION (not per file). */
  fields: TemplateFieldDefinition[];
  /** Ordered content: standalone nodes and block references. */
  children: SectionChild[];
  /** Start this section on a fresh page (real page break, §18). */
  pageBreakBefore: boolean;
}

/** A versioned, self-contained template definition (§30). */
export interface CustomLayoutTemplate {
  id: string;
  name: string;
  description?: string;
  version: 2;
  createdAt: number;
  updatedAt: number;
  sections: TemplateSection[];
}

/* ------------------------------------------------------------------ */
/* v1 (legacy, flat blocks + repeat) — kept ONLY for migration         */
/* ------------------------------------------------------------------ */

/** @legacy v1 template shape (auto-migrated on load/import). */
export interface CustomLayoutTemplateV1 {
  id: string;
  name: string;
  description?: string;
  version: 1;
  createdAt: number;
  updatedAt: number;
  repeat: 'once' | 'eachProject' | 'eachFile';
  fields: TemplateFieldDefinition[];
  blocks: TemplateNode[];
}

/* ------------------------------------------------------------------ */
/* Resolved content stream (consumed by preview + exporters, §17/§26)  */
/* ------------------------------------------------------------------ */

/** Common text presentation carried on every text-ish resolved block. */
export interface ResolvedTextProps {
  align?: 'left' | 'center' | 'right';
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

export type ResolvedLayoutBlock =
  | ({ kind: 'heading'; level: 1 | 2 | 3; text: string } & ResolvedTextProps)
  | ({ kind: 'paragraph'; text: string } & ResolvedTextProps)
  /** A labeled content block: file description / summary / note / field text. */
  | ({ kind: 'labeled'; label: string; text: string } & ResolvedTextProps)
  /** The file's standard header block (path/language/size…). */
  | { kind: 'fileHeader'; projectId: string; fileId: string }
  /** The file's syntax-highlighted code block (existing machinery). */
  | { kind: 'code'; projectId: string; fileId: string }
  /** A resolved image with embedded pixel data (never a temp URL, §7). */
  | {
      kind: 'image';
      imageId: string;
      name: string;
      dataUrl: string;
      mime: 'image/png' | 'image/jpeg';
      width: number;
      height: number;
      caption?: string;
      align?: 'left' | 'center' | 'right';
      captionVisible: boolean;
    }
  | { kind: 'pageBreak' }
  | { kind: 'spacer'; heightPt: number }
  /** A horizontal rule (§6): filled bar of heightPt (default 1pt). */
  | { kind: 'divider'; heightPt: number; fillColor?: string | null }
  /** A visual container: fill/border/padding around a stack of blocks (§6). */
  | {
      kind: 'panel';
      fillColor?: string | null;
      borderColor?: string | null;
      borderWidthPt?: number;
      radiusPt?: number;
      paddingPt?: number;
      /** Explicit box height for EMPTY panels (dividers/spacer boxes). */
      heightPt?: number;
      children: ResolvedLayoutBlock[];
    }
  /** Side-by-side regions: rendered as columns where the format supports it. */
  | { kind: 'columns'; count: 2 | 3; columns: ResolvedLayoutBlock[][] }
  /** The standard table of contents. */
  | { kind: 'toc' }
  /** The document metadata (title page) block. */
  | { kind: 'metadata' }
  /** A project section header for the given project. */
  | { kind: 'projectHeader'; projectId: string };

/** Context passed to the resolver for one expansion instance. */
export interface ResolutionContext {
  /**
   * Field values for the current scope: per-file values for block
   * instances (merged OVER the owning section's values), per-section
   * values for standalone section content.
   */
  fieldValues: Record<string, string>;
  /** Current file, when expanding a block instance. */
  file?: { projectId: string; fileId: string };
  /** Owning section field values (fallback scope inside blocks). */
  sectionValues?: Record<string, string>;
  /** fieldId → label (for labeled rendering of field-backed nodes). */
  fieldLabels?: Record<string, string>;
}

/** Stable id generator for sections/blocks/nodes/fields/templates. */
export function genLayoutId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/** Node metadata: display names for the palette. */
export const NODE_TYPE_LABELS: Record<TemplateBlockType, string> = {
  text: 'Text',
  heading: 'Heading',
  description: 'Description',
  summary: 'Summary',
  note: 'Note',
  code: 'Code',
  file: 'File (header + code)',
  fileName: 'File name',
  filePath: 'Relative path',
  language: 'Language',
  fileSize: 'File size',
  lineCount: 'Line count',
  fileImages: 'File images',
  image: 'Image',
  project: 'Project header',
  metadata: 'Metadata',
  toc: 'Table of Contents',
  pageBreak: 'Page Break',
  spacer: 'Spacer',
  divider: 'Divider',
  panel: 'Panel',
  columns: 'Columns',
};

/** Node types that bind to the current file to produce content (§3/§4). */
export const FILE_CONTEXT_NODES: ReadonlySet<TemplateBlockType> = new Set([
  'description',
  'summary',
  'note',
  'code',
  'file',
  'fileName',
  'filePath',
  'language',
  'fileSize',
  'lineCount',
  'fileImages',
] as TemplateBlockType[]);

/**
 * Human-readable explanation of what a node renders — used as the block
 * palette tooltip (onboarding spec §0: "what each block type does and when
 * to use it").
 */
export function nodeTypeDescription(type: TemplateBlockType): string {
  switch (type) {
    case 'text':
      return 'A literal text paragraph (tokens like {fileName} are expanded). Bind it to a field to show field content.';
    case 'heading':
      return 'A section heading (H1–H3). Bind it to a field (e.g. Task Title) or use tokens like {fileName}.';
    case 'description':
      return "The current file's Description (from File properties). Shown with a label.";
    case 'summary':
      return "The current file's Summary (from File properties). Shown with a label.";
    case 'note':
      return "The current file's Note (from File properties). Shown with a label.";
    case 'code':
      return 'ONLY the syntax-highlighted code of the current file — no header. Use this when you want just the code.';
    case 'file':
      return 'The file header (name, path, language, size) PLUS the code block — the classic per-file section. Use this for the full file presentation.';
    case 'fileName':
      return 'Just the file name of the current file (plain text).';
    case 'filePath':
      return 'The relative path of the current file inside its project.';
    case 'language':
      return 'The detected language of the current file (e.g. Java).';
    case 'fileSize':
      return 'The formatted size of the current file (e.g. 2.2 KB).';
    case 'lineCount':
      return 'The number of code lines of the current file.';
    case 'fileImages':
      return 'ALL images attached to the current file (File properties → Images), each with its caption.';
    case 'image':
      return 'An image — from an image field, or a fixed image from the library.';
    case 'project':
      return 'The project section header (numbered heading).';
    case 'metadata':
      return 'The document metadata block (title page).';
    case 'toc':
      return 'The table of contents.';
    case 'pageBreak':
      return 'Starts a new page after this point (a real page break).';
    case 'spacer':
      return 'Vertical empty space.';
    case 'divider':
      return 'A horizontal rule — a filled bar that separates content areas.';
    case 'panel':
      return 'A bordered/filled container stacking other nodes (rounded corners, padding, background).';
    case 'columns':
      return 'Side-by-side regions, each stacking its own nodes.';
    default:
      return '';
  }
}

/** Section type metadata (§1 — starting structures). */
export interface SectionTypePreset {
  id: SectionTypeId;
  label: string;
  description: string;
  /** Build the initial structure for a section of this type. */
  build: () => { fields: TemplateFieldDefinition[]; children: SectionChild[] };
}

function field(
  label: string,
  kind: TemplateFieldType,
  required = false,
): TemplateFieldDefinition {
  return { id: genLayoutId('fld'), label, kind, required };
}

function node(type: TemplateBlockType, extra: Partial<TemplateNode> = {}): SectionChild {
  return { kind: 'node', id: genLayoutId('ch'), node: { id: genLayoutId('n'), type, ...extra } };
}

/** Create the standard starter BLOCK definition for section presets. */
export function createBlockDef(
  name: string,
  nodes: Array<Partial<TemplateNode>>,
  fields: TemplateFieldDefinition[] = [],
): TemplateBlockDef {
  return {
    id: genLayoutId('blk'),
    name,
    fields,
    nodes: nodes.map((n) => ({ id: genLayoutId('n'), type: 'text', ...n }) as TemplateNode),
  };
}

function blockChild(block: TemplateBlockDef): SectionChild {
  return { kind: 'block', id: genLayoutId('ch'), block };
}

/** SECTION_TYPE_PRESETS — §1 "Section type describes the general content
 * structure". Selecting a type populates this initial structure; the user
 * can then customize that individual section freely. */
export const SECTION_TYPE_PRESETS: Record<SectionTypeId, SectionTypePreset> = {
  task: {
    id: 'task',
    label: 'Task',
    description: 'Task title + description. Add blocks for the task\'s files below.',
    build: () => {
      const title = field('Task Title', 'text');
      const desc = field('Description', 'textarea');
      return {
        fields: [title, desc],
        children: [
          node('heading', { fieldId: title.id, style: { level: 1 }, text: '' }),
          node('text', { fieldId: desc.id, text: '' }),
        ],
      };
    },
  },
  codeOutput: {
    id: 'codeOutput',
    label: 'Code + Output',
    description: 'A file block followed by an output text area.',
    build: () => {
      const output = field('Output', 'textarea');
      return {
        fields: [output],
        children: [
          blockChild(createBlockDef('Code block', [
            { type: 'heading', text: '{fileName}', style: { level: 2 } },
            { type: 'code' },
          ])),
          node('text', { fieldId: output.id, text: '', style: { label: true } }),
        ],
      };
    },
  },
  descriptionCodeOutput: {
    id: 'descriptionCodeOutput',
    label: 'Description + Code + Output',
    description: 'Description, then the file block, then the program output.',
    build: () => {
      const desc = field('Description', 'textarea');
      const output = field('Output', 'textarea');
      return {
        fields: [desc, output],
        children: [
          node('text', { fieldId: desc.id, text: '' }),
          blockChild(createBlockDef('Code block', [
            { type: 'heading', text: '{fileName}', style: { level: 2 } },
            { type: 'file' },
          ])),
          node('text', { fieldId: output.id, text: '', style: { label: true } }),
        ],
      };
    },
  },
  descriptionAnswer: {
    id: 'descriptionAnswer',
    label: 'Description + Answer',
    description: 'A question/description followed by an answer — no code.',
    build: () => {
      const desc = field('Description', 'textarea');
      const answer = field('Answer', 'textarea', true);
      return {
        fields: [desc, answer],
        children: [
          node('text', { fieldId: desc.id, text: '' }),
          node('heading', { text: 'Answer', style: { level: 2 } }),
          node('text', { fieldId: answer.id, text: '' }),
        ],
      };
    },
  },
  output: {
    id: 'output',
    label: 'Output',
    description: 'Program output with screenshots — no code.',
    build: () => {
      const output = field('Output', 'textarea');
      const shot = field('Screenshot', 'image');
      return {
        fields: [output, shot],
        children: [
          node('heading', { text: 'Output', style: { level: 2 } }),
          node('text', { fieldId: output.id, text: '' }),
          node('image', { fieldId: shot.id }),
        ],
      };
    },
  },
  summary: {
    id: 'summary',
    label: 'Summary',
    description: 'A standalone summary block of text.',
    build: () => {
      const summary = field('Summary', 'textarea');
      return {
        fields: [summary],
        children: [
          node('heading', { text: 'Summary', style: { level: 2 } }),
          node('text', { fieldId: summary.id, text: '' }),
        ],
      };
    },
  },
  custom: {
    id: 'custom',
    label: 'Custom (empty)',
    description: 'An empty section — compose it from scratch.',
    build: () => ({ fields: [], children: [] }),
  },
};

/** Create an empty section of the given type. */
export function createSection(
  type: SectionTypeId,
  name?: string,
): TemplateSection {
  const preset = SECTION_TYPE_PRESETS[type];
  const built = preset.build();
  return {
    id: genLayoutId('sec'),
    name: name ?? preset.label,
    type,
    fields: built.fields,
    children: built.children,
    pageBreakBefore: false,
  };
}

/** Create an empty template with one Task section — a sensible start. */
export function createEmptyTemplate(name: string): CustomLayoutTemplate {
  const now = Date.now();
  return {
    id: genLayoutId('clt'),
    name,
    description: '',
    version: 2,
    createdAt: now,
    updatedAt: now,
    sections: [createSection('task', 'Task 01')],
  };
}

/**
 * Example template (onboarding §0 — "at minimum one example template the
 * user can load to see a real working layout before building their own").
 * Mirrors the acceptance example (§29): Task sections with section fields,
 * one block pattern, output images, and an answer section.
 */
export function createExampleTemplate(): CustomLayoutTemplate {
  const now = Date.now();
  const taskTitle = field('Task Title', 'text', true);
  const taskDesc = field('Task Description', 'textarea');
  const output = field('Output', 'textarea');
  const screenshot = field('Output Screenshot', 'image', true);

  const codeBlock = createBlockDef('Code block', [
    { type: 'heading', text: '{fileName}', style: { level: 2 } },
    { type: 'description' },
    { type: 'file' },
    { type: 'note' },
    { type: 'fileImages' },
  ]);

  const answerDesc = field('Description', 'textarea');
  const answer = field('Answer', 'textarea', true);

  return {
    id: genLayoutId('clt'),
    name: 'Example — Tasks & Answers',
    description:
      'Two task sections (title + description + per-file code + output screenshot) and a final answer section. Assign your files to the Code block in the File Layout editor.',
    version: 2,
    createdAt: now,
    updatedAt: now,
    sections: [
      {
        id: genLayoutId('sec'),
        name: 'Task 01',
        type: 'task',
        fields: [taskTitle, taskDesc, output, screenshot],
        pageBreakBefore: false,
        children: [
          node('heading', { fieldId: taskTitle.id, style: { level: 1 }, text: '' }),
          node('text', { fieldId: taskDesc.id, text: '' }),
          blockChild(codeBlock),
          node('text', { fieldId: output.id, text: '', style: { label: true } }),
          node('image', { fieldId: screenshot.id }),
        ],
      },
      {
        id: genLayoutId('sec'),
        name: 'Answers',
        type: 'descriptionAnswer',
        fields: [answerDesc, answer],
        pageBreakBefore: true,
        children: [
          node('heading', { fieldId: answerDesc.id, style: { level: 1 }, text: '' }),
          node('heading', { text: 'Answer', style: { level: 2 } }),
          node('text', { fieldId: answer.id, text: '' }),
        ],
      },
    ],
  };
}

/** Deep-clone any template-shaped value (no shared references). */
export function cloneTemplate<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/* ------------------------------------------------------------------ */
/* v1 → v2 migration (§9 — keep the old Block Editor's work)           */
/* ------------------------------------------------------------------ */

const FILE_BOUND_V1: ReadonlySet<TemplateBlockType> = new Set([
  'description',
  'summary',
  'note',
  'code',
  'file',
] as TemplateBlockType[]);

function migrateNode(n: TemplateNode): TemplateNode {
  return { ...cloneTemplate(n), id: n.id || genLayoutId('n') };
}

/**
 * Migrate a legacy v1 template into the v2 hierarchy. The old flat block
 * list becomes ONE section: file-bound blocks fold into a "Files" block
 * definition (their per-file field bindings keep working via the per-file
 * value store); everything else becomes standalone section content.
 */
export function migrateTemplateV1(v1: CustomLayoutTemplateV1): CustomLayoutTemplate {
  const section: TemplateSection = {
    id: genLayoutId('sec'),
    name: 'Content',
    type: 'custom',
    fields: cloneTemplate(v1.fields ?? []),
    children: [],
    pageBreakBefore: false,
  };

  const fileNodes: TemplateNode[] = [];
  const blockFieldIds = new Set<string>();
  for (const b of v1.blocks ?? []) {
    if (FILE_BOUND_V1.has(b.type)) {
      if (b.fieldId) blockFieldIds.add(b.fieldId);
      fileNodes.push(migrateNode(b));
    } else if (b.type === 'panel' || b.type === 'columns') {
      // Containers may hold file-bound nodes inside — migrate recursively:
      // containers with file-bound descendants go into the block, others
      // stay as section content.
      const containsFileBound = (n: TemplateNode): boolean => {
        if (FILE_BOUND_V1.has(n.type)) return true;
        return (n.children ?? []).some((stack) => stack.some(containsFileBound));
      };
      if (containsFileBound(b)) {
        if (b.fieldId) blockFieldIds.add(b.fieldId);
        fileNodes.push(migrateNode(b));
      } else {
        section.children.push({ kind: 'node', id: genLayoutId('ch'), node: migrateNode(b) });
      }
    } else {
      if (b.fieldId) {
        // Field-backed non-file nodes: keep as section content bound to the
        // same field id (now a section field).
        section.children.push({ kind: 'node', id: genLayoutId('ch'), node: migrateNode(b) });
      } else {
        section.children.push({ kind: 'node', id: genLayoutId('ch'), node: migrateNode(b) });
      }
    }
  }

  if (fileNodes.length > 0) {
    const blockFields = (v1.fields ?? []).filter((f) => blockFieldIds.has(f.id));
    section.children.push({
      kind: 'block',
      id: genLayoutId('ch'),
      block: {
        id: genLayoutId('blk'),
        name: 'Files',
        fields: cloneTemplate(blockFields),
        nodes: fileNodes,
      },
    });
  }

  return {
    id: v1.id || genLayoutId('clt'),
    name: v1.name ?? 'Migrated layout',
    description: v1.description ?? '',
    version: 2,
    createdAt: v1.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    sections: [section],
  };
}

/** Normalize any stored/imported template into a v2 template. */
export function ensureTemplateV2(t: CustomLayoutTemplate | CustomLayoutTemplateV1): CustomLayoutTemplate {
  if ((t as CustomLayoutTemplate).version === 2 && Array.isArray((t as CustomLayoutTemplate).sections)) {
    return cloneTemplate(t as CustomLayoutTemplate);
  }
  return migrateTemplateV1(t as CustomLayoutTemplateV1);
}

/** Iterate every block definition of a template (all sections). */
export function forEachBlockDef(
  template: CustomLayoutTemplate,
  fn: (block: TemplateBlockDef, section: TemplateSection) => void,
): void {
  for (const section of template.sections) {
    for (const child of section.children) {
      if (child.kind === 'block') fn(child.block, section);
    }
  }
}

/** Find the section + block a file is assigned to (one-file-one-section, §3). */
export function findFileAssignment(
  template: CustomLayoutTemplate,
  assignments: Record<string, string[]>,
  fileId: string,
): { section: TemplateSection; block: TemplateBlockDef } | null {
  for (const section of template.sections) {
    for (const child of section.children) {
      if (child.kind !== 'block') continue;
      const ids = assignments[child.block.id] ?? [];
      if (ids.includes(fileId)) return { section, block: child.block };
    }
  }
  return null;
}

/** All file ids assigned anywhere in this template (deduped). */
export function assignedFileIds(
  template: CustomLayoutTemplate,
  assignments: Record<string, string[]>,
): Set<string> {
  const ids = new Set<string>();
  forEachBlockDef(template, (block) => {
    for (const id of assignments[block.id] ?? []) ids.add(id);
  });
  return ids;
}
