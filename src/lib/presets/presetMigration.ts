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
  FooterSlotType,
  HeadingStyle,
  LayoutDensity,
  PageBreakBehavior,
  PageStyle,
  ProjectHeaderStyle,
  ProjectStructureStyle,
  TocStyle,
  TitlePageStyle,
  TypographyStyle,
  HeaderFooterLayout,
  VerticalAlignment,
  Alignment,
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

/** Default table-of-contents page alignment (spec §4). */
export const DEFAULT_TOC_STYLE: TocStyle = {
  horizontalAlignment: 'left',
  verticalAlignment: 'top',
};

/** Default document color palette (light). */
export const DEFAULT_DOCUMENT_COLORS = {
  background: '#ffffff',
  surface: '#f6f8fa',
  primaryText: '#1f2328',
  secondaryText: '#59636e',
  mutedText: '#818b98',
  accent: '#0969da',
  headings: '#0f172a',
  borders: '#d0d7de',
  codeBackground: '#f6f8fa',
  codeText: '#24292e',
  codeHeader: '#586069',
  codeBorder: '#d0d7de',
  lineNumbers: '#9198a1',
  links: '#0969da',
  success: '#1a7f37',
  warning: '#9a6700',
  error: '#cf222e',
  panelFill: '#f6f8fa',
  panelBorder: '#d0d7de',
  panelText: '#1f2328',
};

const HEADER_FOOTER_LAYOUTS: HeaderFooterLayout[] = ['single', 'dual', 'triple'];
const VERTICAL_ALIGNMENTS: VerticalAlignment[] = ['top', 'center', 'bottom'];
const ALIGNMENTS: Alignment[] = ['left', 'center', 'right'];
const FOOTER_SLOT_TYPES: FooterSlotType[] = [
  'none', 'text', 'pageNumber', 'pageCount', 'linesOnPage', 'fileName', 'projectName', 'date',
];

function safeEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Migrate the page style, adding the structured header/footer layout fields.
 *
 * Legacy presets only carry the single-string `pageHeader` / `pageFooter`
 * templates. They are converted into the structured slots so the new layout
 * controls (single / dual / triple) can edit them without losing data:
 *   pageHeader text → headerCenter (single layout, right-aligned like before)
 *   pageFooter text → footerCenter = 'text' with the template preserved
 */
export function migratePageStyle(raw: Partial<PageStyle> | undefined): PageStyle {
  const p: Partial<PageStyle> = raw ?? {};
  const legacyHeaderProvided = p.pageHeader !== undefined;
  const legacyHeader =
    legacyHeaderProvided && p.pageHeader ? p.pageHeader : null;
  const legacyFooterProvided = p.pageFooter !== undefined;
  const legacyFooter =
    legacyFooterProvided && p.pageFooter ? p.pageFooter : null;

  const structuredHeaderPresent =
    p.pageHeaderShow !== undefined || p.pageHeaderLeft !== undefined || p.pageHeaderCenter !== undefined;
  const structuredFooterPresent =
    p.pageFooterShow !== undefined || p.pageFooterLeft !== undefined || p.pageFooterCenter !== undefined;

  // A legacy string explicitly re-set on an already-structured preset turns
  // the corresponding header/footer back on — but ONLY when the structured
  // fields are absent or the legacy key is unambiguously authoritative
  // (single layout, center slot not explicitly a non-text slot).
  const headerTurnedOnByLegacy =
    legacyHeaderProvided &&
    legacyHeader !== null &&
    (!structuredHeaderPresent ||
      (p.pageHeaderCenter == null && (p.pageHeaderLayout ?? 'single') === 'single'));
  const footerTurnedOnByLegacy =
    legacyFooterProvided &&
    legacyFooter !== null &&
    (!structuredFooterPresent ||
      (p.pageFooterCenter == null && (p.pageFooterLayout ?? 'single') === 'single'));

  const pageHeaderShow = headerTurnedOnByLegacy
    ? true
    : (p.pageHeaderShow ?? (structuredHeaderPresent ? false : legacyHeader !== null));
  const pageFooterShow = footerTurnedOnByLegacy
    ? true
    : (p.pageFooterShow ?? (structuredFooterPresent ? false : legacyFooter !== null));

  const pageHeaderCenter = headerTurnedOnByLegacy
    ? legacyHeader
    : p.pageHeaderCenter !== undefined
      ? p.pageHeaderCenter
      : legacyHeader;
  const pageHeaderLeft = p.pageHeaderLeft ?? null;
  const pageHeaderRight = p.pageHeaderRight ?? null;

  const pageFooterCenter = footerTurnedOnByLegacy
    ? 'text'
    : p.pageFooterCenter ?? (legacyFooter !== null && !structuredFooterPresent ? 'text' : 'pageNumber');
  const pageFooterText = footerTurnedOnByLegacy
    ? legacyFooter
    : p.pageFooterText !== undefined
      ? p.pageFooterText
      : legacyFooter;

  const pageHeaderLayoutOut = safeEnum(p.pageHeaderLayout, HEADER_FOOTER_LAYOUTS, 'single');
  const pageFooterLayoutOut = safeEnum(p.pageFooterLayout, HEADER_FOOTER_LAYOUTS, 'single');
  const pageFooterCenterOut = safeEnum(pageFooterCenter, FOOTER_SLOT_TYPES, 'pageNumber');

  return {
    size: p.size ?? 'A4',
    landscape: p.landscape ?? false,
    marginTopMm: p.marginTopMm ?? 25,
    marginRightMm: p.marginRightMm ?? 20,
    marginBottomMm: p.marginBottomMm ?? 25,
    marginLeftMm: p.marginLeftMm ?? 25,
    headerSpacingMm: p.headerSpacingMm ?? 10,
    footerSpacingMm: p.footerSpacingMm ?? 10,
    // Legacy strings kept in sync so older code paths keep working. Only
    // emitted when they faithfully describe the structured state.
    pageHeader:
      pageHeaderShow && pageHeaderLayoutOut === 'single'
        ? (pageHeaderCenter ?? pageHeaderLeft ?? pageHeaderRight)
        : null,
    pageFooter:
      pageFooterShow && pageFooterCenterOut === 'text' ? (pageFooterText ?? '') : null,
    pageHeaderShow,
    pageHeaderLayout: pageHeaderLayoutOut,
    pageHeaderAlign: safeEnum(p.pageHeaderAlign, ALIGNMENTS, 'right'),
    pageHeaderLeft,
    pageHeaderCenter,
    pageHeaderRight,
    pageFooterShow,
    pageFooterLayout: pageFooterLayoutOut,
    pageFooterAlign: safeEnum(p.pageFooterAlign, ALIGNMENTS, 'center'),
    pageFooterLeft: safeEnum(p.pageFooterLeft, FOOTER_SLOT_TYPES, 'none'),
    pageFooterCenter: pageFooterCenterOut,
    pageFooterRight: safeEnum(p.pageFooterRight, FOOTER_SLOT_TYPES, 'none'),
    pageFooterText,
  };
}

