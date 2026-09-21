/**
 * Core domain types for Codice.
 *
 * The pipeline is:
 *   ProjectFolder -> DiscoveredFile -> SelectedFile -> HighlightedFile
 *                                                       -> DocumentModel
 *                                                       -> ExporterOutput
 */

import type { ResolvedLayoutBlock } from '@/lib/customLayouts/model';

/** A single detected file inside an uploaded project folder. */
export interface DiscoveredFile {
  /** Stable id unique within a project. */
  id: string;
  /** Project id this file belongs to. */
  projectId: string;
  /** Path relative to the project root, using forward slashes. */
  relativePath: string;
  /** Just the file name (no directory). */
  name: string;
  /** Directory portion of relativePath, or '' if at root. */
  directory: string;
  /** File size in bytes. */
  size: number;
  /** Detected language id (e.g. 'java', 'typescript') or null. */
  language: string | null;
  /** True if the file is a config/project file rather than source. */
  isConfig: boolean;
  /** True if the file looks binary. */
  binary: boolean;
  /** True if the file was excluded by a rule (still shown in tree). */
  excluded: boolean;
  /** Reason for exclusion, if any. */
  exclusionReason?: string;
  /** File object from input (may be undefined for synthetic entries). */
  fileHandle?: FileHandle;
}

/** Minimal handle that abstracts File / FileSystemFileHandle. */
export interface FileHandle {
  /** Read the file as text. Throws if binary or unreadable. */
  getText(): Promise<string>;
  /** Original File object if available. */
  readonly file?: File;
}

/** A project that the user added. */
export interface ProjectEntry {
  id: string;
  /** Display label shown in UI; defaults to folder name. */
  label: string;
  /** Original folder name from upload. */
  folderName: string;
  /** All discovered files (including excluded). */
  files: DiscoveredFile[];
  /** Count of selected files (cached). */
  selectedCount: number;
  /** Total size of selected files. */
  selectedSize: number;
  /** Warnings produced during scan. */
  warnings: ScanWarning[];
  /** When the project was added. */
  addedAt: number;
}

export interface ScanWarning {
  severity: 'info' | 'warn' | 'error';
  message: string;
  filePath?: string;
}

