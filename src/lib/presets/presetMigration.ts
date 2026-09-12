/**
 * Default values for the new DocumentPreset fields added in v2.
 *
 * Used to migrate v1 presets (which lack the new fields) to v2 by filling
 * in sensible defaults for any missing properties.
 */

import type {
  CodeBlockStyle,
  DocumentPreset,
  FileHeaderStyle,
  HeadingStyle,
  LayoutDensity,
  PageBreakBehavior,
  ProjectHeaderStyle,
  ProjectStructureStyle,
  TitlePageStyle,
  TypographyStyle,
} from './documentPreset';

/** Default layout density values. */
export const DEFAULT_LAYOUT_DENSITY: LayoutDensity = {
  bodyParagraphSpacingPt: 6,
  bodyLineSpacing: 1.4,
  sectionSpacingPt: 16,
  codeBlockSpacingBeforePt: 4,
  codeBlockSpacingAfterPt: 8,
  headingSpacingBeforePt: 12,
  headingSpacingAfterPt: 6,
  titlePageVerticalOffsetPt: 100,
  fileHeaderSpacingPt: 6,
  projectHeaderSpacingBeforePt: 12,
  projectHeaderSpacingAfterPt: 6,
};

/** Default page-break behavior. */
export const DEFAULT_PAGE_BREAK_BEHAVIOR: PageBreakBehavior = {
  afterTitlePage: true,
  beforeProject: true,
  beforeFile: true,
  beforeH1: false,
};

/** Default project structure style. */
export const DEFAULT_PROJECT_STRUCTURE: ProjectStructureStyle = {
  enabled: true,
  font: 'JetBrains Mono',
  fontSizePt: 8,
  color: '#59636e',
  lineHeight: 1.3,
  indentPerLevelPt: 12,
  showFileSizes: false,
  dirsFirst: true,
};

/** Default misc options. */
export const DEFAULT_MISC = {
  includeToc: true,
  includeProjectStructure: true,
  pageBreakBetweenFiles: true,
  numberHeadings: true,
  showFileMetadata: true,
};

/**
 * Migrate a possibly-v1 preset to the v2 shape by filling in defaults
 * for any missing fields. This makes old saved presets still loadable.
 */
export function migratePreset(raw: Partial<DocumentPreset>): DocumentPreset {
  const layout: LayoutDensity = { ...DEFAULT_LAYOUT_DENSITY, ...(raw.layout ?? {}) };
  const pageBreaks: PageBreakBehavior = { ...DEFAULT_PAGE_BREAK_BEHAVIOR, ...(raw.pageBreaks ?? {}) };
  const projectStructure: ProjectStructureStyle = {
    ...DEFAULT_PROJECT_STRUCTURE,
    ...(raw.projectStructure ?? {}),
    // Sync with legacy field if present.
    enabled: raw.projectStructure?.enabled ?? raw.includeProjectStructure ?? true,
  };
  const misc = {
    ...DEFAULT_MISC,
    ...(raw.misc ?? {}),
    // Sync legacy fields.
    includeToc: raw.misc?.includeToc ?? raw.includeToc ?? true,
    includeProjectStructure:
      raw.misc?.includeProjectStructure ?? raw.includeProjectStructure ?? true,
    pageBreakBetweenFiles:
      raw.misc?.pageBreakBetweenFiles ?? raw.pageBreakBetweenFiles ?? true,
  };

  // Migrate code block — add new fields with defaults.
  const code = raw.code ? migrateCodeBlock(raw.code) : migrateCodeBlock({} as any);

  // Migrate headings — add new fields with defaults.
  const headings = raw.headings
    ? {
        title: migrateHeading(raw.headings.title),
        h1: migrateHeading(raw.headings.h1),
        h2: migrateHeading(raw.headings.h2),
        h3: migrateHeading(raw.headings.h3),
        h4: migrateHeading(raw.headings.h4),
      }
    : {
        title: migrateHeading({} as any),
        h1: migrateHeading({} as any),
        h2: migrateHeading({} as any),
        h3: migrateHeading({} as any),
        h4: migrateHeading({} as any),
      };

  // Migrate typography — add bodyWeight.
  const typography: TypographyStyle = {
    bodyFont: raw.typography?.bodyFont ?? 'Inter',
    bodyFontSizePt: raw.typography?.bodyFontSizePt ?? 11,
    bodyColor: raw.typography?.bodyColor ?? '#1f2328',
    bodyWeight: raw.typography?.bodyWeight ?? 'normal',
    paragraphSpacingPt: raw.typography?.paragraphSpacingPt ?? 6,
    lineSpacing: raw.typography?.lineSpacing ?? 1.4,
  };

  // Migrate file headers — add spacingAfterPt.
  const fileHeaders: FileHeaderStyle = raw.fileHeaders
    ? { ...raw.fileHeaders, spacingAfterPt: raw.fileHeaders.spacingAfterPt ?? 6 }
    : ({} as any);

  // Migrate project headers — add alignment.
  const projectHeaders: ProjectHeaderStyle = raw.projectHeaders
    ? { ...raw.projectHeaders, alignment: raw.projectHeaders.alignment ?? 'left' }
    : ({} as any);

  // Migrate title page — add alignment + verticalOffsetPt.
  const titlePage: TitlePageStyle = raw.titlePage
    ? {
        ...raw.titlePage,
        alignment: raw.titlePage.alignment ?? 'center',
        verticalOffsetPt: raw.titlePage.verticalOffsetPt ?? 100,
      }
    : ({} as any);

  return {
    id: raw.id ?? '',
    name: raw.name ?? 'Preset',
    description: raw.description ?? '',
    builtIn: raw.builtIn ?? false,
    syntaxTheme: raw.syntaxTheme ?? 'github-dark',
    page: raw.page ?? ({} as any),
    layout,
    pageBreaks,
    typography,
    headings,
    code,
    fileHeaders,
    projectHeaders,
    projectStructure,
    titlePage,
    colors: raw.colors ?? ({} as any),
    misc,
    metadata: raw.metadata,
    // Legacy fields kept in sync.
    includeToc: misc.includeToc,
    includeProjectStructure: misc.includeProjectStructure,
    pageBreakBetweenFiles: misc.pageBreakBetweenFiles,
  };
}