/**
 * Loose input shape accepted by migratePreset: every field optional, and the
 * `page` / `titlePage` sub-objects may themselves be partial (older preset
 * versions lack the newer members).
 */
export type PresetInput = {
  [K in keyof DocumentPreset]?: K extends 'page'
    ? Partial<PageStyle>
    : K extends 'titlePage'
      ? Partial<TitlePageStyle>
      : K extends 'toc'
        ? Partial<TocStyle>
        : DocumentPreset[K];
};

/**
 * Migrate a possibly-v1 preset to the v2 shape by filling in defaults
 * for any missing fields. This makes old saved presets still loadable.
 */
export function migratePreset(raw: PresetInput): DocumentPreset {
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

  // Migrate title page — add alignment + verticalOffsetPt + verticalAlignment.
  const titlePage: TitlePageStyle = {
    enabled: raw.titlePage?.enabled ?? true,
    showTitle: raw.titlePage?.showTitle ?? true,
    showSubtitle: raw.titlePage?.showSubtitle ?? false,
    showAuthor: raw.titlePage?.showAuthor ?? false,
    showCourse: raw.titlePage?.showCourse ?? false,
    showUniversity: raw.titlePage?.showUniversity ?? false,
    showDate: raw.titlePage?.showDate ?? true,
    showVersion: raw.titlePage?.showVersion ?? false,
    showDescription: raw.titlePage?.showDescription ?? false,
    alignment: raw.titlePage?.alignment ?? 'center',
    verticalOffsetPt: raw.titlePage?.verticalOffsetPt ?? 100,
    verticalAlignment: safeEnum(raw.titlePage?.verticalAlignment, VERTICAL_ALIGNMENTS, 'top'),
  };

  // Migrate the TOC page style (spec §4) — older presets lack it entirely.
  const toc: TocStyle = {
    horizontalAlignment: safeEnum(raw.toc?.horizontalAlignment, ALIGNMENTS, DEFAULT_TOC_STYLE.horizontalAlignment),
    verticalAlignment: safeEnum(raw.toc?.verticalAlignment, VERTICAL_ALIGNMENTS, DEFAULT_TOC_STYLE.verticalAlignment),
  };

  return {
    id: raw.id ?? '',
    name: raw.name ?? 'Preset',
    description: raw.description ?? '',
    builtIn: raw.builtIn ?? false,
    syntaxTheme: raw.syntaxTheme ?? 'github-dark',
    page: migratePageStyle(raw.page),
    layout,
    pageBreaks,
    typography,
    headings,
    code,
    fileHeaders,
    projectHeaders,
    projectStructure,
    titlePage,
    toc,
    colors: { ...DEFAULT_DOCUMENT_COLORS, ...(raw.colors ?? {}) },
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
  const rawBorder = c.borderStyle ?? (hasNoBorder ? 'none' : 'solid');
  // Validate — older presets only knew 'none' | 'solid'; accept the new
  // dotted / dashed values as well.
  const borderStyle = (['none', 'solid', 'dotted', 'dashed'] as const).includes(
    rawBorder as any,
  )
    ? (rawBorder as CodeBlockStyle['borderStyle'])
    : 'none';
  return {
    font: c.font ?? 'JetBrains Mono',
    fontSizePt: c.fontSizePt ?? 9,
    fontWeight: c.fontWeight ?? 'normal',
    lineHeight: c.lineHeight ?? 1.25,
    textColor: c.textColor ?? '#24292e',
    backgroundColor: c.backgroundColor ?? '#f6f8fa',
    useSyntaxThemeBackground: c.useSyntaxThemeBackground ?? true,
    borderStyle,
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
