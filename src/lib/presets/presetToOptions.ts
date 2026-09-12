/**
 * Bridge between the `DocumentPreset` model and the legacy `DocumentOptions`
 * type that the existing exporters consume.
 *
 * The exporters read from the legacy `DocumentOptions` shape; this adapter
 * derives it from the canonical `DocumentPreset` so a single source of truth
 * feeds both the preview and the exporters.
 *
 * Note: when `preset.code.borderStyle === 'none'`, the legacy
 * `codeBorderColor` is set to `null` so exporters that check for a null
 * border color will also produce no border.
 */

import type { DocumentOptions, PageSize } from '@/types';
import type { DocumentPreset } from './documentPreset';

/** Convert a DocumentPreset into the legacy DocumentOptions shape. */
export function presetToOptions(preset: DocumentPreset): DocumentOptions {
  const borderStyleNone = preset.code.borderStyle === 'none';
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
    codeBorderColor: borderStyleNone ? null : preset.code.borderColor,
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
    pageBreakBetweenFiles: preset.pageBreaks.beforeFile,
    includeToc: preset.misc.includeToc,
    includeFrontMatter: preset.titlePage.enabled,
    wrapLongLines: preset.code.wrapLongLines,
    includeProjectStructure: preset.projectStructure.enabled,
    syntaxTheme: preset.syntaxTheme,
    pageHeader: preset.page.pageHeader,
    pageFooter: preset.page.pageFooter,
  };
}