/** Migrate a CodeBlockStyle, adding new v2 fields with defaults. */
function migrateCodeBlock(c: Partial<CodeBlockStyle>): CodeBlockStyle {
  // Determine borderStyle: if borderColor is null/empty, treat as 'none'.
  const hasNoBorder = !c.borderColor;
  return {
    font: c.font ?? 'JetBrains Mono',
    fontSizePt: c.fontSizePt ?? 9,
    fontWeight: c.fontWeight ?? 'normal',
    lineHeight: c.lineHeight ?? 1.25,
    textColor: c.textColor ?? '#24292e',
    backgroundColor: c.backgroundColor ?? '#f6f8fa',
    useSyntaxThemeBackground: c.useSyntaxThemeBackground ?? true,
    borderStyle: c.borderStyle ?? (hasNoBorder ? 'none' : 'solid'),
    borderColor: c.borderColor ?? '#d0d7de',
    borderWidthPt: c.borderWidthPt ?? 0.5,
    borderRadiusPt: c.borderRadiusPt ?? 0,
    paddingPt: c.paddingPt ?? 8,
    showLineNumbers: c.showLineNumbers ?? true,
    lineNumberColor: c.lineNumberColor ?? '#9198a1',
    lineNumberBackground: c.lineNumberBackground ?? null,
    lineNumberWidthChars: c.lineNumberWidthChars ?? 0,
    wrapLongLines: c.wrapLongLines ?? true,
    blockSpacingBeforePt: c.blockSpacingBeforePt ?? 4,
    blockSpacingAfterPt: c.blockSpacingAfterPt ?? 8,
  };
}

/** Migrate a HeadingStyle, adding new v2 fields with defaults. */
function migrateHeading(h: Partial<HeadingStyle> | undefined): HeadingStyle {
  return {
    font: h?.font ?? 'Inter',
    sizePt: h?.sizePt ?? 14,
    weight: h?.weight ?? 'bold',
    italic: h?.italic ?? false,
    color: h?.color ?? '#0f172a',
    alignment: h?.alignment ?? 'left',
    spaceBeforePt: h?.spaceBeforePt ?? 8,
    spaceAfterPt: h?.spaceAfterPt ?? 4,
    numbered: h?.numbered ?? false,
    lineHeight: h?.lineHeight ?? 1.3,
    indentPt: h?.indentPt ?? 0,
    keepWithNext: h?.keepWithNext ?? true,
    pageBreakBefore: h?.pageBreakBefore ?? false,
  };
}
