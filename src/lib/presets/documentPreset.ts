/**
 * Document preset / template model.
 *
 * This is the single source of truth for how a generated document looks.
 * All three exporters (DOCX, PDF, ODT) consume the same `DocumentPreset`
 * so a style change does not require touching three independent systems.
 *
 * The preset is split into logical sections matching the Template
 * Customizer UI: page, typography, headings, code, fileHeaders,
 * projectHeaders, titlePage, colors, projectStructure, misc.
 *
 * Version 2 adds: heading line height / indentation / keepWithNext /
 * pageBreakBefore, page layout density controls, project structure
 * styling, code useSyntaxThemeBackground, and misc document options.
 */

import type { DocumentMetadata } from '@/types';

export type PageSize = 'A4' | 'Letter' | 'Legal' | 'A3';
export type FontFamily = string;
export type FontWeight = 'normal' | 'medium' | 'semibold' | 'bold';
export type Alignment = 'left' | 'center' | 'right';

/** Layout preset for page headers/footers: how many regions are rendered. */
export type HeaderFooterLayout = 'single' | 'dual' | 'triple';

/** Vertical alignment of under-filled isolated pages. */
export type VerticalAlignment = 'top' | 'center' | 'bottom';

/** Structured content type for a footer slot. */
export type FooterSlotType =
  | 'none'
  | 'text'
  | 'pageNumber'
  | 'pageCount'
  | 'linesOnPage'
  | 'fileName'
  | 'projectName'
  | 'date';

export interface PageStyle {
  size: PageSize;
  landscape: boolean;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  headerSpacingMm: number;
  footerSpacingMm: number;
  /** @deprecated legacy single-string header — kept for preset compat. */
  pageHeader: string | null;
  /** @deprecated legacy single-string footer — kept for preset compat. */
  pageFooter: string | null;
  // ---- Structured header ----
  pageHeaderShow: boolean;
  pageHeaderLayout: HeaderFooterLayout;
  /** Horizontal alignment used in 'single' layout mode. */
  pageHeaderAlign: Alignment;
  pageHeaderLeft: string | null;
  pageHeaderCenter: string | null;
  pageHeaderRight: string | null;
  // ---- Structured footer ----
  pageFooterShow: boolean;
  pageFooterLayout: HeaderFooterLayout;
  pageFooterAlign: Alignment;
  pageFooterLeft: FooterSlotType;
  pageFooterCenter: FooterSlotType;
  pageFooterRight: FooterSlotType;
  /** Free text used by footer slots of type 'text'. Supports {page} {pages} {lines} {fileName} {projectName} {date} {title} tokens. */
  pageFooterText: string | null;
}

/** Document density / spacing controls. */
export interface LayoutDensity {
  /** Body paragraph spacing (pt). */
  bodyParagraphSpacingPt: number;
  /** Body line spacing multiplier. */
  bodyLineSpacing: number;
  /** Section spacing (pt) — between major sections. */
  sectionSpacingPt: number;
  /** Code block spacing before (pt). */
  codeBlockSpacingBeforePt: number;
  /** Code block spacing after (pt). */
  codeBlockSpacingAfterPt: number;
  /** Default heading spacing before (pt). */
  headingSpacingBeforePt: number;
  /** Default heading spacing after (pt). */
  headingSpacingAfterPt: number;
  /** Title page vertical offset (pt) — pushes title down from top. */
  titlePageVerticalOffsetPt: number;
  /** File header spacing (pt) — space between header and code. */
  fileHeaderSpacingPt: number;
  /** Project header spacing before (pt). */
  projectHeaderSpacingBeforePt: number;
  /** Project header spacing after (pt). */
  projectHeaderSpacingAfterPt: number;
}

/** Page-break behavior controls. */
export interface PageBreakBehavior {
  /** Insert a page break after the title page. */
  afterTitlePage: boolean;
  /** Insert a page break before each project section. */
  beforeProject: boolean;
  /** Insert a page break before each file. */
  beforeFile: boolean;
  /** Insert a page break before each H1 (where supported). */
  beforeH1: boolean;
}

export interface TypographyStyle {
  bodyFont: FontFamily;
  bodyFontSizePt: number;
  bodyColor: string;
  bodyWeight: FontWeight;
  paragraphSpacingPt: number;
  lineSpacing: number;
}

export interface HeadingStyle {
  font: FontFamily;
  sizePt: number;
  weight: FontWeight;
  italic: boolean;
  color: string;
  alignment: Alignment;
  spaceBeforePt: number;
  spaceAfterPt: number;
  numbered: boolean;
  /** Line height multiplier for this heading. */
  lineHeight: number;
  /** Indentation in points. */
  indentPt: number;
  /** Keep this heading on the same page as the next content (where supported). */
  keepWithNext: boolean;
  /** Force a page break before this heading (where supported). */
  pageBreakBefore: boolean;
}

export interface HeadingStyles {
  title: HeadingStyle;
  h1: HeadingStyle;
  h2: HeadingStyle;
  h3: HeadingStyle;
  h4: HeadingStyle;
}