/** A token produced by the syntax highlighter. */
export interface HighlightToken {
  /** 0-based offset in the source line. */
  start: number;
  /** Length of the token. */
  length: number;
  /** Shiki / TextMate scope name, e.g. "entity.name.function". */
  scopes: string[];
  /** Resolved CSS color string for this token, e.g. "#56b6c2". */
  color?: string;
  /** Optional font style flags. */
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/** One line of highlighted code. */
export interface HighlightedLine {
  /** 1-based line number. */
  lineNumber: number;
  /** Tokens for this line. Tokens are non-overlapping and sorted by offset. */
  tokens: HighlightToken[];
  /** Original (un-tokenized) text of the line. */
  text: string;
}

/** A file whose content has been loaded and highlighted. */
export interface HighlightedFile {
  fileId: string;
  relativePath: string;
  language: string | null;
  lines: HighlightedLine[];
  /** True if the file was loaded but encoding detection was needed. */
  encodingFallbackUsed?: boolean;
}

/** Document-wide configuration controlling presentation. */
export interface DocumentOptions {
  /** Page size, e.g. "A4", "Letter". */
  pageSize: PageSize;
  /** Landscape orientation (useful for wide code). */
  landscape: boolean;
  /** Margins in millimetres. */
  margins: { top: number; right: number; bottom: number; left: number };
  /** Code block background colour (hex). */
  codeBackground: string;
  /** Code block border colour (hex) or null for none. */
  codeBorderColor: string | null;
  /** Code block border width in points. */
  codeBorderWidth: number;
  /** Code block padding in points. */
  codePadding: number;
  /** Code font family. */
  codeFont: string;
  /** Code font size in points. */
  codeFontSize: number;
  /** Code line height multiplier (1.0 = single). */
  codeLineHeight: number;
  /** Heading font family. */
  headingFont: string;
  /** Body font family. */
  bodyFont: string;
  /** Body font size in points. */
  bodyFontSize: number;
  /** Whether to show line numbers. */
  showLineNumbers: boolean;
  /** Whether to show file headers (path/language/size). */
  showFileHeaders: boolean;
  /** Whether to insert a page break before each file. */
  pageBreakBetweenFiles: boolean;
  /** Whether to include a table of contents. */
  includeToc: boolean;
  /** Whether to include a front matter (title) page. */
  includeFrontMatter: boolean;
  /** Whether to wrap long lines instead of clipping. */
  wrapLongLines: boolean;
  /** Show project structure tree in the document. */
  includeProjectStructure: boolean;
  /** Text color for the project structure tree (optional — exporters fall back). */
  projectStructureColor?: string;
  /** Syntax theme name. */
  syntaxTheme: string;
  /** Header text on every page (or null). */
  pageHeader: string | null;
  /** Footer template; supports {page} and {pages}. */
  pageFooter: string | null;
  // ---- Structured header/footer layout (optional for backward compat) ----
  /** Header zone height (mm) — positions the header within the top margin. */
  headerSpacingMm?: number;
  /** Footer zone height (mm) — positions the footer within the bottom margin. */
  footerSpacingMm?: number;
  /** Whether the structured header is shown at all. */
  pageHeaderShow?: boolean;
  /** Header layout preset: how many regions are rendered. */
  pageHeaderLayout?: 'single' | 'dual' | 'triple';
  /** Horizontal alignment of the header in single mode. */
  pageHeaderAlign?: 'left' | 'center' | 'right';
  pageHeaderLeft?: string | null;
  pageHeaderCenter?: string | null;
  pageHeaderRight?: string | null;
  /** Footer layout preset: how many regions are rendered. */
  pageFooterShow?: boolean;
  pageFooterLayout?: 'single' | 'dual' | 'triple';
  pageFooterAlign?: 'left' | 'center' | 'right';
  pageFooterLeft?: FooterSlotType;
  pageFooterCenter?: FooterSlotType;
  pageFooterRight?: FooterSlotType;
  /** Free text used by footer 'text' slots (tokens expanded at render). */
  pageFooterText?: string | null;
  /** Code block border style when a border is enabled. */
  codeBorderStyle?: 'solid' | 'dotted' | 'dashed';
  // ---- File-header independence (spec §5) ----
  /** Show the bare file name (independent of the relative path). */
  showFileName?: boolean;
  /** Show the relative path (independent of the file name). */
  showRelativePath?: boolean;
  showLanguageLabel?: boolean;
  showFileSize?: boolean;
  showLineCount?: boolean;
  showFileHeaderBold?: boolean;
  // ---- Title-page layout (used by PDF / DOCX / ODT front matter) ----
  titlePageVerticalAlignment?: 'top' | 'center' | 'bottom';
  titlePageVerticalOffsetPt?: number;
  /** Horizontal alignment applied to the WHOLE title-page group (spec §9). */
  titlePageHorizontalAlignment?: 'left' | 'center' | 'right';
  /** Show file metadata inside the table of contents. */
  showFileMetadata?: boolean;
  // ---- Table-of-contents page alignment (spec §4) ----
  /** Horizontal alignment of the TOC content group. */
  tocHorizontalAlignment?: 'left' | 'center' | 'right';
  /** Vertical alignment of the TOC content group within its page. */
  tocVerticalAlignment?: 'top' | 'center' | 'bottom';
  // ---- Document color semantics (spec §5) — exporters fall back to their
  // historical fixed colors when these are absent. ----
  /** Primary body text color (hex). */
  bodyColor?: string;
  /** Secondary/metadata text color (hex). */
  secondaryColor?: string;
  /** Heading text color (hex). */
  headingColor?: string;
  // ---- Panel theme defaults (§25) — layout panels without their own
  // style fall back to these. ----
  /** Panel fill/background color (hex). */
  panelFillColor?: string;
  /** Panel border color (hex). */
  panelBorderColor?: string;
  /** Panel default text color (hex). */
  panelTextColor?: string;
}

/** Structured footer slot content type. */
export type FooterSlotType =
  | 'none'
  | 'text'
  | 'pageNumber'
  | 'pageCount'
  | 'linesOnPage'
  | 'fileName'
  | 'projectName'
  | 'date';

/** Code block border style (also used by preview). */
export type CodeBorderStyle = 'solid' | 'dotted' | 'dashed';

export type PageSize = 'A4' | 'Letter' | 'Legal' | 'A3';

/** Optional front matter / metadata. */
export interface DocumentMetadata {
  title?: string;
  /** Subtitle shown on the title page (independent of course/description). */
  subtitle?: string;
  author?: string;
  course?: string;
  university?: string;
  date?: string;
  description?: string;
  version?: string;
}

/**
 * User-defined per-file documentation details (spec §6/§8).
 *
 * Rendered semantically around the file's code block:
 *   Description → BEFORE the code block
 *   Summary     → AFTER the code block
 *   Note        → AFTER the code block (below Summary)
 *
 * Stored PER FILE — never shared between files (duplicate filenames in
 * different directories stay independent).
 */
export interface FileDetails {
  /** Shown before the code block. */
  description?: string;
  /** Shown after the code block. */
  summary?: string;
  /** Shown after the code block, below the summary. */
  note?: string;
}

/** True when a details object has no user content. */
export function fileDetailsIsEmpty(details: FileDetails | undefined): boolean {
  if (!details) return true;
  return !details.description?.trim() && !details.summary?.trim() && !details.note?.trim();
}

/**
 * A user-provided image asset (spec §10/§11).
 *
 * The image is stored as a self-contained data URL so exports embed the
 * real pixels — never a temporary browser blob URL that dies before the
 * exporter runs. Uploads are normalized to PNG/JPEG at import time so all
 * three exporters can embed them.
 */
export interface ImageAsset {
  id: string;
  /** Original file name (kept for labels/captions). */
  name: string;
  /** Self-contained data URL (data:image/png;base64,...). */
  dataUrl: string;
  /** MIME type of the NORMALIZED data ("image/png" | "image/jpeg"). */
  mime: 'image/png' | 'image/jpeg';
  /** Natural width in px (after normalization). */
  width: number;
  /** Natural height in px (after normalization). */
  height: number;
  /** Approximate byte size of the data URL payload. */
  sizeBytes: number;
  /** Optional caption/label rendered below the image. */
  caption?: string;
  addedAt: number;
}

/** One file entry in the document model. */
export interface DocumentFile {
  projectId: string;
  projectLabel: string;
  relativePath: string;
  language: string | null;
  highlighted: HighlightedFile;
  sizeBytes: number;
  /** User-defined per-file documentation details (spec §6/§9). */
  details?: FileDetails;
  /** Resolved image assets attached to this file, in attachment order (spec §10/§12). */
  images?: DocumentImage[];
}

/**
 * An image attached to a document file, fully resolved for exporters —
 * the pixel data travels INSIDE the document model so no exporter needs
 * access to the asset registry.
 */
export interface DocumentImage {
  /** ImageAsset id (for stable keys). */
  id: string;
  name: string;
  /** Self-contained data URL. */
  dataUrl: string;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  caption?: string;
}

/** One project section in the document model. */
export interface DocumentProject {
  id: string;
  label: string;
  folderName: string;
  files: DocumentFile[];
  /** Relative paths of all selected files, used for the structure tree. */
  structurePaths: string[];
}

/** Top-level document model passed to exporters. */
export interface DocumentModel {
  metadata: DocumentMetadata;
  options: DocumentOptions;
  projects: DocumentProject[];
  generatedAt: string;
  /**
   * Resolved custom layout content (spec §16-§35). Present only when a
   * custom layout template is applied; exporters render these content
   * blocks INSTEAD of the standard per-file flow. The blocks carry all
   * resolved text/image data — exporters never see the template engine.
   */
  customLayout?: ResolvedCustomLayout;
}

/**
 * A fully-resolved custom-layout content stream (spec §32): the template's
 * block sequence expanded per repeat target with every field value, file
 * reference and image already resolved. One canonical representation
 * consumed by the preview AND all three exporters.
 */
export interface ResolvedCustomLayout {
  /** Template id + name (for provenance/debugging). */
  templateId: string;
  templateName: string;
  blocks: ResolvedLayoutBlock[];
}

/** Re-exported so consumers of the document model can stay on one import. */
export type {
  ResolvedLayoutBlock,
  ResolvedTextProps,
} from '@/lib/customLayouts/model';

/** Exporter options. */
export interface ExportOptions {
  format: 'docx' | 'pdf' | 'odt';
  /** Filename (without extension). */
  filename: string;
  /**
   * Imported cover page to prepend as the FIRST page (§42): the DOCX
   * exporter splices it in as-is via OOXML, the PDF exporter flow-renders
   * it (text, basic formatting, images — best effort), and the ODT
   * exporter flow-renders it (same shared parser as the PDF path). When a
   * cover cannot be rendered the exporter reports `coverSkipped` and the
   * UI warns.
   */
  cover?: CoverPageAsset;
}

/** Result of an export operation. */
export interface ExportResult {
  blob: Blob;
  filename: string;
  format: 'docx' | 'pdf' | 'odt';
  /** Time taken in milliseconds. */
  elapsedMs: number;
  /**
   * True when a cover page was REQUESTED (ExportOptions.cover) but could
   * not be rendered, so the export fell back to no cover page (§42 PDF
   * best-effort path). The UI warns the user for that export.
   */
  coverSkipped?: boolean;
}

/** Theme definition (syntax colors + mappings). */
export interface SyntaxTheme {
  id: string;
  label: string;
  /** Whether this is a dark theme. */
  dark: boolean;
  /** Default background color. */
  background: string;
  /** Default foreground color. */
  foreground: string;
  /** Shiki theme name to load. */
  shikiTheme: string;
}

/** A preset that configures DocumentOptions + metadata + theme together. */
export interface Preset {
  id: string;
  label: string;
  description: string;
  options: Partial<DocumentOptions>;
  metadata?: Partial<DocumentMetadata>;
  syntaxTheme?: string;
  builtIn?: boolean;
}

/** Selection state for a single file (selected or not). */
export interface FileSelection {
  fileId: string;
  selected: boolean;
}

/**
 * An explicit export group (§11): a named, ordered set of projects that
 * exports together as ONE document. A project may participate in any
 * number of groups; combined + separate-per-project modes coexist.
 *
 * v3 multi-export model (§22-§29): each export document may ALSO carry its
 * own layout template and its own first-page configuration (title page vs.
 * imported cover page) — the group is the per-export configuration record.
 */
export interface ExportGroup {
  id: string;
  name: string;
  /** Ordered project ids — the document contains exactly these projects. */
  projectIds: string[];
  /**
   * Per-export layout template id (§27). `undefined`/`null` = use the
   * globally applied layout. Only meaningful when "same layout for all
   * exports" is disabled — otherwise the shared layout wins.
   */
  layoutId?: string | null;
  /**
   * First-page mode for this export (§43):
   *   - 'preset' — follow the style preset's title-page setting (default)
   *   - 'title'  — force the generated title page on
   *   - 'cover'  — prepend the imported cover page (coverId), no title page
   */
  firstPage?: 'preset' | 'title' | 'cover';
  /** Cover page asset id when firstPage === 'cover'. */
  coverId?: string;
  /**
   * Per-export output filename override (R12). When set, the generated
   * document is named after this pattern (with `{title}` = global export
   * filename, `{group}` = the group name, `{date}` = today) instead of the
   * default `{globalFilename}_{groupName}`. Empty/undefined = default.
   */
  filename?: string;
}

/**
 * An imported cover page (§42): the FIRST PAGE of a user-provided .docx,
 * preserved as-is (raw OOXML + referenced media) so the DOCX exporter can
 * splice it in front of the generated document without reconstructing its
 * layout, fonts, shapes or positioning.
 *
 * Cover assets are session-scoped (like image uploads) — the raw bytes are
 * kept in memory only.
 */
export interface CoverPageAsset {
  id: string;
  /** Display name (defaults to the uploaded file name). */
  name: string;
  /** Original uploaded file name. */
  fileName: string;
  addedAt: number;
  /** True when the source document had multiple pages (only page 1 kept). */
  truncated: boolean;
  /**
   * The cover page's <w:body> inner XML (first page only, already cut at
   * the first page-break marker) with relationship ids left intact.
   */
  bodyXml: string;
  /** Media parts referenced by the page, keyed by the ORIGINAL rel id. */
  media: Array<{ relId: string; partPath: string; bytes: Uint8Array }>;
  /** Relationship entries (id → target) referenced by the page. */
  rels: Array<{ id: string; target: string; type: string }>;
  /** Style ids used by the page (w:pStyle/w:rStyle w:val values). */
  styleIds: string[];
  /** Numbering ids used by the page (w:numId values). */
  numberingIds: string[];
  /** Raw style definitions (inner XML of the source styles.xml). */
  stylesInner: string;
  /** Raw numbering definitions (inner XML of the source numbering.xml). */
  numberingInner: string;
  /** Page count of the source document (informational). */
  pageCount: number;

