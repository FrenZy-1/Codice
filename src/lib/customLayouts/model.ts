/**
 * Custom layout template model — v3 ("document model correction").
 *
 * A CustomLayoutTemplate answers "what content does my document contain and
 * in what order/arrangement" — deliberately SEPARATE from the style preset
 * (§45), which answers "how does it look".
 *
 * The v3 hierarchy is the intended document model:
 *
 *   FILE (one export document)            — ONE ordered root container
 *     ├─ standalone nodes                 (title, panel, text, …)
 *     ├─ SECTION
 *     │    ├─ standalone nodes            (heading, image, text, …)
 *     │    └─ BLOCK                       (the per-file pattern)
 *     │         └─ standalone nodes       (heading, path, code, note, …)
 *     ├─ SECTION
 *     ├─ standalone nodes                 (spacer, closing note, …)
 *     └─ …                                (any interleave, any order)
 *
 * KEY v3 CORRECTIONS over v2:
 *   - The File level is ONE canonical ordered container (`rootChildren`)
 *     holding an interleaved mix of standalone nodes AND sections — v2 kept
 *     a separate `sections[]` array plus file-level `children[]` that always
 *     rendered first, so "content after the sections" was unrepresentable.
 *   - Section fields AND block fields are both DERIVED from their content
 *     nodes (content is the single source of truth; §20/§6). No drifting
 *     parallel arrays.
 *   - Document-level fields exist (file-level nodes may bind fields, §21).
 *   - ONE Image primitive: an image node picks its content source
 *     (library asset / bound field / images attached to the current file)
 *     instead of v2's separate `image` / `field(image)` / `fileImages`
 *     concepts (§7/§8).
 *   - Identity is the node/block/section id — no duplicate wrapper ids.
 *
 * A Block is a PATTERN, not data: for every file assigned to it (session
 * state — see useAppState.layoutAssignments) the resolver emits exactly one
 * block instance (§4 "one file → one section → one block instance").
 *
 * The template never contains document data — resolution (resolver.ts)
 * turns template + data into a flat `ResolvedLayoutBlock[]` stream that the
 * preview and all three exporters consume.
 */

export type TemplateFieldType = 'text' | 'textarea' | 'image';

/** A reusable custom content slot declared at document/section/block scope. */
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
  // standard per-file fields (block fields)
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
  // legacy marker kept ONLY for migration (now image + imageSource, §8)
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

/** Where an Image node gets its pixels from (§7/§8 — ONE user primitive). */
export type ImageSource = 'library' | 'field' | 'fileAttachments';

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
  /** Panel text color — default color for text rendered inside a panel. */
  textColor?: string;
  /** Image content source (§8). `fileAttachments` requires a file context. */
  imageSource?: ImageSource;
}

/**
 * One node of the content graph — structure + placement, never data.
 * Nodes with a `fieldId` bind to a field value at resolve time (block
 * fields resolve per file, section fields per section, document fields
 * once per document).
 */
export interface TemplateNode {
  id: string;
  type: TemplateBlockType;
  /** Field-backed nodes (text/heading/image bind to custom fields). */
  fieldId?: string;
  /** Literal text (tokens like {fileName} are expanded at resolve time).
   * For library images this carries the asset id. */
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
 * (§4). The block's nodes may contain file-bound nodes (code, description,
 * {fileName} tokens…) and custom field bindings. */
export interface TemplateBlockDef {
  id: string;
  /** Display name, e.g. "Code block" or "Main pattern". */
  name: string;
  /** Block-level custom fields — values are stored PER FILE (§4).
   * DERIVED from the block's nodes (content is authoritative, §20). */
  fields: TemplateFieldDefinition[];
  /** Ordered content nodes rendered once per assigned file. */
  nodes: TemplateNode[];
}

/**
 * One entry of a SECTION's ordered content list (§3): a standalone node or
 * a block definition. Identity = node.id / block.id (no wrapper ids — v3
 * removed the duplicate `ch-` identity level).
 */
export type SectionChild =
  | { kind: 'node'; node: TemplateNode }
  | { kind: 'block'; block: TemplateBlockDef };

/** Section type — a STARTING structure preset, never a rigid schema (§19). */
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
  /** Section-scope fields — DERIVED from the section's content nodes. */
  fields: TemplateFieldDefinition[];
  /** Ordered content: standalone nodes and block definitions. */
  children: SectionChild[];
  /** Start this section on a fresh page (real page break, §50). */
  pageBreakBefore: boolean;
}

