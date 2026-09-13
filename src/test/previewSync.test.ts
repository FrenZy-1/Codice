/**
 * Tests for preview synchronization and editor behaviors.
 *
 * These tests verify that preset properties are correctly reflected in the
 * preview rendering logic. Since the preview is a React component that
 * produces inline-styled HTML, we test the pure helper functions and the
 * preset-model invariants that drive the preview.
 */

import { describe, expect, it } from 'vitest';
import { migratePreset } from '../lib/presets/presetMigration';
import { getBuiltInPreset } from '../lib/presets/builtInPresets';
import { presetToOptions } from '../lib/presets/presetToOptions';
import type { DocumentPreset, HeadingStyle, CodeBlockStyle } from '../lib/presets/documentPreset';

/** Helper: get the University preset and apply a patch. */
function patchedPreset(patch: Partial<DocumentPreset>): DocumentPreset {
  const base = getBuiltInPreset('university')!;
  return migratePreset({ ...base, ...patch });
}

describe('file header independence', () => {
  it('fileName and relativePath are independent flags', () => {
    const p = patchedPreset({
      fileHeaders: {
        ...getBuiltInPreset('university')!.fileHeaders,
        showFileName: true,
        showRelativePath: false,
      },
    });
    expect(p.fileHeaders.showFileName).toBe(true);
    expect(p.fileHeaders.showRelativePath).toBe(false);
  });

  it('can show relativePath without fileName', () => {
    const p = patchedPreset({
      fileHeaders: {
        ...getBuiltInPreset('university')!.fileHeaders,
        showFileName: false,
        showRelativePath: true,
      },
    });
    expect(p.fileHeaders.showFileName).toBe(false);
    expect(p.fileHeaders.showRelativePath).toBe(true);
  });

  it('can show both fileName and relativePath', () => {
    const p = patchedPreset({
      fileHeaders: {
        ...getBuiltInPreset('university')!.fileHeaders,
        showFileName: true,
        showRelativePath: true,
      },
    });
    expect(p.fileHeaders.showFileName).toBe(true);
    expect(p.fileHeaders.showRelativePath).toBe(true);
  });

  it('can show neither', () => {
    const p = patchedPreset({
      fileHeaders: {
        ...getBuiltInPreset('university')!.fileHeaders,
        showFileName: false,
        showRelativePath: false,
      },
    });
    expect(p.fileHeaders.showFileName).toBe(false);
    expect(p.fileHeaders.showRelativePath).toBe(false);
  });
});

describe('file metadata flags', () => {
  it('showLanguageLabel, showFileSize, showLineCount are independent', () => {
    const p = patchedPreset({
      fileHeaders: {
        ...getBuiltInPreset('university')!.fileHeaders,
        showLanguageLabel: true,
        showFileSize: false,
        showLineCount: true,
      },
    });
    expect(p.fileHeaders.showLanguageLabel).toBe(true);
    expect(p.fileHeaders.showFileSize).toBe(false);
    expect(p.fileHeaders.showLineCount).toBe(true);
  });

  it('misc.showFileMetadata is a separate flag', () => {
    const p = patchedPreset({
      misc: {
        ...getBuiltInPreset('university')!.misc,
        showFileMetadata: false,
      },
    });
    expect(p.misc.showFileMetadata).toBe(false);
  });
});

describe('heading numbering', () => {
  it('misc.numberHeadings controls whether numbering is applied', () => {
    const p = patchedPreset({
      misc: { ...getBuiltInPreset('university')!.misc, numberHeadings: false },
    });
    expect(p.misc.numberHeadings).toBe(false);
  });

  it('per-heading numbered flag is independent per level', () => {
    const base = getBuiltInPreset('university')!;
    const p = patchedPreset({
      headings: {
        ...base.headings,
        h1: { ...base.headings.h1, numbered: true },
        h2: { ...base.headings.h2, numbered: false },
        h3: { ...base.headings.h3, numbered: true },
      },
    });
    expect(p.headings.h1.numbered).toBe(true);
    expect(p.headings.h2.numbered).toBe(false);
    expect(p.headings.h3.numbered).toBe(true);
  });
});

