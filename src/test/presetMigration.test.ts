import { describe, expect, it } from 'vitest';
import { migratePreset } from '../lib/presets/presetMigration';
import { getBuiltInPreset } from '../lib/presets/builtInPresets';
import type { DocumentPreset } from '../lib/presets/documentPreset';

describe('preset v1 → v2 migration', () => {
  it('migrates a v1 preset (no layout/pageBreaks/misc fields) by filling defaults', () => {
    // Simulate a v1 preset — no layout, pageBreaks, projectStructure, misc.
    // Cast as any because the v1 shape doesn't have the new v2 fields.
    const v1Preset: any = {
      id: 'test-v1',
      name: 'Test V1',
      description: 'A v1 preset',
      builtIn: false,
      syntaxTheme: 'github-light',
      page: {
        size: 'A4',
        landscape: false,
        marginTopMm: 20,
        marginRightMm: 20,
        marginBottomMm: 20,
        marginLeftMm: 20,
        headerSpacingMm: 8,
        footerSpacingMm: 8,
        pageHeader: null,
        pageFooter: 'Page {page}',
      },
      typography: {
        bodyFont: 'Inter',
        bodyFontSizePt: 11,
        bodyColor: '#1f2328',
        paragraphSpacingPt: 4,
        lineSpacing: 1.4,
      },
      headings: {
        title: { font: 'Inter', sizePt: 24, weight: 'bold', italic: false, color: '#000', alignment: 'center', spaceBeforePt: 0, spaceAfterPt: 12, numbered: false },
        h1: { font: 'Inter', sizePt: 18, weight: 'bold', italic: false, color: '#000', alignment: 'left', spaceBeforePt: 10, spaceAfterPt: 6, numbered: true },
        h2: { font: 'Inter', sizePt: 14, weight: 'bold', italic: false, color: '#000', alignment: 'left', spaceBeforePt: 8, spaceAfterPt: 4, numbered: true },
        h3: { font: 'Inter', sizePt: 12, weight: 'semibold', italic: false, color: '#000', alignment: 'left', spaceBeforePt: 6, spaceAfterPt: 3, numbered: true },
        h4: { font: 'Inter', sizePt: 11, weight: 'medium', italic: false, color: '#000', alignment: 'left', spaceBeforePt: 4, spaceAfterPt: 2, numbered: false },
      },
      code: {
        font: 'JetBrains Mono',
        fontSizePt: 9,
        lineHeight: 1.25,
        textColor: '#24292e',
        backgroundColor: '#f6f8fa',
        borderColor: '#d0d7de',
        borderWidthPt: 0.5,
        borderRadiusPt: 0,
        paddingPt: 8,
        showLineNumbers: true,
        lineNumberColor: '#999',
        lineNumberBackground: null,
        wrapLongLines: true,
        blockSpacingBeforePt: 4,
        blockSpacingAfterPt: 8,
      },
      fileHeaders: {
        show: true,
        showFileName: true,
        showRelativePath: true,
        showLanguageLabel: true,
        showFileSize: true,
        showLineCount: false,
        background: 'transparent',
        textColor: '#586069',
        borderBottom: true,
        borderColor: '#d0d7de',
        font: 'Courier New',
        fontSizePt: 8,
        bold: true,
      },
      projectHeaders: {
        showTitle: true,
        showPath: false,
        showMetadata: true,
        font: 'Inter',
        sizePt: 18,
        weight: 'bold',
        color: '#000',
        spaceBeforePt: 10,
        spaceAfterPt: 5,
        uppercase: false,
      },
      titlePage: {
        enabled: true,
        showTitle: true,
        showSubtitle: false,
        showAuthor: true,
        showCourse: true,
        showUniversity: true,
        showDate: true,
        showVersion: true,
        showDescription: true,
      },
      colors: {
        background: '#fff',
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
        lineNumbers: '#999',
        links: '#0969da',
        success: '#1a7f37',
        warning: '#9a6700',
        error: '#cf222e',
      },
      includeToc: true,
      includeProjectStructure: true,
      pageBreakBetweenFiles: true,
    };

    const migrated = migratePreset(v1Preset);

    // New v2 fields should be filled with defaults.
    expect(migrated.layout).toBeDefined();
    expect(migrated.layout.bodyLineSpacing).toBeGreaterThan(0);
    expect(migrated.pageBreaks).toBeDefined();
    expect(migrated.pageBreaks.afterTitlePage).toBe(true);
    expect(migrated.projectStructure).toBeDefined();
    expect(migrated.projectStructure.enabled).toBe(true);
    expect(migrated.misc).toBeDefined();
    expect(migrated.misc.includeToc).toBe(true);

    // New heading fields should be filled.
    expect(migrated.headings.h1.lineHeight).toBeGreaterThan(0);
    expect(migrated.headings.h1.indentPt).toBe(0);
    expect(migrated.headings.h1.keepWithNext).toBe(true);

    // New code fields should be filled.
    expect(migrated.code.useSyntaxThemeBackground).toBeDefined();
    expect(migrated.code.fontWeight).toBeDefined();
    expect(migrated.code.lineNumberWidthChars).toBe(0);

    // New typography fields.
    expect(migrated.typography.bodyWeight).toBeDefined();

    // New title page fields.
    expect(migrated.titlePage.alignment).toBeDefined();
    expect(migrated.titlePage.verticalOffsetPt).toBeGreaterThan(0);

    // New file header fields.
    expect(migrated.fileHeaders.spacingAfterPt).toBeGreaterThanOrEqual(0);

    // New project header fields.
    expect(migrated.projectHeaders.alignment).toBeDefined();
  });

  it('migratePreset preserves existing v2 fields', () => {
    const v2 = getBuiltInPreset('university')!;
    const migrated = migratePreset(v2);
    expect(migrated.layout.titlePageVerticalOffsetPt).toBe(
      v2.layout.titlePageVerticalOffsetPt,
    );
    expect(migrated.pageBreaks.beforeFile).toBe(v2.pageBreaks.beforeFile);
    expect(migrated.headings.h1.lineHeight).toBe(v2.headings.h1.lineHeight);
  });

  it('migratePreset syncs legacy fields with misc', () => {
    const v1: Partial<DocumentPreset> = {
      includeToc: false,
      includeProjectStructure: false,
      pageBreakBetweenFiles: false,
    };
    const migrated = migratePreset(v1);
    expect(migrated.misc.includeToc).toBe(false);
    expect(migrated.misc.includeProjectStructure).toBe(false);
    expect(migrated.misc.pageBreakBetweenFiles).toBe(false);
    expect(migrated.includeToc).toBe(false);
  });
});