/**
 * One entry of the FILE-level ordered layout list (§2): a standalone node
 * or a whole section — interleaved in ONE canonical order.
 */
export type RootChild =
  | { kind: 'node'; node: TemplateNode }
  | { kind: 'section'; section: TemplateSection };

/** A versioned, self-contained template definition (§30). */
export interface CustomLayoutTemplate {
  id: string;
  name: string;
  description?: string;
  version: 3;
  createdAt: number;
  updatedAt: number;
  /**
   * THE canonical ordered container of the File layout (§2/§6): standalone
   * nodes and sections interleaved in exactly the order they render. There
   * is no separate `sections` array — use `templateSections()`.
   */
  rootChildren: RootChild[];
  /**
   * Document-level fields (§21) — bound by file-level standalone nodes,
   * filled once per document. DERIVED from rootChildren node bindings.
   */
  fields: TemplateFieldDefinition[];
}

/* ------------------------------------------------------------------ */
/* Legacy shapes — kept ONLY for migration                              */
/* ------------------------------------------------------------------ */

/** @legacy v2 template shape (sections[] + optional file-level children[]). */
export interface CustomLayoutTemplateV2 {
  id: string;
  name: string;
  description?: string;
  version: 2;
  createdAt: number;
  updatedAt: number;
  sections: TemplateSectionV2[];
  children?: SectionChildV2[];
}

/** @legacy v2 section (children with wrapper ids). */
export interface TemplateSectionV2 {
  id: string;
  name: string;
  type: SectionTypeId;
  fields: TemplateFieldDefinition[];
  children: SectionChildV2[];
  pageBreakBefore: boolean;
}

/** @legacy v2 section child (wrapper id + node/block). */
export type SectionChildV2 =
  | { kind: 'node'; id?: string; node: TemplateNode }
  | { kind: 'block'; id?: string; block: TemplateBlockDef };

/** @legacy v1 template shape (flat blocks + repeat). */
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
/* Resolved content stream (consumed by preview + exporters, §46)       */
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
  | ({ kind: 'heading'; level: 1 | 2 | 3; text: string;
       /** Stable source-node id — per-node styling identity (§13). */
       nodeId?: string;
       /**
        * Per-INSTANCE outline anchor (§34). Block headings repeat once
        * per assigned file, so the anchor adds the file id; standalone
        * headings anchor by node id alone.
        */
       anchorId?: string } & ResolvedTextProps)
  | ({ kind: 'paragraph'; text: string; nodeId?: string } & ResolvedTextProps)
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
      /** Stable source-node id — per-panel theme styling (§13). */
      nodeId?: string;
      fillColor?: string | null;
      borderColor?: string | null;
      borderWidthPt?: number;
      radiusPt?: number;
      paddingPt?: number;
      /** Default text color for content inside the panel (§12). */
      textColor?: string;
      /** Explicit box height for EMPTY panels (dividers/spacer boxes). */
      heightPt?: number;
      children: ResolvedLayoutBlock[];
    }
  /** Side-by-side regions: rendered as columns where the format supports it. */
  | { kind: 'columns'; nodeId?: string; count: 2 | 3; columns: ResolvedLayoutBlock[][] }
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
   * values for standalone section content, document values for
   * file-level content.
   */
  fieldValues: Record<string, string>;
  /** Current file, when expanding a block instance. */
  file?: { projectId: string; fileId: string };
  /** Owning section field values (fallback scope inside blocks). */
  sectionValues?: Record<string, string>;
  /** Document-level field values (outermost fallback scope). */
  documentValues?: Record<string, string>;
  /** fieldId → label (for labeled rendering of field-backed nodes). */
  fieldLabels?: Record<string, string>;
  /** fieldId → kind (§4 — image-kind fields must never render as text). */
  fieldKinds?: Record<string, TemplateFieldType>;
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

/**
 * Node types that bind to the current file to produce content (§3/§4).
 * NOTE: an `image` node with `style.imageSource === 'fileAttachments'`
 * also requires file context — check `nodeNeedsFileContext()` instead of
 * this set when the node is known.
 */
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