  /**
   * Namespace declarations (prefix → URI) from the SOURCE document's root
   * element. The cover body references prefixed elements (wp:, a:, pic:, …)
   * whose declarations live on the source root — the DOCX splice re-declares
   * the ones the target document root is missing, otherwise the merged
   * document.xml is not namespace-well-formed. Optional: assets imported
   * before this capture fall back to a well-known OOXML URI map.
   */
  namespaces?: Array<{ prefix: string; uri: string }>;

  /* ------------------------------------------------------------------ */
  /* Page geometry (§42 — captured from the source's first w:sectPr so   */
  /* PDF exports can size the cover page as authored). All fields are    */
  /* OPTIONAL and best-effort: assets imported before this capture (or   */
  /* documents without a sectPr) simply leave them undefined.            */
  /* ------------------------------------------------------------------ */

  /** Page width in millimetres (w:pgSz w:w). */
  pageWidthMm?: number;
  /** Page height in millimetres (w:pgSz w:h). */
  pageHeightMm?: number;
  /** Top margin in millimetres (w:pgMar w:top). */
  marginTopMm?: number;
  /** Right margin in millimetres (w:pgMar w:right). */
  marginRightMm?: number;
  /** Bottom margin in millimetres (w:pgMar w:bottom). */
  marginBottomMm?: number;
  /** Left margin in millimetres (w:pgMar w:left). */
  marginLeftMm?: number;
}