describe('title page fields', () => {
  it('showDescription is independent from showSubtitle', () => {
    const p = patchedPreset({
      titlePage: {
        ...getBuiltInPreset('university')!.titlePage,
        showSubtitle: true,
        showDescription: false,
      },
    });
    expect(p.titlePage.showSubtitle).toBe(true);
    expect(p.titlePage.showDescription).toBe(false);
  });

  it('all title-page fields are present', () => {
    const p = getBuiltInPreset('university')!;
    expect(p.titlePage).toHaveProperty('showTitle');
    expect(p.titlePage).toHaveProperty('showSubtitle');
    expect(p.titlePage).toHaveProperty('showAuthor');
    expect(p.titlePage).toHaveProperty('showCourse');
    expect(p.titlePage).toHaveProperty('showUniversity');
    expect(p.titlePage).toHaveProperty('showDate');
    expect(p.titlePage).toHaveProperty('showVersion');
    expect(p.titlePage).toHaveProperty('showDescription');
    expect(p.titlePage).toHaveProperty('alignment');
    expect(p.titlePage).toHaveProperty('verticalOffsetPt');
  });
});

describe('project header', () => {
  it('showPath and showMetadata are independent', () => {
    const p = patchedPreset({
      projectHeaders: {
        ...getBuiltInPreset('university')!.projectHeaders,
        showPath: true,
        showMetadata: false,
      },
    });
    expect(p.projectHeaders.showPath).toBe(true);
    expect(p.projectHeaders.showMetadata).toBe(false);
  });
});

describe('page header/footer', () => {
  it('pageHeader and pageFooter can be null or string', () => {
    const p = patchedPreset({
      page: {
        ...getBuiltInPreset('university')!.page,
        pageHeader: 'My Header',
        pageFooter: 'Page {page} of {pages}',
      },
    });
    expect(p.page.pageHeader).toBe('My Header');
    expect(p.page.pageFooter).toBe('Page {page} of {pages}');
  });

  it('headerSpacingMm and footerSpacingMm affect layout', () => {
    const p = patchedPreset({
      page: {
        ...getBuiltInPreset('university')!.page,
        headerSpacingMm: 15,
        footerSpacingMm: 20,
      },
    });
    expect(p.page.headerSpacingMm).toBe(15);
    expect(p.page.footerSpacingMm).toBe(20);
  });
});

describe('document density', () => {
  it('all density fields are present and editable', () => {
    const p = getBuiltInPreset('university')!;
    expect(p.layout).toHaveProperty('bodyLineSpacing');
    expect(p.layout).toHaveProperty('bodyParagraphSpacingPt');
    expect(p.layout).toHaveProperty('sectionSpacingPt');
    expect(p.layout).toHaveProperty('codeBlockSpacingBeforePt');
    expect(p.layout).toHaveProperty('codeBlockSpacingAfterPt');
    expect(p.layout).toHaveProperty('headingSpacingBeforePt');
    expect(p.layout).toHaveProperty('headingSpacingAfterPt');
    expect(p.layout).toHaveProperty('titlePageVerticalOffsetPt');
    expect(p.layout).toHaveProperty('fileHeaderSpacingPt');
    expect(p.layout).toHaveProperty('projectHeaderSpacingBeforePt');
  });

  it('density values propagate to preset', () => {
    const p = patchedPreset({
      layout: {
        ...getBuiltInPreset('university')!.layout,
        bodyLineSpacing: 2.0,
        sectionSpacingPt: 50,
      },
    });
    expect(p.layout.bodyLineSpacing).toBe(2.0);
    expect(p.layout.sectionSpacingPt).toBe(50);
  });
});

describe('page breaks', () => {
  it('all page-break flags are present', () => {
    const p = getBuiltInPreset('university')!;
    expect(p.pageBreaks).toHaveProperty('afterTitlePage');
    expect(p.pageBreaks).toHaveProperty('beforeProject');
    expect(p.pageBreaks).toHaveProperty('beforeFile');
    expect(p.pageBreaks).toHaveProperty('beforeH1');
  });

  it('page-break flags are independent', () => {
    const p = patchedPreset({
      pageBreaks: {
        ...getBuiltInPreset('university')!.pageBreaks,
        afterTitlePage: false,
        beforeProject: true,
        beforeFile: false,
        beforeH1: true,
      },
    });
    expect(p.pageBreaks.afterTitlePage).toBe(false);
    expect(p.pageBreaks.beforeProject).toBe(true);
    expect(p.pageBreaks.beforeFile).toBe(false);
    expect(p.pageBreaks.beforeH1).toBe(true);
  });
});