/** Does this node need a file context to render? (§8 unified image) */
export function nodeNeedsFileContext(node: TemplateNode): boolean {
  if (node.type === 'image') return node.style?.imageSource === 'fileAttachments';
  return FILE_CONTEXT_NODES.has(node.type);
}

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
      return 'A heading (H1–H3). Bind it to a field (e.g. Task Title) or use tokens like {fileName}.';
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
      return 'An image — pick one from the library, bind it to an image field, or show the images attached to the current file.';
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

/** Section type metadata (§19 — starting structures). */
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
  return { kind: 'node', node: { id: genLayoutId('n'), type, ...extra } };
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
  return { kind: 'block', block };
}

/** SECTION_TYPE_PRESETS — §19 "Section type describes the general content
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

/**
 * §26 hardening — section types are DATA (persisted, imported, hand-edited).
 * An unknown/legacy type string must degrade to an empty custom section,
 * never crash a render or the reducer.
 */
export function sanitizeSectionType(type: string | undefined | null): SectionTypeId {
  return type && type in SECTION_TYPE_PRESETS
    ? (type as SectionTypeId)
    : 'custom';
}

/** Safe label/description lookup for persisted section types. */
export function sectionTypePreset(type: string | undefined | null): SectionTypePreset {
  return SECTION_TYPE_PRESETS[sanitizeSectionType(type)];
}

/** Create an empty section of the given type. */
export function createSection(
  type: SectionTypeId,
  name?: string,
): TemplateSection {
  const safeType = sanitizeSectionType(type);
  const preset = SECTION_TYPE_PRESETS[safeType];
  const built = preset.build();
  return {
    id: genLayoutId('sec'),
    name: name ?? preset.label,
    type: safeType,
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
    version: 3,
    createdAt: now,
    updatedAt: now,
    rootChildren: [{ kind: 'section', section: createSection('task', 'Task 01') }],
    fields: [],
  };
}

/**
 * Example template (onboarding §0). Demonstrates the §2 file layout: a
 * file-level title heading BEFORE the sections and a closing note + spacer
 * AFTER them — the interleaved structure that v2 could not represent.
 */
export function createExampleTemplate(): CustomLayoutTemplate {
  const now = Date.now();
  const taskTitle = field('Task Title', 'text', true);
  const taskDesc = field('Task Description', 'textarea');
  const output = field('Output', 'textarea');
  const screenshot = field('Screenshot', 'image', true);

  const codeBlock = createBlockDef('Code block', [
    { type: 'heading', text: '{fileName}', style: { level: 2 } },
    { type: 'description' },
    { type: 'file' },
    { type: 'note' },
    { type: 'image', style: { imageSource: 'fileAttachments' } },
  ]);

  const answerDesc = field('Description', 'textarea');
  const answer = field('Answer', 'textarea', true);

  return {
    id: genLayoutId('clt'),
    name: 'Example — Tasks & Answers',
    description:
      'A document title, two task sections (title + description + per-file code + screenshot) and a final answer section with a closing note. Assign your files to the Code block in the Layout editor.',
    version: 3,
    createdAt: now,
    updatedAt: now,
    fields: [],
    rootChildren: [
      // §2 — standalone node BEFORE the sections (document title).
      { kind: 'node', node: { id: genLayoutId('n'), type: 'heading', text: 'Tasks & Answers', style: { level: 1 } } },
      { kind: 'section', section: {
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
      } },
      { kind: 'section', section: {
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
      } },
      // §2 — standalone nodes AFTER the sections.
      { kind: 'node', node: { id: genLayoutId('n'), type: 'spacer', style: { heightPt: 18 } } },
      { kind: 'node', node: { id: genLayoutId('n'), type: 'panel', style: { fillColor: '#f5f5f5', borderColor: '#dddddd', paddingPt: 8 }, children: [[
        { id: genLayoutId('n'), type: 'text', text: 'End of document — generated with Codice.' },
      ]] } },
    ],
  };
}

/** Deep-clone any template-shaped value (no shared references). */
export function cloneTemplate<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/* ------------------------------------------------------------------ */
/* Template accessors (rootChildren is the single source of truth)      */
/* ------------------------------------------------------------------ */

/** The template's sections, in canonical root order. */
export function templateSections(template: CustomLayoutTemplate): TemplateSection[] {
  const out: TemplateSection[] = [];
  for (const child of template.rootChildren) {
    if (child.kind === 'section') out.push(child.section);
  }
  return out;
}

