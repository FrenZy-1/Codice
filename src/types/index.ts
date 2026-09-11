/**
 * Core domain types for Codice.
 *
 * The pipeline is:
 *   ProjectFolder -> DiscoveredFile -> SelectedFile -> HighlightedFile
 *                                                       -> DocumentModel
 *                                                       -> ExporterOutput
 */

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
  /** Syntax theme name. */
  syntaxTheme: string;
  /** Header text on every page (or null). */
  pageHeader: string | null;
  /** Footer template; supports {page} and {pages}. */
  pageFooter: string | null;
}

export type PageSize = 'A4' | 'Letter' | 'Legal' | 'A3';

/** Optional front matter / metadata. */
export interface DocumentMetadata {
  title?: string;
  author?: string;
  course?: string;
  university?: string;
  date?: string;
  description?: string;
  version?: string;
}

/** One file entry in the document model. */
export interface DocumentFile {
  projectId: string;
  projectLabel: string;
  relativePath: string;
  language: string | null;
  highlighted: HighlightedFile;
  sizeBytes: number;
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
}

/** Exporter options. */
export interface ExportOptions {
  format: 'docx' | 'pdf' | 'odt';
  /** Filename (without extension). */
  filename: string;
}

/** Result of an export operation. */
export interface ExportResult {
  blob: Blob;
  filename: string;
  format: 'docx' | 'pdf' | 'odt';
  /** Time taken in milliseconds. */
  elapsedMs: number;
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