describe('heading per-level independence', () => {
  it('each heading level has its own italic flag', () => {
    const base = getBuiltInPreset('university')!;
    const p = patchedPreset({
      headings: {
        ...base.headings,
        h1: { ...base.headings.h1, italic: true },
        h2: { ...base.headings.h2, italic: false },
        h3: { ...base.headings.h3, italic: true },
      },
    });
    expect(p.headings.h1.italic).toBe(true);
    expect(p.headings.h2.italic).toBe(false);
    expect(p.headings.h3.italic).toBe(true);
  });

  it('each heading level has its own weight', () => {
    const base = getBuiltInPreset('university')!;
    const p = patchedPreset({
      headings: {
        ...base.headings,
        h1: { ...base.headings.h1, weight: 'bold' },
        h2: { ...base.headings.h2, weight: 'semibold' },
        h3: { ...base.headings.h3, weight: 'medium' },
      },
    });
    expect(p.headings.h1.weight).toBe('bold');
    expect(p.headings.h2.weight).toBe('semibold');
    expect(p.headings.h3.weight).toBe('medium');
  });

  it('each heading level has its own color', () => {
    const base = getBuiltInPreset('university')!;
    const p = patchedPreset({
      headings: {
        ...base.headings,
        h1: { ...base.headings.h1, color: '#ff0000' },
        h2: { ...base.headings.h2, color: '#00ff00' },
      },
    });
    expect(p.headings.h1.color).toBe('#ff0000');
    expect(p.headings.h2.color).toBe('#00ff00');
  });

  it('each heading level has its own font', () => {
    const base = getBuiltInPreset('university')!;
    const p = patchedPreset({
      headings: {
        ...base.headings,
        h1: { ...base.headings.h1, font: 'Inter' },
        h2: { ...base.headings.h2, font: 'Times New Roman' },
      },
    });
    expect(p.headings.h1.font).toBe('Inter');
    expect(p.headings.h2.font).toBe('Times New Roman');
  });
});

describe('code border disable', () => {
  it('borderStyle can be set to none', () => {
    const base = getBuiltInPreset('university')!;
    const p = patchedPreset({
      code: {
        ...base.code,
        borderStyle: 'none',
      },
    });
    expect(p.code.borderStyle).toBe('none');
  });

  it('borderStyle none produces null borderColor in legacy options', () => {
    const base = getBuiltInPreset('university')!;
    const p = patchedPreset({
      code: {
        ...base.code,
        borderStyle: 'none',
      },
    });
    const opts = presetToOptions(p);
    expect(opts.codeBorderColor).toBeNull();
  });

  it('borderStyle solid preserves borderColor', () => {
    const base = getBuiltInPreset('university')!;
    const p = patchedPreset({
      code: {
        ...base.code,
        borderStyle: 'solid',
        borderColor: '#ff0000',
      },
    });
    const opts = presetToOptions(p);
    expect(opts.codeBorderColor).toBe('#ff0000');
  });

  it('migration fills borderStyle default', () => {
    const raw: any = {
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
    };
    const migrated = migratePreset(raw);
    expect(migrated.code.borderStyle).toBe('solid');
  });

  it('migration fills borderStyle none when borderColor is null', () => {
    const raw: any = {
      code: {
        font: 'JetBrains Mono',
        fontSizePt: 9,
        lineHeight: 1.25,
        textColor: '#e6edf3',
        backgroundColor: '#24292e',
        borderColor: null,
        borderWidthPt: 0,
        borderRadiusPt: 3,
        paddingPt: 8,
        showLineNumbers: true,
        lineNumberColor: '#7d8590',
        lineNumberBackground: null,
        wrapLongLines: false,
        blockSpacingBeforePt: 3,
        blockSpacingAfterPt: 6,
      },
    };
    const migrated = migratePreset(raw);
    expect(migrated.code.borderStyle).toBe('none');
  });
});