/** The template's FILE-LEVEL standalone nodes, in canonical root order. */
export function templateRootNodes(template: CustomLayoutTemplate): TemplateNode[] {
  const out: TemplateNode[] = [];
  for (const child of template.rootChildren) {
    if (child.kind === 'node') out.push(child.node);
  }
  return out;
}

/** Stable React key / identity for a root child (§13 — stable IDs). */
export function rootChildKey(child: RootChild): string {
  return child.kind === 'node' ? child.node.id : child.section.id;
}

/** Stable React key / identity for a section child. */
export function sectionChildKey(child: SectionChild): string {
  return child.kind === 'node' ? child.node.id : child.block.id;
}

/** Iterate every block definition of a template (all sections). */
export function forEachBlockDef(
  template: CustomLayoutTemplate,
  fn: (block: TemplateBlockDef, section: TemplateSection) => void,
): void {
  for (const section of templateSections(template)) {
    for (const child of section.children) {
      if (child.kind === 'block') fn(child.block, section);
    }
  }
}

/** All block definitions of a template (in document order). */
export function allBlockDefs(template: CustomLayoutTemplate): TemplateBlockDef[] {
  const out: TemplateBlockDef[] = [];
  forEachBlockDef(template, (block) => out.push(block));
  return out;
}

/** Find the section + block a file is assigned to (one-file-one-section, §5). */
export function findFileAssignment(
  template: CustomLayoutTemplate,
  assignments: Record<string, string[]>,
  fileId: string,
): { section: TemplateSection; block: TemplateBlockDef } | null {
  for (const section of templateSections(template)) {
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

/**
 * Drop assignment entries for blocks that no longer exist in the template
 * (§10 — deleting a block must clean up its data references). Files freed
 * this way return to the unassigned tray.
 */
export function pruneAssignments(
  template: CustomLayoutTemplate,
  assignments: Record<string, string[]>,
): Record<string, string[]> {
  const valid = new Set(allBlockDefs(template).map((b) => b.id));
  const next: Record<string, string[]> = {};
  for (const [blockId, ids] of Object.entries(assignments)) {
    if (!valid.has(blockId)) continue;
    next[blockId] = ids;
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* Field derivation — content is the single source of truth (§20)       */
/* ------------------------------------------------------------------ */

/**
 * Collect the field ids referenced by a template node tree (field-backed
 * nodes), depth-first. Container children are visited too.
 */
export function nodeFieldIds(node: TemplateNode): string[] {
  const out: string[] = [];
  if (node.fieldId) out.push(node.fieldId);
  for (const stack of node.children ?? []) {
    for (const child of stack) out.push(...nodeFieldIds(child));
  }
  return out;
}

function fieldsForIds(
  idsInOrder: string[],
  definitions: TemplateFieldDefinition[] | undefined,
): TemplateFieldDefinition[] {
  const byId = new Map((definitions ?? []).map((f) => [f.id, f]));
  const out: TemplateFieldDefinition[] = [];
  for (const id of idsInOrder) {
    const existing = byId.get(id);
    out.push(existing ?? { id, label: 'Field', kind: 'text', required: false });
  }
  return out;
}

/**
 * Field ids used by a section's STANDALONE content, in content order (§6).
 * This is the authoritative ordering — the Section Fields settings are
 * DERIVED from it.
 */
export function sectionFieldIdsInContentOrder(section: TemplateSection): string[] {
  const out: string[] = [];
  for (const child of section.children) {
    if (child.kind === 'node') out.push(...nodeFieldIds(child.node));
    // Block children bind to BLOCK fields (per-file) — never to the
    // section's own field list, so they contribute nothing here.
  }
  return [...new Set(out)];
}

/**
 * The section's field definitions, ordered to match the Section Content
 * structure (§6/§20). Fields referenced by content but missing a
 * definition are synthesized so the content always has settings;
 * unreferenced definitions (orphans created by older builds or repeated
 * type seeds) are dropped.
 */
export function sectionFieldsInContentOrder(section: TemplateSection): TemplateFieldDefinition[] {
  return fieldsForIds(sectionFieldIdsInContentOrder(section), section.fields);
}
/**
 * Field ids used by a block's node pattern, in pattern order — the block's
 * field list is DERIVED from its content (v3: same rule as sections, §20).
 * Section-scope fields referenced by block nodes are NOT block fields —
 * they live on the section (checked via the section's own derivation).
 */
export function blockFieldIdsInContentOrder(
  block: TemplateBlockDef,
  sectionFieldIds: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const n of block.nodes) {
    for (const id of nodeFieldIds(n)) {
      if (sectionFieldIds.has(id)) continue;
      out.push(id);
    }
  }
  return [...new Set(out)];
}

/**
 * The block's field definitions, ordered to match the block pattern.
 * `sectionFieldIds` (from sectionFieldIdsInContentOrder) identifies ids
 * that belong to the owning section's scope so cross-scope bindings are
 * not mistaken for block fields.
 */
export function blockFieldsInContentOrder(
  block: TemplateBlockDef,
  sectionFieldIds: ReadonlySet<string>,
): TemplateFieldDefinition[] {
  return fieldsForIds(blockFieldIdsInContentOrder(block, sectionFieldIds), block.fields);
}

/**
 * Normalize a v3 template (returns a new object). THE central invariant
 * keeper — runs on load, on import, and on every save/update:
 *
 *   - every node (and container descendant) has a stable id (§13/§26),
 *   - the FILE-level `fields` are synchronized with root node bindings,
 *   - every section's field list is synchronized with its content
 *     (no orphans, no accidental duplicates, content order wins — §6/§20),
 *   - every block's field list is synchronized with its pattern the same
 *     way (v3 correction — block fields can no longer drift),
 *   - bindings pointing at deleted fields are STRIPPED (§10/§11 — a
 *     deleted node/field immediately stops being a binding target),
 *   - legacy `fileImages` nodes migrate to the unified Image primitive
 *     with imageSource='fileAttachments' (§8),
 *   - unknown section types degrade to 'custom' (§26).
 */
export function normalizeTemplate(t: CustomLayoutTemplate): CustomLayoutTemplate {
  const next = cloneTemplate(t);
  next.version = 3;
  if (!Array.isArray(next.rootChildren)) next.rootChildren = [];
  if (!Array.isArray(next.fields)) next.fields = [];

  const migrateImageNode = (node: TemplateNode): void => {
    if (node.type === 'fileImages') {
      // §8 — one Image primitive; the legacy type is a data-source marker.
      node.type = 'image';
      node.style = { ...(node.style ?? {}), imageSource: 'fileAttachments' };
    }
  };

  const ensureIds = (node: TemplateNode): void => {
    if (!node.id) node.id = genLayoutId('n');
    migrateImageNode(node);
    for (const stack of node.children ?? []) {
      for (const child of stack) ensureIds(child);
    }
  };

  // --- FILE level -----------------------------------------------------
  for (const child of next.rootChildren) {
    if (child.kind === 'node') ensureIds(child.node);
  }
  next.fields = fieldsForIds(
    [...new Set(next.rootChildren.flatMap((c) => (c.kind === 'node' ? nodeFieldIds(c.node) : [])))],
    next.fields,
  );

  // --- SECTION level --------------------------------------------------
  for (const child of next.rootChildren) {
    if (child.kind !== 'section') continue;
    const section = child.section;
    if (!Array.isArray(section.children)) section.children = [];
    if (!Array.isArray(section.fields)) section.fields = [];
    for (const secChild of section.children) {
      if (secChild.kind === 'node') ensureIds(secChild.node);
      else {
        if (!Array.isArray(secChild.block.nodes)) secChild.block.nodes = [];
        if (!Array.isArray(secChild.block.fields)) secChild.block.fields = [];
        for (const n of secChild.block.nodes) ensureIds(n);
      }
    }
    section.type = sanitizeSectionType(section.type);

    // §6/§20 — content is authoritative; rebuild the field list from it.
    section.fields = sectionFieldsInContentOrder(section);
    const sectionFieldIdSet = new Set(section.fields.map((f) => f.id));

    // Blocks: derive fields from the pattern (v3 §20 correction)…
    for (const secChild of section.children) {
      if (secChild.kind !== 'block') continue;
      secChild.block.fields = blockFieldsInContentOrder(secChild.block, sectionFieldIdSet);
    }

    // …then strip dangling bindings (§10/§11): any fieldId that is neither
    // a section field nor a field of the enclosing block no longer exists.
    const blockFieldIds = new Set<string>();
    for (const secChild of section.children) {
      if (secChild.kind === 'block') {
        for (const f of secChild.block.fields) blockFieldIds.add(f.id);
      }
    }
    const validIds = new Set([...sectionFieldIdSet, ...blockFieldIds]);
    const stripDangling = (node: TemplateNode): void => {
      if (node.fieldId && !validIds.has(node.fieldId)) delete node.fieldId;
      for (const stack of node.children ?? []) {
        for (const child of stack) stripDangling(child);
      }
    };
    for (const secChild of section.children) {
      if (secChild.kind === 'node') stripDangling(secChild.node);
      else for (const n of secChild.block.nodes) stripDangling(n);
    }
  }

  return next;
}

/**
 * Append a preset structure ONCE for one explicit user action (§19). Fields
 * merge by id (no phantom duplicates when the same preset is applied
 * twice) and the built content children are appended to the section.
 */
export function appendSectionPreset(
  section: TemplateSection,
  type: SectionTypeId,
): void {
  const safeType = sanitizeSectionType(type);
  const built = SECTION_TYPE_PRESETS[safeType].build();
  section.type = safeType;
  const existing = new Set(section.fields.map((f) => f.id));
  section.fields.push(...built.fields.filter((f) => !existing.has(f.id)));
  section.children.push(...built.children);
}

/** Create a field-bound content node pair (§5/§6): the field definition
 * plus a node bound to it, added together so content and settings stay in
 * sync by construction. */
export function createBoundFieldNode(
  kind: TemplateFieldType,
  label: string,
  nodeType: 'text' | 'heading' | 'image',
  nodeExtra: Partial<TemplateNode> = {},
): { field: TemplateFieldDefinition; node: TemplateNode } {
  const f: TemplateFieldDefinition = {
    id: genLayoutId('fld'),
    label,
    kind,
    required: false,
  };
  const node: TemplateNode = { id: genLayoutId('n'), type: nodeType, fieldId: f.id, ...nodeExtra };
  return { field: f, node };
}

/* ------------------------------------------------------------------ */
/* Migration (§53 — never silently destroy old templates)               */
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
 * Migrate a legacy v1 template into the v3 hierarchy. The old flat block
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
        section.children.push({ kind: 'node', node: migrateNode(b) });
      }
    } else {
      // Field-backed non-file nodes: keep as section content bound to the
      // same field id (now a section field).
      section.children.push({ kind: 'node', node: migrateNode(b) });
    }
  }

  if (fileNodes.length > 0) {
    const blockFields = (v1.fields ?? []).filter((f) => blockFieldIds.has(f.id));
    section.children.push({
      kind: 'block',
      block: {
        id: genLayoutId('blk'),
        name: 'Files',
        fields: cloneTemplate(blockFields),
        nodes: fileNodes,
      },
    });
  }

  return normalizeTemplate({
    id: v1.id || genLayoutId('clt'),
    name: v1.name ?? 'Migrated layout',
    description: v1.description ?? '',
    version: 3,
    createdAt: v1.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    rootChildren: [{ kind: 'section', section }],
    fields: [],
  });
}

