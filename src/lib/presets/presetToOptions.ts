/**
 * Bridge between the new `DocumentPreset` model and the legacy
 * `DocumentOptions` type that the existing exporters consume.
 *
 * The exporters will be gradually updated to read directly from
 * `DocumentPreset`, but for now this adapter lets us swap the UI over to
 * the new preset system without rewriting all three exporters at once.
 */

import type { DocumentOptions, PageSize } from '@/types';
import type { DocumentPreset } from './documentPreset';

/** Convert a DocumentPreset into the legacy DocumentOptions shape. */
export function presetToOptions(preset: DocumentPreset): DocumentOptions {
  return {
    pageSize: preset.page.size as PageSize,
    landscape: preset.page.landscape,
    margins: {
      top: preset.page.marginTopMm,
      right: preset.page.marginRightMm,
      bottom: preset.page.marginBottomMm,
      left: preset.page.marginLeftMm,
    },
    codeBackground: preset.code.backgroundColor,
    codeBorderColor: preset.code.borderColor,
    codeBorderWidth: preset.code.borderWidthPt,
    codePadding: preset.code.paddingPt,
    codeFont: preset.code.font,
    codeFontSize: preset.code.fontSizePt,
    codeLineHeight: preset.code.lineHeight,
    headingFont: preset.headings.h1.font,
    bodyFont: preset.typography.bodyFont,
    bodyFontSize: preset.typography.bodyFontSizePt,
    showLineNumbers: preset.code.showLineNumbers,
    showFileHeaders: preset.fileHeaders.show,
    pageBreakBetweenFiles: preset.pageBreakBetweenFiles,
    includeToc: preset.includeToc,
    includeFrontMatter: preset.titlePage.enabled,
    wrapLongLines: preset.code.wrapLongLines,
    includeProjectStructure: preset.includeProjectStructure,
    syntaxTheme: preset.syntaxTheme,
    pageHeader: preset.page.pageHeader,
    pageFooter: preset.page.pageFooter,
  };
}