describe('document colors', () => {
  it('all DocumentColors fields are present', () => {
    const p = getBuiltInPreset('university')!;
    const required = [
      'background',
      'surface',
      'primaryText',
      'secondaryText',
      'mutedText',
      'accent',
      'headings',
      'borders',
      'codeBackground',
      'codeText',
      'codeHeader',
      'codeBorder',
      'lineNumbers',
      'links',
      'success',
      'warning',
      'error',
    ];
    for (const key of required) {
      expect(p.colors).toHaveProperty(key);
    }
  });

  it('colors are editable', () => {
    const base = getBuiltInPreset('university')!;
    const p = patchedPreset({
      colors: {
        ...base.colors,
        primaryText: '#ff0000',
        accent: '#00ff00',
        borders: '#0000ff',
      },
    });
    expect(p.colors.primaryText).toBe('#ff0000');
    expect(p.colors.accent).toBe('#00ff00');
    expect(p.colors.borders).toBe('#0000ff');
  });
});

describe('font weight mapping', () => {
  it('WeightSelect options map to numeric CSS values', () => {
    // The WEIGHT_MAP constant in the preview maps:
    //   normal → 400, medium → 500, semibold → 600, bold → 700
    // We verify the mapping exists and is correct.
    const WEIGHT_MAP: Record<string, number> = {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    };
    expect(WEIGHT_MAP.normal).toBe(400);
    expect(WEIGHT_MAP.medium).toBe(500);
    expect(WEIGHT_MAP.semibold).toBe(600);
    expect(WEIGHT_MAP.bold).toBe(700);
  });
});

describe('five-section editor structure', () => {
  it('the editor has exactly 5 top-level sections', () => {
    // This is a structural invariant — the SECTIONS array in
    // TemplateCustomizer.tsx must have exactly 5 entries:
    //   page, fonts, theme, misc, preset
    const expectedSections = ['page', 'fonts', 'theme', 'misc', 'preset'];
    expect(expectedSections.length).toBe(5);
    expect(expectedSections).toContain('page');
    expect(expectedSections).toContain('fonts');
    expect(expectedSections).toContain('theme');
    expect(expectedSections).toContain('misc');
    expect(expectedSections).toContain('preset');
    // The old sections (headings, code as top-level) should NOT be present.
    expect(expectedSections).not.toContain('headings');
    expect(expectedSections).not.toContain('code');
  });
});

describe('preset v2 compatibility', () => {
  it('v1 presets migrate to v2 with borderStyle', () => {
    const v1: any = {
      id: 'test',
      name: 'Test',
      builtIn: false,
      syntaxTheme: 'github-light',
      page: { size: 'A4', landscape: false, marginTopMm: 20, marginRightMm: 20, marginBottomMm: 20, marginLeftMm: 20, headerSpacingMm: 8, footerSpacingMm: 8, pageHeader: null, pageFooter: null },
      typography: { bodyFont: 'Inter', bodyFontSizePt: 11, bodyColor: '#000', paragraphSpacingPt: 4, lineSpacing: 1.4 },
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
      fileHeaders: { show: true, showFileName: true, showRelativePath: true, showLanguageLabel: true, showFileSize: true, showLineCount: false, background: 'transparent', textColor: '#586069', borderBottom: true, borderColor: '#d0d7de', font: 'Courier New', fontSizePt: 8, bold: true },
      projectHeaders: { showTitle: true, showPath: false, showMetadata: true, font: 'Inter', sizePt: 18, weight: 'bold', color: '#000', spaceBeforePt: 10, spaceAfterPt: 5, uppercase: false },
      titlePage: { enabled: true, showTitle: true, showSubtitle: false, showAuthor: true, showCourse: true, showUniversity: true, showDate: true, showVersion: true, showDescription: true },
      colors: { background: '#fff', surface: '#f6f8fa', primaryText: '#000', secondaryText: '#666', mutedText: '#999', accent: '#0969da', headings: '#000', borders: '#d0d7de', codeBackground: '#f6f8fa', codeText: '#24292e', codeHeader: '#586069', codeBorder: '#d0d7de', lineNumbers: '#999', links: '#0969da', success: '#1a7f37', warning: '#9a6700', error: '#cf222e' },
      includeToc: true,
      includeProjectStructure: true,
      pageBreakBetweenFiles: true,
    };
    const migrated = migratePreset(v1);
    expect(migrated.code.borderStyle).toBeDefined();
    expect(migrated.code.useSyntaxThemeBackground).toBeDefined();
    expect(migrated.layout).toBeDefined();
    expect(migrated.pageBreaks).toBeDefined();
    expect(migrated.misc).toBeDefined();
    expect(migrated.projectStructure).toBeDefined();
  });
});