/**
 * Migrate a v2 template into the v3 root-children model. v2 rendered
 * file-level children BEFORE all sections, so the migration preserves that
 * exact order (file nodes first, then sections) — existing documents keep
 * rendering identically, but the user can now reorder freely.
 */
export function migrateTemplateV2(v2: CustomLayoutTemplateV2): CustomLayoutTemplate {
  const rootChildren: RootChild[] = [];
  // v2 file-level standalone nodes came first.
  for (const child of v2.children ?? []) {
    if (child.kind === 'node') rootChildren.push({ kind: 'node', node: migrateNode(child.node) });
    // v2 file-level BLOCKS were silently dropped by the v2 resolver and
    // are not representable at file level (§2) — they stay dropped here.
  }
  for (const section of v2.sections) {
    const migrated: TemplateSection = {
      ...cloneTemplate(section),
      type: sanitizeSectionType(section.type),
      children: section.children.map((child) =>
        child.kind === 'node'
          ? { kind: 'node' as const, node: migrateNode(child.node) }
          : { kind: 'block' as const, block: cloneTemplate(child.block) },
      ),
    };
    rootChildren.push({ kind: 'section', section: migrated });
  }
  return normalizeTemplate({
    id: v2.id || genLayoutId('clt'),
    name: v2.name ?? 'Migrated layout',
    description: v2.description ?? '',
    version: 3,
    createdAt: v2.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    rootChildren,
    fields: [],
  });
}