export interface CodeBlockStyle {
  font: FontFamily;
  fontSizePt: number;
  fontWeight: FontWeight;
  lineHeight: number;
  textColor: string;
  backgroundColor: string;
  /**
   * If true, the code block background comes from the selected Shiki syntax
   * theme (overrides `backgroundColor`). If false, the custom `backgroundColor`
   * is used.
   */
  useSyntaxThemeBackground: boolean;
  /**
   * Border style. 'none' completely disables the border; when enabled the
   * style is one of solid / dotted / dashed (no 'None' option in the UI —
   * disabling is done via the enable checkbox).
   */
  borderStyle: 'none' | 'solid' | 'dotted' | 'dashed';
  borderColor: string | null;
  borderWidthPt: number;
  borderRadiusPt: number;
  paddingPt: number;
  showLineNumbers: boolean;
  lineNumberColor: string;
  lineNumberBackground: string | null;
  /** Width of the line-number column in characters (0 = auto). */
  lineNumberWidthChars: number;
  wrapLongLines: boolean;
  blockSpacingBeforePt: number;
  blockSpacingAfterPt: number;
}

export interface FileHeaderStyle {
  show: boolean;
  showFileName: boolean;
  showRelativePath: boolean;
  showLanguageLabel: boolean;
  showFileSize: boolean;
  showLineCount: boolean;
  background: string;
  textColor: string;
  borderBottom: boolean;
  borderColor: string;
  font: FontFamily;
  fontSizePt: number;
  bold: boolean;
  /** Spacing between the header and the code block (pt). */
  spacingAfterPt: number;
}

export interface ProjectHeaderStyle {
  showTitle: boolean;
  showPath: boolean;
  showMetadata: boolean;
  font: FontFamily;
  sizePt: number;
  weight: FontWeight;
  color: string;
  spaceBeforePt: number;
  spaceAfterPt: number;
  uppercase: boolean;
  alignment: Alignment;
}

/** Project structure tree styling. */
export interface ProjectStructureStyle {
  /** Whether to include the project structure tree in the document. */
  enabled: boolean;
  /** Font for the tree. */
  font: FontFamily;
  /** Font size (pt). */
  fontSizePt: number;
  /** Text color. */
  color: string;
  /** Line height. */
  lineHeight: number;
  /** Indentation per depth level (pt). */
  indentPerLevelPt: number;
  /** Show file sizes next to files. */
  showFileSizes: boolean;
  /** Sort directories first (true) or interleave (false). */
  dirsFirst: boolean;
}

export interface TitlePageStyle {
  enabled: boolean;
  showTitle: boolean;
  showSubtitle: boolean;
  showAuthor: boolean;
  showCourse: boolean;
  showUniversity: boolean;
  showDate: boolean;
  showVersion: boolean;
  showDescription: boolean;
  /** Alignment of title-page content (horizontal). */
  alignment: Alignment;
  /** Vertical offset from top (pt). */
  verticalOffsetPt: number;
  /** Vertical alignment of under-filled isolated pages (title, TOC, project intro). */
  verticalAlignment: VerticalAlignment;
}

export interface DocumentColors {
  background: string;
  surface: string;
  primaryText: string;
  secondaryText: string;
  mutedText: string;
  accent: string;
  headings: string;
  borders: string;
  codeBackground: string;
  codeText: string;
  codeHeader: string;
  codeBorder: string;
  lineNumbers: string;
  links: string;
  success: string;
  warning: string;
  error: string;
}

/** Miscellaneous document options that don't fit elsewhere. */
export interface MiscDocumentOptions {
  /** Include a table of contents. */
  includeToc: boolean;
  /** Include a project structure tree (legacy — also in ProjectStructureStyle.enabled). */
  includeProjectStructure: boolean;
  /** Page break between files (legacy — also in PageBreakBehavior.beforeFile). */
  pageBreakBetweenFiles: boolean;
  /** Number heading sections (1, 1.1, 1.1.1, …). */
  numberHeadings: boolean;
  /** Show file metadata in headers. */
  showFileMetadata: boolean;
}

export interface DocumentPreset {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  /** Shiki syntax theme id. */
  syntaxTheme: string;
  page: PageStyle;
  /** Document density / spacing controls. */
  layout: LayoutDensity;
  /** Page-break behavior. */
  pageBreaks: PageBreakBehavior;
  typography: TypographyStyle;
  headings: HeadingStyles;
  code: CodeBlockStyle;
  fileHeaders: FileHeaderStyle;
  projectHeaders: ProjectHeaderStyle;
  projectStructure: ProjectStructureStyle;
  titlePage: TitlePageStyle;
  colors: DocumentColors;
  misc: MiscDocumentOptions;
  /** Default metadata to apply when this preset is selected. */
  metadata?: Partial<DocumentMetadata>;
  // Legacy fields kept for backward-compat with presetToOptions:
  includeToc: boolean;
  includeProjectStructure: boolean;
  pageBreakBetweenFiles: boolean;
}

/** Shape used when exporting a preset to JSON. */
export interface DocumentPresetExport {
  version: 2;
  exportedAt: string;
  name: string;
  description: string;
  syntaxTheme: string;
  page: PageStyle;
  layout: LayoutDensity;
  pageBreaks: PageBreakBehavior;
  typography: TypographyStyle;
  headings: HeadingStyles;
  code: CodeBlockStyle;
  fileHeaders: FileHeaderStyle;
  projectHeaders: ProjectHeaderStyle;
  projectStructure: ProjectStructureStyle;
  titlePage: TitlePageStyle;
  colors: DocumentColors;
  misc: MiscDocumentOptions;
  metadata?: Partial<DocumentMetadata>;
}
