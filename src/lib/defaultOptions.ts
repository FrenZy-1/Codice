import type { DocumentOptions } from '@/types';
import { getPreset, DEFAULT_PRESET_ID } from '@/lib/presets/presets';

/** Default document options derived from the default preset. */
export function defaultDocumentOptions(): DocumentOptions {
  const preset = getPreset(DEFAULT_PRESET_ID)!;
  return {
    pageSize: 'A4',
    landscape: false,
    margins: { top: 25, right: 20, bottom: 25, left: 25 },
    codeBackground: '#f6f8fa',
    codeBorderColor: '#d0d7de',
    codeBorderWidth: 0.5,
    codePadding: 8,
    codeFont: 'Courier New',
    codeFontSize: 9,
    codeLineHeight: 1.25,
    headingFont: 'Times New Roman',
    bodyFont: 'Times New Roman',
    bodyFontSize: 12,
    showLineNumbers: true,
    showFileHeaders: true,
    pageBreakBetweenFiles: true,
    includeToc: true,
    includeFrontMatter: true,
    wrapLongLines: true,
    includeProjectStructure: true,
    syntaxTheme: 'github-light',
    pageHeader: null,
    pageFooter: 'Page {page} of {pages}',
    ...preset.options,
  };
}