/** Normalize any stored/imported template into the current v3 shape. */
export function ensureTemplateV3(
  t: CustomLayoutTemplate | CustomLayoutTemplateV2 | CustomLayoutTemplateV1,
): CustomLayoutTemplate {
  const version = (t as { version?: number }).version;
  if (version === 3 && Array.isArray((t as CustomLayoutTemplate).rootChildren)) {
    return normalizeTemplate(t as CustomLayoutTemplate);
  }
  if (version === 2 || Array.isArray((t as CustomLayoutTemplateV2).sections)) {
    return migrateTemplateV2(t as CustomLayoutTemplateV2);
  }
  if (
    Array.isArray((t as CustomLayoutTemplateV1).blocks) &&
    Array.isArray((t as CustomLayoutTemplateV1).fields)
  ) {
    return migrateTemplateV1(t as CustomLayoutTemplateV1);
  }
  // Unknown shape — degrade to an empty template rather than crash.
  return createEmptyTemplate('Imported layout');
}

/** @legacy alias kept for older call sites. */
export const ensureTemplateV2 = ensureTemplateV3;

/* ------------------------------------------------------------------ */
/* Duplication (§39 — section/block duplicate with fresh identity)      */
/* ------------------------------------------------------------------ */

/** Deep-clone a node tree with fresh ids (node + descendants). */
function cloneNodeFresh(node: TemplateNode): TemplateNode {
  const copy = cloneTemplate(node);
  copy.id = genLayoutId('n');
  for (const stack of copy.children ?? []) {
    for (const child of stack) {
      const fresh = cloneNodeFresh(child);
      Object.assign(child, fresh);
    }
  }
  return copy;
}

