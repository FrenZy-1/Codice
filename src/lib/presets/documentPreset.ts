/**
 * Document preset / template model.
 *
 * This is the single source of truth for how a generated document looks.
 * All three exporters (DOCX, PDF, ODT) consume the same `DocumentPreset`
 * so a style change does not require touching three independent systems.
 *
 * The preset is split into logical sections matching the Template
 * Customizer UI: page, typography, headings, code, fileHeaders,
 * projectHeaders, titlePage, colors.
 */

import type { DocumentMetadata } from '@/types';

export type PageSize = 'A4' | 'Letter' | 'Legal' | 'A3';
export type FontFamily = string; // we keep this loose — the FontSelector enforces valid values

export interface PageStyle {
  size: PageSize;
  landscape: boolean;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  headerSpacingMm: number;
  footerSpacingMm: number;
  pageHeader: string | null;
  pageFooter: string | null;
}

export interface TypographyStyle {
  bodyFont: FontFamily;
  bodyFontSizePt: number;
  bodyColor: string;
  paragraphSpacingPt: number;
  lineSpacing: number;
}

export interface HeadingStyle {
  font: FontFamily;
  sizePt: number;
  weight: 'normal' | 'medium' | 'semibold' | 'bold';
  italic: boolean;
  color: string;
  alignment: 'left' | 'center' | 'right';
  spaceBeforePt: number;
  spaceAfterPt: number;
  numbered: boolean;
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
  lineHeight: number;
  textColor: string;
  backgroundColor: string;
  borderColor: string | null;
  borderWidthPt: number;
  borderRadiusPt: number;
  paddingPt: number;
  showLineNumbers: boolean;
  lineNumberColor: string;
  lineNumberBackground: string | null;
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
}

export interface ProjectHeaderStyle {
  showTitle: boolean;
  showPath: boolean;
  showMetadata: boolean;
  font: FontFamily;
  sizePt: number;
  weight: 'normal' | 'medium' | 'semibold' | 'bold';
  color: string;
  spaceBeforePt: number;
  spaceAfterPt: number;
  uppercase: boolean;
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

export interface DocumentPreset {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  syntaxTheme: string;
  page: PageStyle;
  typography: TypographyStyle;
  headings: HeadingStyles;
  code: CodeBlockStyle;
  fileHeaders: FileHeaderStyle;
  projectHeaders: ProjectHeaderStyle;
  titlePage: TitlePageStyle;
  colors: DocumentColors;
  /** Default metadata to apply when this preset is selected. */
  metadata?: Partial<DocumentMetadata>;
  /** Whether to include a TOC. */
  includeToc: boolean;
  /** Whether to include a project structure tree. */
  includeProjectStructure: boolean;
  /** Whether to insert a page break before each file. */
  pageBreakBetweenFiles: boolean;
}

export type DocumentPresetExport = Omit<DocumentPreset, 'id' | 'builtIn'> & {
  version: 1;
  exportedAt: string;
};