/**
 * Duplicate a BLOCK definition with fresh ids (§39). File assignments are
 * keyed by block id, so the copy starts UNASSIGNED — the user picks files
 * for it explicitly (never implicit re-assignment).
 */
export function duplicateBlockDef(block: TemplateBlockDef): TemplateBlockDef {
  const fieldIdMap = new Map<string, string>();
  const fields = cloneTemplate(block.fields).map((f) => {
    const id = genLayoutId('fld');
    fieldIdMap.set(f.id, id);
    return { ...f, id };
  });
  const remap = (node: TemplateNode): TemplateNode => {
    const copy = cloneNodeFresh(node);
    if (copy.fieldId && fieldIdMap.has(copy.fieldId)) copy.fieldId = fieldIdMap.get(copy.fieldId);
    for (const stack of copy.children ?? []) {
      for (const child of stack) remap(child);
    }
    return copy;
  };
  return {
    id: genLayoutId('blk'),
    name: `${block.name} (copy)`,
    fields,
    nodes: block.nodes.map(remap),
  };
}

/**
 * Duplicate a SECTION (§39): fresh section/field/node ids, same structure.
 * Field VALUES live in app state keyed by section id, so the copy starts
 * with empty values.
 */
export function duplicateSection(section: TemplateSection): TemplateSection {
  const copy = cloneTemplate(section);
  copy.id = genLayoutId('sec');
  copy.name = `${section.name} (copy)`;
  const fieldIdMap = new Map<string, string>();
  copy.fields = section.fields.map((f) => {
    const id = genLayoutId('fld');
    fieldIdMap.set(f.id, id);
    return { ...f, id };
  });
  const remapNode = (node: TemplateNode): TemplateNode => {
    node.id = genLayoutId('n');
    if (node.fieldId && fieldIdMap.has(node.fieldId)) {
      node.fieldId = fieldIdMap.get(node.fieldId);
    }
    for (const stack of node.children ?? []) {
      for (const child of stack) remapNode(child);
    }
    return node;
  };
  for (const child of copy.children) {
    if (child.kind === 'node') {
      remapNode(child.node);
    } else {
      // §39 — block duplicates start unassigned (assignments key by block id).
      child.block = duplicateBlockDef(child.block);
    }
  }
  return copy;
}
