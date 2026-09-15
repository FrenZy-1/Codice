/**
 * ODT (OpenDocument Text) exporter.
 *
 * An ODT file is a ZIP archive containing XML files following the
 * OpenDocument specification. We build the XML manually and package it with
 * JSZip. This avoids any backend dependency and works fully in-browser.
 *
 * Structure of a minimal ODT:
 *   mimetype                  — must be the first entry, stored uncompressed
 *   META-INF/manifest.xml     — lists files in the archive
 *   content.xml               — actual document content
 *   styles.xml                — style definitions
 *   meta.xml                  — metadata (title, author, date)
 *
 * Syntax highlighting is preserved by wrapping each token in a <span> with
 * an inline color style. Line numbers are emitted as a separate span at the
 * start of each line.
 *
 * Layout notes (spec §18/§21):
 *   - ODF collapses runs of literal spaces in paragraphs, so ALL code/tree
 *     whitespace is encoded with <text:s text:c="N"/> / <text:tab/>
 *     (xmlEscapeWithSpaces) — otherwise indentation and tree prefixes vanish.
 *   - fo:line-height must be a length or percentage: the code line-height
 *     multiplier is emitted as "150%", never a bare "1.5".
 *   - Every code line stays its own <text:p style="CodeLine"> with zero
 *     margins (adjacent identical borders merge into one visual block).
 */

import JSZip from 'jszip';
import type {
  DocumentFile,
  DocumentImage,
  DocumentMetadata,
  DocumentModel,
  DocumentOptions,
  ExportOptions,
  ExportResult,
  FooterSlotType,
  HighlightedFile,
  HighlightedLine,
  ResolvedLayoutBlock,
  ResolvedTextProps,
} from '@/types';
import type { DocumentExporter } from './types';
import { parseHex } from './colors';
import { getThemeColors } from '@/lib/highlight/highlighter';
import { formatBytes } from '@/lib/fileDiscovery';
import { splitRuns, GLYPH_FALLBACK_FONT } from './unicodeFallback';
import {
  IMAGE_MAX_HEIGHT_RATIO,
  IMAGE_MAX_WIDTH_RATIO,
  PX_TO_CM,
  dataUrlToBytes,
  fitImageBox,
} from '@/lib/imageAssets';
import {
  buildStaticTokenContext,
  expandTokens,
  type TokenContext,
} from '@/lib/tokens';

/** XML escape — escapes the 5 special characters. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * XML-escape text for ODF paragraph content while preserving whitespace.
 *
 * OpenDocument collapses runs of literal space characters inside
 * <text:p> — which silently destroys ALL code indentation (the leading
 * spaces of every source line vanish). This encoder keeps the visual
 * layout by encoding whitespace as explicit ODF elements:
 *
 *   - a run of 2+ spaces → <text:s text:c="N"/>
 *   - a single internal space stays a literal space
 *   - a tab → <text:tab/>
 *   - everything else (incl. the 5 XML special chars) is escaped
 *
 * The input is the RAW text; escaping is applied per plain segment while
 * building the output, and the generated <text:s>/<text:tab> elements are
 * emitted as markup (never double-escaped).
 */
export function xmlEscapeWithSpaces(text: string): string {
  const chars = Array.from(text);
  let out = '';
  let plain = '';
  const flush = () => {
    if (plain.length > 0) {
      out += xmlEscape(plain);
      plain = '';
    }
  };
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (ch === '\t') {
      flush();
      out += '<text:tab/>';
      i++;
    } else if (ch === ' ') {
      flush();
      let count = 0;
      while (i < chars.length && chars[i] === ' ') {
        count++;
        i++;
      }
      out += count === 1 ? ' ' : `<text:s text:c="${count}"/>`;
    } else {
      plain += ch;
      i++;
    }
  }
  flush();
  return out;
}

/** Convert hex to OpenDocument-compatible hex (no #). */
function hexToOdf(hex: string): string {
  return hex.replace(/^#/, '').padEnd(6, '0').slice(0, 6);
}

/** Page dimensions in cm (width, height). */
const PAGE_DIMENSIONS_CM: Record<string, [number, number]> = {
  A4: [21.0, 29.7],
  Letter: [21.59, 27.94],
  Legal: [21.59, 35.56],
  A3: [29.7, 42.0],
};

/** pt → cm conversion factor (1pt = 1/72in, 1in = 2.54cm). */
const PT_TO_CM = 2.54 / 72;

/**
 * Estimated rendered height of the title-page group (cm) from the metadata
 * actually present (spec §17 — same per-field model as the DOCX exporter:
 * line height ≈ 1.15 × font size). The old fixed 9cm constant placed small
 * groups visibly ABOVE the bottom when Vertical = Bottom.
 */
export function estimateTitleGroupHeightCm(metadata: DocumentMetadata): number {
  let pt = 28 * 1.15; // title (28pt)
  if (metadata.subtitle) pt += 14 * 1.15;
  if (metadata.author) pt += 14 * 1.15;
  if (metadata.course) pt += 12 * 1.15;
  if (metadata.university) pt += 12 * 1.15;
  pt += 11 * 1.15; // "Generated: …"
  if (metadata.version) pt += 11 * 1.15;
  if (metadata.description) pt += 11 * 1.15 * 3; // description ≈ 3 wrapped lines
  // + per-paragraph vertical margins from the Title/Subtitle/TextBody styles
  // (~0.2-0.4cm each) so the placement estimate matches real rendering.
  return pt * PT_TO_CM + 1.5;
}

/** Approximate rendered height of the title-page group (title + meta rows). */
const TITLE_PAGE_GROUP_HEIGHT_CM = 9;

/** Map a horizontal alignment option to its ODF fo:text-align value. */
function titleAlignToOdf(align: 'left' | 'center' | 'right' | undefined): string {
  if (align === 'left') return 'start';
  if (align === 'right') return 'end';
  return 'center';
}

/**
 * Top offset (cm) for the title-page group (spec §21).
 *
 * ODT has no per-page vertical alignment, so the group is pushed down with a
 * single empty spacer paragraph whose fo:margin-top is computed from the
 * printable text height (page height minus margins):
 *
 *   top    → the vertical offset only (small spacer from the top)
 *   center → half of the leftover text height (group ≈ 9cm tall) + offset
 *   bottom → the full leftover text height + offset
 *
 * The result is clamped to the printable area so the group can never be
 * pushed off the page. Pure helper — exported for tests.
 */
export function computeTitlePageSpacerCm(
  options: DocumentOptions,
  pageHeightCm: number,
  groupHeightCm: number = TITLE_PAGE_GROUP_HEIGHT_CM,
): number {
  // A master-page footer REDUCES the body text area (LibreOffice lays the
  // footer out inside the bottom margin and shrinks the body accordingly).
  const footerAllowance = options.pageFooterShow === false ? 0 : 1.6;
  const textHeightCm = Math.max(
    0,
    pageHeightCm - (options.margins.top + options.margins.bottom) / 10 - footerAllowance,
  );
  const vAlign = options.titlePageVerticalAlignment ?? 'top';
  const offsetCm = Math.max(0, options.titlePageVerticalOffsetPt ?? 0) * PT_TO_CM;
  const groupH = Math.min(groupHeightCm, textHeightCm);
  let spacer: number;
  if (vAlign === 'center') {
    // Center/Center places the group AT the center — the offset is a
    // top-mode nudge and must not skew centering (spec §9/§29).
    spacer = Math.max(0, (textHeightCm - groupH) / 2);
  } else if (vAlign === 'bottom') {
    // Bottom = the group's bottom edge sits AT the text-area bottom
    // (spec §17, same convention as the PDF and DOCX exporters). The
    // offset applies only in top mode.
    spacer = Math.max(0, textHeightCm - groupH);
  } else {
    spacer = offsetCm;
  }
  // Group-aware clamp with a 1.2cm safety band so consumer rounding (line
  // metrics, per-paragraph spacing) can never spill the group onto the
  // next page.
  return Math.min(Math.max(spacer, 0), Math.max(0, textHeightCm - groupH - 1.2));
}

/**
 * Automatic styles for the title page (emitted into content.xml).
 *
 * All title-page paragraphs share ONE horizontal alignment (spec §9): three
 * automatic styles derive from the common Title / Subtitle / TextBody styles
 * and override fo:text-align. The vertical spacer style carries the computed
 * fo:margin-top that pushes the group toward its vertical position.
 */
/**
 * Top offset (cm) for the TOC content group (spec §4) — same spacer model
 * as the title page. The block height is estimated from the entry count
 * (each TOC line ≈ bodyFontSize × 1.4 line-height). Pure helper — exported
 * for tests.
 */
export function computeTocSpacerCm(
  options: DocumentOptions,
  pageHeightCm: number,
  entryLines: number,
): number {
  const vertical = options.tocVerticalAlignment ?? 'top';
  if (vertical === 'top') return 0;
  // Footer reserves body area (see computeTitlePageSpacerCm).
  const footerAllowance = options.pageFooterShow === false ? 0 : 1.6;
  const textHeightCm = Math.max(
    0,
    pageHeightCm - (options.margins.top + options.margins.bottom) / 10 - footerAllowance,
  );
  const lineCm = Math.max(0.2, options.bodyFontSize * 1.4 * PT_TO_CM);
  const blockH = Math.min(textHeightCm, entryLines * lineCm + 1.2);
  if (vertical === 'center') {
    return Math.max(0, (textHeightCm - blockH) / 2);
  }
  return Math.max(0, textHeightCm - blockH);
}

/**
 * Automatic styles for the TOC page (spec §4): the heading + entries share
 * ONE horizontal alignment; the first project heading after the TOC (and
 * every later project) carries a HARD fo:break-before="page" so the TOC owns
 * its page (spec §16) and each project starts at the top of a fresh page
 * (spec §10) — replacing the old soft-page-break paragraphs that some
 * ODF consumers ignore.
 */
function buildTocAutoStyles(odfAlign: string, spacerCm: number, breakBeforeToc: boolean): string {
  const alignProps = `<style:paragraph-properties fo:text-align="${odfAlign}" />`;
  // The hard page break must ride on the FIRST paragraph of the TOC page.
  // When a vertical-alignment spacer exists it is that first paragraph —
  // putting the break on the heading instead would leave the spacer on the
  // previous page and produce an empty page between title and TOC.
  const spacerUsed = breakBeforeToc && spacerCm >= 0.05;
  const headingBreak = breakBeforeToc && !spacerUsed;
  const styles = [
    `<style:style style:name="TocHeading1" style:family="paragraph" style:parent-style-name="Heading1"><style:paragraph-properties fo:text-align="${odfAlign}"${headingBreak ? ' fo:break-before="page"' : ''} /></style:style>`,
    `<style:style style:name="TocEntry" style:family="paragraph" style:parent-style-name="TextBody">${alignProps}</style:style>`,
    // Hard page break for project headings that start a new page.
    `<style:style style:name="PBHeading1" style:family="paragraph" style:parent-style-name="Heading1"><style:paragraph-properties fo:break-before="page" /></style:style>`,
  ];
  if (spacerCm >= 0.05) {
    styles.push(
      `<style:style style:name="TocSpacer" style:family="paragraph"><style:paragraph-properties fo:margin-top="${spacerCm.toFixed(2)}cm" fo:margin-bottom="0cm" fo:line-height="0.15cm"${spacerUsed ? ' fo:break-before="page"' : ''} /><style:text-properties fo:font-size="1pt" /></style:style>`,
    );
  }
  return styles.join('');
}

function buildTitlePageAutoStyles(odfAlign: string, spacerCm: number): string {
  // keep-with-next chains the group together so it can never SPLIT across a
  // page boundary (title staying behind while author flows on) (spec §18).
  const alignProps = `<style:paragraph-properties fo:text-align="${odfAlign}" fo:keep-with-next="always" />`;
  const styles = [
    `<style:style style:name="TPTitle" style:family="paragraph" style:parent-style-name="Title">${alignProps}</style:style>`,
    `<style:style style:name="TPSubtitle" style:family="paragraph" style:parent-style-name="Subtitle">${alignProps}</style:style>`,
    `<style:style style:name="TPBody" style:family="paragraph" style:parent-style-name="TextBody">${alignProps}</style:style>`,
  ];
  // Only emit the spacer style when it actually moves the group — avoids a
  // stray empty first line for the default top/zero-offset layout.
  if (spacerCm >= 0.05) {
    styles.push(
      `<style:style style:name="TPSpacer" style:family="paragraph"><style:paragraph-properties fo:margin-top="${spacerCm.toFixed(2)}cm" fo:margin-bottom="0cm" fo:line-height="0.15cm" /><style:text-properties fo:font-size="1pt" /></style:style>`,
    );
  }
  return styles.join('');
}

/** Build the styles.xml content. (Exported for layout regression tests.) */
export function buildStylesXml(options: DocumentOptions, model: DocumentModel): string {
  const codeBg = options.codeBackground
    ? `<style:background-color>#${hexToOdf(options.codeBackground)}</style:background-color>`
    : '';
  const codeBorderStyleAttr =
    options.codeBorderColor && options.codeBorderStyle
      ? ` fo:border="${options.codeBorderWidth}pt ${options.codeBorderStyle} #${hexToOdf(options.codeBorderColor)}"`
      : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles
    xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
    xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
    xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
    xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
    xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
    office:version="1.2">
  <office:styles>
    <style:default-style style:family="paragraph">
      <style:paragraph-properties fo:hyphenation-ladder-count="no-limit" />
      <style:text-properties fo:hyphenate="false" />
    </style:default-style>
    <style:style style:name="Heading1" style:family="paragraph" style:next-style-name="TextBody">
      <style:paragraph-properties fo:margin-top="0.4cm" fo:margin-bottom="0.2cm" fo:keep-with-next="always" />
      <style:text-properties fo:font-family="${xmlEscape(options.headingFont)}" fo:font-size="20pt" fo:font-weight="bold" fo:color="#0f172a" />
    </style:style>
    <style:style style:name="Heading2" style:family="paragraph" style:next-style-name="TextBody">
      <style:paragraph-properties fo:margin-top="0.3cm" fo:margin-bottom="0.15cm" fo:keep-with-next="always" />
      <style:text-properties fo:font-family="${xmlEscape(options.headingFont)}" fo:font-size="15pt" fo:font-weight="bold" fo:color="#0f172a" />
    </style:style>
    <style:style style:name="Heading3" style:family="paragraph" style:next-style-name="TextBody">
      <style:paragraph-properties fo:margin-top="0.2cm" fo:margin-bottom="0.1cm" fo:keep-with-next="always" />
      <style:text-properties fo:font-family="${xmlEscape(options.headingFont)}" fo:font-size="12pt" fo:font-weight="bold" fo:color="#1e293b" />
    </style:style>
    <style:style style:name="TextBody" style:family="paragraph">
      <style:paragraph-properties fo:margin-top="0.1cm" fo:margin-bottom="0.1cm" fo:line-height="140%" />
      <style:text-properties fo:font-family="${xmlEscape(options.bodyFont)}" fo:font-size="${options.bodyFontSize}pt" fo:color="#1f2937" />
    </style:style>
    <style:style style:name="CodeLine" style:family="paragraph">
      <style:paragraph-properties fo:margin-top="0pt" fo:margin-bottom="0pt" fo:line-height="${Math.round(options.codeLineHeight * 100)}%" fo:background-color="#${hexToOdf(options.codeBackground || '#ffffff')}"${codeBorderStyleAttr} fo:padding="0.05cm" />
      <style:text-properties fo:font-family="${xmlEscape(options.codeFont)}" fo:font-size="${options.codeFontSize}pt" fo:color="#24292e" />
    </style:style>
    <style:style style:name="StructureLine" style:family="paragraph">
      <!-- The structure tree is NOT a code block: no code background/border
           (dark presets made the tree dark-on-dark/invisible — spec §7). -->
      <style:paragraph-properties fo:margin-top="0pt" fo:margin-bottom="0pt" fo:line-height="${Math.round(options.codeLineHeight * 100)}%" fo:padding="0.02cm" />
      <style:text-properties fo:font-family="${xmlEscape(options.codeFont)}" fo:font-size="${Math.max(6, options.codeFontSize - 1)}pt" fo:color="#${hexToOdf(options.projectStructureColor || '#3c3c3c')}" />
    </style:style>
    <style:style style:name="FileHeader" style:family="paragraph">
      <style:paragraph-properties fo:margin-top="0.2cm" fo:margin-bottom="0.1cm" fo:border-bottom="0.5pt solid #d0d7de" fo:padding="0.05cm" />
      <style:text-properties fo:font-family="${xmlEscape(options.codeFont)}" fo:font-size="${options.codeFontSize - 1}pt" fo:font-weight="${options.showFileHeaderBold === false ? 'normal' : 'bold'}" fo:color="#586069" />
    </style:style>
    <style:style style:name="Title" style:family="paragraph" style:next-style-name="TextBody">
      <style:paragraph-properties fo:text-align="center" fo:margin-top="2cm" fo:margin-bottom="0.4cm" />
      <style:text-properties fo:font-family="${xmlEscape(options.headingFont)}" fo:font-size="28pt" fo:font-weight="bold" fo:color="#0f172a" />
    </style:style>
    <style:style style:name="Subtitle" style:family="paragraph">
      <style:paragraph-properties fo:text-align="center" fo:margin-bottom="0.2cm" />
      <style:text-properties fo:font-family="${xmlEscape(options.bodyFont)}" fo:font-size="14pt" fo:color="#4b5563" />
    </style:style>
  </office:styles>
  <office:automatic-styles>
    <style:page-layout style:name="PL1">
      <style:page-layout-properties
          fo:page-width="${PAGE_DIMENSIONS_CM[options.pageSize][0]}cm"
          fo:page-height="${PAGE_DIMENSIONS_CM[options.pageSize][1]}cm"
          fo:margin-top="${options.margins.top}mm"
          fo:margin-bottom="${options.margins.bottom}mm"
          fo:margin-left="${options.margins.left}mm"
          fo:margin-right="${options.margins.right}mm" />
    </style:page-layout>
    <style:style style:name="PageHeaderPara" style:family="paragraph">
      <style:paragraph-properties fo:text-align="${options.pageHeaderAlign === 'left' ? 'start' : options.pageHeaderAlign === 'center' ? 'center' : 'end'}" fo:border-bottom="0.5pt solid #d0d7de" fo:padding-bottom="0.05cm" />
      <style:text-properties fo:font-family="${xmlEscape(options.bodyFont)}" fo:font-size="9pt" fo:color="#787878" />
    </style:style>
    <style:style style:name="PageFooterPara" style:family="paragraph">
      <style:paragraph-properties fo:text-align="${options.pageFooterAlign === 'left' ? 'start' : options.pageFooterAlign === 'right' ? 'end' : 'center'}" fo:border-top="0.5pt solid #d0d7de" fo:padding-top="0.05cm" />
      <style:text-properties fo:font-family="${xmlEscape(options.bodyFont)}" fo:font-size="9pt" fo:color="#787878" />
    </style:style>
    <!-- Region table for dual/triple headers/footers: one borderless row of
         equal-width cells so left/center/right slots keep their POSITIONS
         (mirrors the DOCX tab stops and the PDF x-coordinates, spec §8/§9). -->
    <style:style style:name="HFTable" style:family="table">
      <style:table-properties style:width="${hfContentWidthCm(options)}cm" table:align="left" fo:border="none" />
    </style:style>
    <style:style style:name="HFCol" style:family="table-column">
      <style:table-column-properties style:column-width="${(hfContentWidthCm(options) / 3).toFixed(3)}cm" />
    </style:style>
    <style:style style:name="HFCell" style:family="table-cell">
      <style:table-cell-properties fo:border="none" fo:padding="0cm" />
    </style:style>
    <style:style style:name="HFHeaderCell" style:family="table-cell">
      <style:table-cell-properties fo:border-bottom="0.5pt solid #d0d7de" fo:padding="0cm" fo:padding-bottom="0.05cm" />
    </style:style>
    <style:style style:name="HFFooterCell" style:family="table-cell">
      <style:table-cell-properties fo:border-top="0.5pt solid #d0d7de" fo:padding="0cm" fo:padding-top="0.05cm" />
    </style:style>
    <style:style style:name="HFHeaderLeft" style:family="paragraph">
      <style:paragraph-properties fo:text-align="start" />
      <style:text-properties fo:font-family="${xmlEscape(options.bodyFont)}" fo:font-size="9pt" fo:color="#787878" />
    </style:style>
    <style:style style:name="HFHeaderCenter" style:family="paragraph">
      <style:paragraph-properties fo:text-align="center" />
      <style:text-properties fo:font-family="${xmlEscape(options.bodyFont)}" fo:font-size="9pt" fo:color="#787878" />
    </style:style>
    <style:style style:name="HFHeaderRight" style:family="paragraph">
      <style:paragraph-properties fo:text-align="end" />
      <style:text-properties fo:font-family="${xmlEscape(options.bodyFont)}" fo:font-size="9pt" fo:color="#787878" />
    </style:style>
    <style:style style:name="HFFooterLeft" style:family="paragraph">
      <style:paragraph-properties fo:text-align="start" />
      <style:text-properties fo:font-family="${xmlEscape(options.bodyFont)}" fo:font-size="9pt" fo:color="#787878" />
    </style:style>
    <style:style style:name="HFFooterCenter" style:family="paragraph">
      <style:paragraph-properties fo:text-align="center" />
      <style:text-properties fo:font-family="${xmlEscape(options.bodyFont)}" fo:font-size="9pt" fo:color="#787878" />
    </style:style>
    <style:style style:name="HFFooterRight" style:family="paragraph">
      <style:paragraph-properties fo:text-align="end" />
      <style:text-properties fo:font-family="${xmlEscape(options.bodyFont)}" fo:font-size="9pt" fo:color="#787878" />
    </style:style>
  </office:automatic-styles>
  <office:master-styles>
    <style:master-page style:name="Standard" style:page-layout-name="PL1">${buildMasterHeaderFooter(options, buildOdtTokenContext(model))}</style:master-page>
  </office:master-styles>
</office:document-styles>`;
}

/** Build the page-independent token context shared by ODT header/footer. */
function buildOdtTokenContext(model: DocumentModel): TokenContext {
  return {
    ...buildStaticTokenContext({
      metadata: model.metadata,
      firstProjectLabel: model.projects[0]?.label ?? null,
      fileCount: model.projects.reduce((acc, p) => acc + p.files.length, 0),
      now: new Date(model.generatedAt),
    }),
    fileName: model.projects[0]?.files[0]?.relativePath.split('/').pop() ?? '',
  };
}

/**
 * Convert a template into ODT header/footer inner XML: known tokens are
 * resolved from the shared context, `{page}` / `{pages}` become live
 * OpenDocument text fields, and everything is XML-escaped.
 */
function odtHeaderFooterInner(template: string, ctx: TokenContext): string {
  // Resolve static tokens but keep {page}/{pages} intact — they become
  // live OpenDocument fields below (undefined values are not expanded).
  const expanded = expandTokens(template, { ...ctx, page: undefined, pages: undefined });
  const parts = expanded.split(/(\{page\}|\{pages\})/g);
  let inner = '';
  for (const part of parts) {
    if (part === '{page}') {
      inner += '<text:page-number text:select-page="current">1</text:page-number>';
    } else if (part === '{pages}') {
      inner += '<text:page-count>1</text:page-count>';
    } else if (part) {
      inner += xmlEscape(part);
    }
  }
  return inner;
}

/** Usable content width in cm (page minus margins) for header/footer tables. */
function hfContentWidthCm(options: DocumentOptions): number {
  const [wCm] = PAGE_DIMENSIONS_CM[options.pageSize] ?? PAGE_DIMENSIONS_CM.A4;
  return Math.max(4, wCm - options.margins.left / 10 - options.margins.right / 10);
}

/**
 * Region table for dual/triple header/footer layouts — one borderless row of
 * equal-width cells so left/center/right slots keep their POSITIONS across
 * viewers (mirrors DOCX tab stops + PDF x-coordinates, spec §8/§9).
 */
function hfRegionTable(
  kind: 'header' | 'footer',
  regions: Array<{ inner: string; align: 'left' | 'center' | 'right' }>,
): string {
  const cellStyle = kind === 'header' ? 'HFHeaderCell' : 'HFFooterCell';
  const paraPrefix = kind === 'header' ? 'HFHeader' : 'HFFooter';
  const cells = regions
    .map(
      (r) =>
        `<table:table-cell table:style-name="${cellStyle}">` +
        (r.inner
          ? `<text:p text:style-name="${paraPrefix}${r.align === 'left' ? 'Left' : r.align === 'center' ? 'Center' : 'Right'}">${r.inner}</text:p>`
          : '') +
        `</table:table-cell>`,
    )
    .join('');
  return (
    `<table:table table:style-name="HFTable">` +
    `<table:table-column table:style-name="HFCol" table:number-columns-repeated="${regions.length}" />` +
    `<table:table-row>${cells}</table:table-row>` +
    `</table:table>`
  );
}

/**
 * Master-page header/footer for the ODT. Single layout renders one aligned
 * paragraph; dual/triple render a region table so the slots keep their
 * horizontal positions (spec §9).
 */
function buildMasterHeaderFooter(options: DocumentOptions, ctx: TokenContext): string {
  let xml = '';
  const showHeader = options.pageHeaderShow ?? Boolean(options.pageHeader);
  const showFooter = options.pageFooterShow ?? Boolean(options.pageFooter);
  if (showHeader) {
    const layout = options.pageHeaderLayout ?? 'single';
    if (layout === 'single') {
      const text = options.pageHeaderCenter ?? options.pageHeader ?? '';
      if (text) {
        xml += `<style:header><text:p text:style-name="PageHeaderPara">${odtHeaderFooterInner(text, ctx)}</text:p></style:header>`;
      }
    } else {
      const regions =
        layout === 'dual'
          ? [
              { inner: odtHeaderFooterInner(options.pageHeaderLeft ?? '', ctx), align: 'left' as const },
              { inner: '', align: 'center' as const },
              { inner: odtHeaderFooterInner(options.pageHeaderRight ?? '', ctx), align: 'right' as const },
            ]
          : [
              { inner: odtHeaderFooterInner(options.pageHeaderLeft ?? '', ctx), align: 'left' as const },
              { inner: odtHeaderFooterInner(options.pageHeaderCenter ?? '', ctx), align: 'center' as const },
              { inner: odtHeaderFooterInner(options.pageHeaderRight ?? '', ctx), align: 'right' as const },
            ];
      if (regions.some((r) => r.inner)) {
        xml += `<style:header>${hfRegionTable('header', regions)}</style:header>`;
      }
    }
  }
  if (showFooter) {
    const layout = options.pageFooterLayout ?? 'single';
    const slotText = (type: FooterSlotType | undefined): string => {
      switch (type) {
        case 'pageNumber':
          return '{page}';
        case 'pageCount':
          return '{pages}';
        case 'date':
          return new Date().toLocaleDateString();
        case 'text':
          return options.pageFooterText ?? '';
        case 'linesOnPage':
        case 'fileName':
        case 'projectName':
        case 'none':
          return '';
        default:
          return '';
      }
    };
    if (layout === 'single') {
      const template = options.pageFooterCenter ? slotText(options.pageFooterCenter) : (options.pageFooter ?? '');
      if (template) {
        // Convert remaining {page}/{pages} tokens into live ODT text fields.
        const inner = odtHeaderFooterInner(template, ctx);
        xml += `<style:footer><text:p text:style-name="PageFooterPara">${inner}</text:p></style:footer>`;
      }
    } else {
      const regions =
        layout === 'dual'
          ? [
              { inner: odtHeaderFooterInner(slotText(options.pageFooterLeft), ctx), align: 'left' as const },
              { inner: '', align: 'center' as const },
              { inner: odtHeaderFooterInner(slotText(options.pageFooterRight), ctx), align: 'right' as const },
            ]
          : [
              { inner: odtHeaderFooterInner(slotText(options.pageFooterLeft), ctx), align: 'left' as const },
              { inner: odtHeaderFooterInner(slotText(options.pageFooterCenter), ctx), align: 'center' as const },
              { inner: odtHeaderFooterInner(slotText(options.pageFooterRight), ctx), align: 'right' as const },
            ];
      if (regions.some((r) => r.inner)) {
        xml += `<style:footer>${hfRegionTable('footer', regions)}</style:footer>`;
      }
    }
  }
  return xml;
}

/** Build the meta.xml content. */
function buildMetaXml(model: DocumentModel): string {
  const md = model.metadata;
  const title = md.title ?? 'Codice Document';
  const author = md.author ?? 'Codice';
  const date = new Date(model.generatedAt).toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta
    xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    office:version="1.2">
  <office:meta>
    <dc:title>${xmlEscape(title)}</dc:title>
    <dc:creator>${xmlEscape(author)}</dc:creator>
    <dc:date>${date}</dc:date>
    <meta:generator>Codice</meta:generator>
  </office:meta>
</office:document-meta>`;
}

/** Build the META-INF/manifest.xml content (with optional picture entries). */
function buildManifestXml(pictures: OdtPicture[] = []): string {
  // The baseline (no pictures) must stay byte-identical — only append the
  // picture entries when there are any.
  const pictureLines =
    pictures.length > 0
      ? '\n' +
        pictures
          .map(
            (p) =>
              `  <manifest:file-entry manifest:media-type="${p.mediaType}" manifest:full-path="${p.path}" />`,
          )
          .join('\n')
      : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest
    xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"
    manifest:version="1.2">
  <manifest:file-entry manifest:media-type="application/vnd.oasis.opendocument.text" manifest:full-path="/" />
  <manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml" />
  <manifest:file-entry manifest:media-type="text/xml" manifest:full-path="styles.xml" />
  <manifest:file-entry manifest:media-type="text/xml" manifest:full-path="meta.xml" />${pictureLines}
</manifest:manifest>`;
}

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  isFile: boolean;
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: '', children: new Map(), isFile: false };
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          children: new Map(),
          isFile: isLast,
        });
      }
      node = node.children.get(part)!;
      if (isLast) node.isFile = true;
    }
  }
  return root;
}

function renderTree(
  node: TreeNode,
  prefix: string,
  isRoot: boolean,
  out: string[],
): void {
  const entries = Array.from(node.children.values()).sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isRoot ? '' : isLast ? '└── ' : '├── ';
    const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
    out.push(`${prefix}${connector}${entry.name}`);
    if (!entry.isFile) {
      renderTree(entry, childPrefix, false, out);
    }
  }
}

/**
 * Automatic text-style registry for <text:span> elements.
 *
 * ODF does NOT allow direct formatting attributes (fo:color, fo:font-family,
 * …) on <text:span> — spans may only carry text:style-name pointing at an
 * automatic style. LibreOffice silently DROPS direct attributes, which used
 * to discard every syntax color (dark themes rendered code dark-on-dark,
 * i.e. invisible — spec §7). All inline formatting now goes through this
 * registry; the collected styles are emitted into content.xml's
 * <office:automatic-styles> right before the document body.
 */
interface SpanFormat {
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fallbackFont?: string;
}

let spanStyleCounter = 0;
const spanStyleIds = new Map<string, string>();
const spanStyleDefs = new Map<string, SpanFormat>();

/** Reset the registry (called at the start of each content build). */
export function resetSpanStyles(): void {
  spanStyleCounter = 0;
  spanStyleIds.clear();
  spanStyleDefs.clear();
}

/** Intern a format combination and return its automatic style name. */
export function spanStyleName(format: SpanFormat): string {
  const key = JSON.stringify([
    format.color ?? '',
    format.bold ?? false,
    format.italic ?? false,
    format.underline ?? false,
    format.fallbackFont ?? '',
  ]);
  const existing = spanStyleIds.get(key);
  if (existing) return existing;
  spanStyleCounter += 1;
  const name = `CS${spanStyleCounter}`;
  spanStyleIds.set(key, name);
  spanStyleDefs.set(name, format);
  return name;
}

/** Emit the collected automatic text styles (empty string when none). */
export function buildSpanAutoStyles(): string {
  const defs: string[] = [];
  for (const [name, f] of spanStyleDefs) {
    const props: string[] = [];
    if (f.color) props.push(`fo:color="#${hexToOdf(f.color)}"`);
    if (f.bold) props.push('fo:font-weight="bold"');
    if (f.italic) props.push('fo:font-style="italic"');
    if (f.underline) props.push('style:text-underline-style="solid"');
    if (f.fallbackFont) props.push(`fo:font-family="${xmlEscape(f.fallbackFont)}"`);
    defs.push(
      `<style:style style:name="${name}" style:family="text"><style:text-properties ${props.join(' ')} /></style:style>`,
    );
  }
  return defs.join('');
}

// ---------------------------------------------------------------------------
// Automatic PARAGRAPH/TABLE style registries for the custom layout stream
// (spec §35) and the per-file details/images (spec §8/§12). Layout blocks can
// carry arbitrary style overrides, so paragraph styles are interned per
// format combination and emitted into <office:automatic-styles> only when
// actually used — the baseline (no details/images/custom layout) output stays
// byte-identical.
// ---------------------------------------------------------------------------

interface LayoutParaFormat {
  /** styles.xml parent style (TextBody / Heading1 / …). */
  parent: string;
  align?: 'left' | 'center' | 'right';
  fontFamily?: string;
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  /** Letter spacing in cm (small-caps-style labels). */
  letterSpacingCm?: number;
  marginTopCm?: number;
  marginBottomCm?: number;
  /** Fixed line height in cm (tiny spacer/page-break line boxes). */
  lineHeightCm?: number;
  /** Hard page break before the paragraph (pageBreak blocks). */
  breakBefore?: boolean;
  /** Paragraph background (divider bars render as a filled line box). */
  backgroundColor?: string;
}

let layoutParaCounter = 0;
const layoutParaIds = new Map<string, string>();
const layoutParaDefs: string[] = [];

/** Reset the layout paragraph-style registry (per content build). */
export function resetLayoutParaStyles(): void {
  layoutParaCounter = 0;
  layoutParaIds.clear();
  layoutParaDefs.length = 0;
}

/** Intern one paragraph format combination; returns its automatic style name. */
export function layoutParaStyleName(fmt: LayoutParaFormat): string {
  const key = [
    fmt.parent,
    fmt.align ?? '',
    fmt.fontFamily ?? '',
    fmt.fontSizePt ?? '',
    fmt.bold ?? '',
    fmt.italic ?? '',
    fmt.color ?? '',
    fmt.letterSpacingCm ?? '',
    fmt.marginTopCm ?? '',
    fmt.marginBottomCm ?? '',
    fmt.lineHeightCm ?? '',
    fmt.breakBefore ?? false,
    fmt.backgroundColor ?? '',
  ].join('|');
  const existing = layoutParaIds.get(key);
  if (existing) return existing;
  layoutParaCounter += 1;
  const name = `LP${layoutParaCounter}`;
  layoutParaIds.set(key, name);
  layoutParaDefs.push(layoutParaStyleXml(name, fmt));
  return name;
}

function layoutParaStyleXml(name: string, fmt: LayoutParaFormat): string {
  const paraProps: string[] = [];
  if (fmt.align) paraProps.push(`fo:text-align="${titleAlignToOdf(fmt.align)}"`);
  if (fmt.marginTopCm != null) paraProps.push(`fo:margin-top="${fmt.marginTopCm.toFixed(3)}cm"`);
  if (fmt.marginBottomCm != null) paraProps.push(`fo:margin-bottom="${fmt.marginBottomCm.toFixed(3)}cm"`);
  if (fmt.lineHeightCm != null) paraProps.push(`fo:line-height="${fmt.lineHeightCm.toFixed(3)}cm"`);
  if (fmt.breakBefore) paraProps.push('fo:break-before="page"');
  if (fmt.backgroundColor) paraProps.push(`fo:background-color="#${hexToOdf(fmt.backgroundColor)}"`);
  const textProps: string[] = [];
  if (fmt.fontFamily) textProps.push(`fo:font-family="${xmlEscape(fmt.fontFamily)}"`);
  if (fmt.fontSizePt != null) textProps.push(`fo:font-size="${fmt.fontSizePt}pt"`);
  if (fmt.bold) textProps.push('fo:font-weight="bold"');
  if (fmt.italic) textProps.push('fo:font-style="italic"');
  if (fmt.color) textProps.push(`fo:color="#${hexToOdf(fmt.color)}"`);
  if (fmt.letterSpacingCm != null) textProps.push(`fo:letter-spacing="${fmt.letterSpacingCm.toFixed(3)}cm"`);
  return (
    `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${fmt.parent}">` +
    (paraProps.length > 0 ? `<style:paragraph-properties ${paraProps.join(' ')} />` : '') +
    (textProps.length > 0 ? `<style:text-properties ${textProps.join(' ')} />` : '') +
    `</style:style>`
  );
}

/** Emit the collected layout paragraph styles (empty string when none). */
export function buildLayoutParaAutoStyles(): string {
  return layoutParaDefs.join('');
}

interface LayoutTableFormat {
  columns: number;
  fillColor?: string | null;
  borderColor?: string | null;
  borderWidthPt?: number;
  paddingPt: number;
  /** Full table width in cm (content width). */
  widthCm: number;
}

let layoutTableCounter = 0;
const layoutTableIds = new Map<string, { table: string; col: string; cell: string }>();
const layoutTableDefs: string[] = [];

/** Reset the layout table-style registry (per content build). */
export function resetLayoutTableStyles(): void {
  layoutTableCounter = 0;
  layoutTableIds.clear();
  layoutTableDefs.length = 0;
}

/** Intern the table/column/cell style trio for a panel or columns block. */
function layoutTableStyleNames(fmt: LayoutTableFormat): { table: string; col: string; cell: string } {
  const key = JSON.stringify([
    fmt.columns,
    fmt.fillColor ?? null,
    fmt.borderColor ?? null,
    fmt.borderWidthPt ?? 0,
    fmt.paddingPt,
    Math.round(fmt.widthCm * 1000) / 1000,
  ]);
  const existing = layoutTableIds.get(key);
  if (existing) return existing;
  layoutTableCounter += 1;
  const table = `LT${layoutTableCounter}`;
  const col = `LT${layoutTableCounter}C`;
  const cell = `LT${layoutTableCounter}X`;
  layoutTableIds.set(key, { table, col, cell });
  const colWidthCm = fmt.widthCm / Math.max(1, fmt.columns);
  const border = fmt.borderColor
    ? `${Math.max(0.1, fmt.borderWidthPt ?? 1)}pt solid #${hexToOdf(fmt.borderColor)}`
    : 'none';
  layoutTableDefs.push(
    `<style:style style:name="${table}" style:family="table"><style:table-properties style:width="${fmt.widthCm.toFixed(3)}cm" table:align="margins" /></style:style>`,
    `<style:style style:name="${col}" style:family="table-column"><style:table-column-properties style:column-width="${colWidthCm.toFixed(3)}cm" /></style:style>`,
    `<style:style style:name="${cell}" style:family="table-cell"><style:table-cell-properties fo:padding="${(fmt.paddingPt * PT_TO_CM).toFixed(3)}cm" fo:border="${border}"${fmt.fillColor ? ` fo:background-color="#${hexToOdf(fmt.fillColor)}"` : ''} /></style:style>`,
  );
  return { table, col, cell };
}

/** Emit the collected layout table styles (empty string when none). */
export function buildLayoutTableAutoStyles(): string {
  return layoutTableDefs.join('');
}

/** Automatic styles for the per-file detail labels/text (emitted only when used). */
function buildDetailAutoStyles(options: DocumentOptions): string {
  const labelSize = Math.max(6, options.bodyFontSize - 2);
  return [
    `<style:style style:name="DetailLabel" style:family="paragraph" style:parent-style-name="TextBody"><style:paragraph-properties fo:margin-top="0.25cm" fo:margin-bottom="0.06cm" fo:keep-with-next="always" /><style:text-properties fo:font-family="${xmlEscape(options.bodyFont)}" fo:font-size="${labelSize}pt" fo:font-weight="bold" fo:letter-spacing="0.04cm" fo:color="#586069" /></style:style>`,
    `<style:style style:name="DetailText" style:family="paragraph" style:parent-style-name="TextBody"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.25cm" /></style:style>`,
  ].join('');
}

/** Automatic styles for embedded images (paragraphs + graphic frame). */
function buildImageAutoStyles(options: DocumentOptions): string {
  return [
    `<style:style style:name="ImagePara" style:family="paragraph"><style:paragraph-properties fo:text-align="center" fo:margin-top="0.2cm" fo:margin-bottom="0.1cm" /></style:style>`,
    `<style:style style:name="ImageCaption" style:family="paragraph"><style:paragraph-properties fo:text-align="center" fo:margin-top="0.05cm" fo:margin-bottom="0.25cm" /><style:text-properties fo:font-family="${xmlEscape(options.bodyFont)}" fo:font-size="${Math.max(6, options.bodyFontSize - 2)}pt" fo:font-style="italic" fo:color="#586069" /></style:style>`,
    `<style:style style:name="ImageFrame" style:family="graphic"><style:graphic-properties style:vertical-pos="top" style:vertical-rel="baseline" fo:margin-top="0.1cm" fo:margin-bottom="0.1cm" /></style:style>`,
  ].join('');
}

/** A decoded picture to embed into the ODT ZIP under Pictures/. */
export interface OdtPicture {
  path: string;
  bytes: Uint8Array;
  mediaType: string;
}

/**
 * Image paragraphs: an as-char draw:frame referencing a Pictures/ ZIP entry
 * (REAL pixel bytes decoded from the data URL) + optional italic caption.
 * Sizes are the aspect-fit box in cm (px at 96 dpi → cm) capped at 62% of the
 * content width / 55% of the content height (spec §8/§12).
 */
function odtImageParagraphs(
  img: DocumentImage,
  pictures: OdtPicture[],
  maxWCm: number,
  maxHCm: number,
  align: 'left' | 'center' | 'right' = 'center',
): string[] {
  const ext = img.mime === 'image/jpeg' ? 'jpg' : 'png';
  const safeId = img.id.replace(/[^a-zA-Z0-9_-]/g, '') || 'asset';
  const path = `Pictures/img-${safeId}.${ext}`;
  if (!pictures.some((p) => p.path === path)) {
    pictures.push({ path, bytes: dataUrlToBytes(img.dataUrl), mediaType: img.mime });
  }
  const natWCm = img.width * PX_TO_CM;
  const natHCm = img.height * PX_TO_CM;
  const { w, h } = fitImageBox(natWCm, natHCm, maxWCm, maxHCm);
  const paraStyle =
    align === 'center'
      ? 'ImagePara'
      : layoutParaStyleName({ parent: 'TextBody', align, marginBottomCm: 0.1 });
  const paras = [
    `<text:p text:style-name="${paraStyle}"><draw:frame draw:style-name="ImageFrame" text:anchor-type="as-char" svg:width="${w.toFixed(3)}cm" svg:height="${h.toFixed(3)}cm" draw:name="${xmlEscape(img.name || 'image')}"><draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" /></draw:frame></text:p>`,
  ];
  if (img.caption?.trim()) {
    paras.push(`<text:p text:style-name="ImageCaption">${xmlEscape(img.caption)}</text:p>`);
  }
  return paras;
}

/** Label + text paragraphs for one details field (Description/Summary/Note). */
function odtDetailParagraphs(
  label: string,
  text: string,
  props: ResolvedTextProps | undefined,
  options: DocumentOptions,
  flags?: { detailStyles: boolean },
): string[] {
  const hasOverrides =
    props && (props.align || props.fontSizePt || props.bold !== undefined || props.italic !== undefined || props.color);
  if (hasOverrides) {
    const p = props as ResolvedTextProps;
    return [
      `<text:p text:style-name="${layoutParaStyleName({
        parent: 'TextBody',
        align: p.align,
        fontSizePt: Math.max(6, (p.fontSizePt ?? options.bodyFontSize) - 2),
        bold: true,
        italic: p.italic,
        color: p.color,
        letterSpacingCm: 0.04,
      })}">${xmlEscape(label.toUpperCase())}</text:p>`,
      `<text:p text:style-name="${layoutParaStyleName({
        parent: 'TextBody',
        align: p.align,
        fontSizePt: p.fontSizePt,
        bold: p.bold,
        italic: p.italic,
        color: p.color,
      })}">${xmlEscape(text)}</text:p>`,
    ];
  }
  // The fixed DetailLabel/DetailText styles are only emitted when actually used.
  if (flags) flags.detailStyles = true;
  return [
    `<text:p text:style-name="DetailLabel">${xmlEscape(label.toUpperCase())}</text:p>`,
    `<text:p text:style-name="DetailText">${xmlEscape(text)}</text:p>`,
  ];
}


/**
 * Render a single line of code as ODF XML (with Unicode-glyph run splitting
 * and whitespace preservation).
 *
 * Each code line stays its OWN <text:p> with the shared "CodeLine" style
 * (LibreOffice merges adjacent identical paragraph borders, so the block
 * still reads as one box) — never collapsed into a single paragraph.
 * (Exported for layout regression tests.)
 */
export function renderCodeLine(
  line: HighlightedLine,
  options: DocumentOptions,
  lineNumberWidth: number,
  defaultColor: string,
): string {
  const parts: string[] = [];

  if (options.showLineNumbers) {
    const numStr = String(line.lineNumber).padStart(lineNumberWidth, ' ');
    // Pad spaces + gutter gap must survive XML whitespace collapse.
    const numStyle = spanStyleName({ color: '#999999' });
    parts.push(
      `<text:span text:style-name="${numStyle}">${xmlEscapeWithSpaces(numStr + ' ')}</text:span>`,
    );
  }

  for (const tok of line.tokens) {
    const text = line.text.slice(tok.start, tok.start + tok.length);
    if (text.length === 0) continue;
    const color = tok.color ?? defaultColor;
    // Only box-drawing glyph runs switch to the fallback font.
    for (const run of splitRuns(text)) {
      const style = spanStyleName({
        color,
        bold: tok.bold,
        italic: tok.italic,
        underline: tok.underline,
        fallbackFont: run.fallback ? GLYPH_FALLBACK_FONT : undefined,
      });
      parts.push(`<text:span text:style-name="${style}">${xmlEscapeWithSpaces(run.text)}</text:span>`);
    }
  }

  // A completely empty line must still occupy a full line box — ODF collapses
  // a lone literal space, so emit an explicit single-space element instead.
  if (parts.length === 0) {
    parts.push('<text:s/>');
  }

  return `<text:p text:style-name="CodeLine">${parts.join('')}</text:p>`;
}

function renderFileHeader(
  file: { relativePath: string; language: string | null; sizeBytes: number; highlighted: HighlightedFile },
  options: DocumentOptions,
): string {
  const name = file.relativePath.split('/').pop() ?? file.relativePath;
  const parts: string[] = [];
  if (options.showFileName !== false) parts.push(name);
  if (options.showRelativePath !== false) parts.push(file.relativePath);
  if (options.showLanguageLabel !== false) parts.push(languageLabel(file.language));
  if (options.showFileSize !== false) parts.push(formatBytes(file.sizeBytes));
  if (options.showLineCount === true) parts.push(`${file.highlighted.lines.length} lines`);
  const text = parts.join('    ·    ');
  return `<text:p text:style-name="FileHeader">${xmlEscape(text)}</text:p>`;
}

function languageLabel(id: string | null): string {
  if (!id) return 'Plain text';
  const map: Record<string, string> = {
    java: 'Java',
    kotlin: 'Kotlin',
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    python: 'Python',
    go: 'Go',
    rust: 'Rust',
    c: 'C',
    cpp: 'C++',
    csharp: 'C#',
    php: 'PHP',
    ruby: 'Ruby',
    bash: 'Shell',
    json: 'JSON',
    yaml: 'YAML',
    toml: 'TOML',
    xml: 'XML',
    html: 'HTML',
    css: 'CSS',
    sql: 'SQL',
    markdown: 'Markdown',
    docker: 'Dockerfile',
    makefile: 'Makefile',
    cmake: 'CMake',
    groovy: 'Groovy',
    properties: 'Properties',
    ini: 'INI',
  };
  return map[id] ?? id;
}

/** Build the content.xml for the document (plus decoded pictures for the ZIP). */
async function buildContentXml(model: DocumentModel): Promise<{ xml: string; pictures: OdtPicture[] }> {
  const opts = model.options;
  // Fresh automatic-style registries per build (module-level Maps).
  resetSpanStyles();
  resetLayoutParaStyles();
  resetLayoutTableStyles();
  let defaultColor = '#24292e';
  try {
    const tc = await getThemeColors(opts.syntaxTheme);
    defaultColor = tc.foreground;
  } catch {
    // ignore
  }

  // Max line-number width across all files.
  let maxLineNum = 0;
  for (const project of model.projects) {
    for (const file of project.files) {
      if (file.highlighted.lines.length > maxLineNum) {
        maxLineNum = file.highlighted.lines.length;
      }
    }
  }
  const lineNumberWidth = String(maxLineNum).length;

  // Image geometry (spec §8/§12): 62% of the content width, 55% of the
  // content height, in centimetres.
  const pageDims = PAGE_DIMENSIONS_CM[opts.pageSize] ?? PAGE_DIMENSIONS_CM.A4;
  const contentWCm = Math.max(1, pageDims[0] - (opts.margins.left + opts.margins.right) / 10);
  const contentHCm = Math.max(1, pageDims[1] - (opts.margins.top + opts.margins.bottom) / 10);
  const maxImgWCm = contentWCm * IMAGE_MAX_WIDTH_RATIO;
  const maxImgHCm = contentHCm * IMAGE_MAX_HEIGHT_RATIO;

  const pictures: OdtPicture[] = [];
  const body: string[] = [];
  // Feature flags — new automatic styles / namespaces are only emitted when
  // the corresponding content is actually present, so the baseline output
  // (no details / images / custom layout) stays byte-identical.
  const flags = { detailStyles: false, imageStyles: false, tables: false };

  const layoutCtx: OdtLayoutContext = {
    model,
    options: opts,
    body,
    pictures,
    flags,
    lineNumberWidth,
    defaultColor,
    contentWCm,
    maxImgWCm,
    maxImgHCm,
  };

  body.push(`<office:body>`);
  body.push(`<office:text>`);

  if (model.customLayout) {
    // Custom layout stream (spec §35): the resolved blocks replace the
    // standard title/TOC/project/file flow entirely.
    renderOdtLayoutBlocks(model, model.customLayout.blocks, layoutCtx);
    // ODF documents should not end on a bare table — close with a tiny gap
    // paragraph when the stream ends with a panel/columns table.
    if (body[body.length - 1]?.startsWith('<table:table')) {
      body.push(
        `<text:p text:style-name="${layoutParaStyleName({ parent: 'TextBody', fontSizePt: 1, lineHeightCm: 0.15, marginTopCm: 0, marginBottomCm: 0 })}"/>`,
      );
    }
  } else {
    // Front matter — the WHOLE title-page group (title, subtitle, author,
    // course, university, generated, version, description) shares one
    // horizontal alignment; a computed spacer paragraph positions it
    // vertically on the page.
    if (opts.includeFrontMatter) {
      const md = model.metadata;
      const titleSpacerCm = computeTitlePageSpacerCm(
        opts,
        pageDims[1],
        estimateTitleGroupHeightCm(model.metadata),
      );
      if (titleSpacerCm >= 0.05) {
        body.push(`<text:p text:style-name="TPSpacer"/>`);
      }
      body.push(
        `<text:p text:style-name="TPTitle">${xmlEscape(md.title ?? 'Project Report')}</text:p>`,
      );
      if (md.subtitle)
        body.push(
          `<text:p text:style-name="TPSubtitle">${xmlEscape(md.subtitle)}</text:p>`,
        );
      if (md.author)
        body.push(
          `<text:p text:style-name="TPSubtitle">${xmlEscape(md.author)}</text:p>`,
        );
      if (md.course)
        body.push(
          `<text:p text:style-name="TPSubtitle">${xmlEscape(md.course)}</text:p>`,
        );
      if (md.university)
        body.push(
          `<text:p text:style-name="TPSubtitle">${xmlEscape(md.university)}</text:p>`,
        );
      body.push(
        `<text:p text:style-name="TPSubtitle">Generated: ${xmlEscape(new Date(model.generatedAt).toLocaleString())}</text:p>`,
      );
      if (md.version)
        body.push(
          `<text:p text:style-name="TPSubtitle">Version: ${xmlEscape(md.version)}</text:p>`,
        );
      if (md.description)
        body.push(
          `<text:p text:style-name="TPBody">${xmlEscape(md.description)}</text:p>`,
        );
      // spec §15 — NO trailing soft-page-break paragraph: the page break is
      // expressed by fo:break-before="page" on the NEXT section's first
      // paragraph (TocHeading1 / PBHeading1), which every ODF consumer honors.
    }

    // Table of contents (static) — one aligned content group on its OWN page
    // (spec §4/§16). The hard break lives on the TocHeading1 style; entries
    // share the group alignment; the next section's first paragraph carries
    // the break into the following page.
    const tocEntryLines =
      2 + model.projects.reduce((acc, p) => acc + 1 + p.files.length, 0);
    const tocSpacerCm = computeTocSpacerCm(opts, pageDims[1], tocEntryLines);
    if (opts.includeToc) {
      body.push(...buildTocParts(model, opts, tocSpacerCm));
    }

    // Per-project — each project starts at the TOP of a fresh page when it
    // follows the TOC or another project (spec §10/§16, matching the DOCX and
    // PDF exporters' page model).
    let projectN = 0;
    for (const project of model.projects) {
      projectN++;
      const projectHeadingStyle =
        projectN > 1 || opts.includeToc ? 'PBHeading1' : 'Heading1';
      body.push(
        `<text:p text:style-name="${projectHeadingStyle}">${projectN}. ${xmlEscape(project.label)}</text:p>`,
      );

      if (opts.includeProjectStructure) {
        body.push(
          `<text:p text:style-name="Heading2">Project Structure: ${xmlEscape(project.label)}</text:p>`,
        );
        const root = buildTree(project.structurePaths);
        const lines: string[] = [];
        renderTree(root, '', true, lines);
        for (const line of lines) {
          // Whitespace preservation matters here too: nested tree prefixes
          // ("│   " / "    ") are pure space runs that would otherwise collapse.
          const runs = splitRuns(line)
            .map((run) => {
              if (!run.fallback) return xmlEscapeWithSpaces(run.text);
              const style = spanStyleName({ fallbackFont: GLYPH_FALLBACK_FONT });
              return `<text:span text:style-name="${style}">${xmlEscapeWithSpaces(run.text)}</text:span>`;
            })
            .join('');
          body.push(`<text:p text:style-name="StructureLine">${runs}</text:p>`);
        }
      }

      body.push(`<text:p text:style-name="Heading2">Source Files</text:p>`);

      let fileN = 0;
      for (const file of project.files) {
        fileN++;
        body.push(
          `<text:p text:style-name="Heading3">${projectN}.${fileN}  ${xmlEscape(file.relativePath)}</text:p>`,
        );
        if (opts.showFileHeaders) {
          body.push(renderFileHeader(file, opts));
        }
        // Description BEFORE the code block (spec §6/§8).
        if (file.details?.description?.trim()) {
          body.push(
            ...odtDetailParagraphs('Description', file.details.description, undefined, opts, flags),
          );
        }
        for (const line of file.highlighted.lines) {
          body.push(renderCodeLine(line, opts, lineNumberWidth, defaultColor));
        }
        // Images ride between the code block and the summary (§10/§12).
        for (const img of file.images ?? []) {
          flags.imageStyles = true;
          body.push(...odtImageParagraphs(img, pictures, maxImgWCm, maxImgHCm));
        }
        if (file.details?.summary?.trim()) {
          body.push(...odtDetailParagraphs('Summary', file.details.summary, undefined, opts, flags));
        }
        if (file.details?.note?.trim()) {
          body.push(...odtDetailParagraphs('Note', file.details.note, undefined, opts, flags));
        }
      }
    }
  }

  body.push(`</office:text>`);
  body.push(`</office:body>`);

  // Build the complete automatic-styles block NOW that the body (and thus
  // the style registries) is final.
  const titleAlign = titleAlignToOdf(opts.titlePageHorizontalAlignment);
  const titleSpacerCm = computeTitlePageSpacerCm(
    opts,
    pageDims[1],
    estimateTitleGroupHeightCm(model.metadata),
  );
  const tocAlign = titleAlignToOdf(opts.tocHorizontalAlignment);
  const tocEntryLines =
    2 + model.projects.reduce((acc, p) => acc + 1 + p.files.length, 0);
  const tocSpacerCm = computeTocSpacerCm(opts, pageDims[1], tocEntryLines);
  const layoutTocUsed = !!(
    model.customLayout && model.customLayout.blocks.some((b) => b.kind === 'toc')
  );
  const autoStyles = [
    opts.includeFrontMatter && !model.customLayout
      ? buildTitlePageAutoStyles(titleAlign, titleSpacerCm)
      : '',
    opts.includeToc || layoutTocUsed
      ? buildTocAutoStyles(tocAlign, tocSpacerCm, opts.includeFrontMatter && !model.customLayout)
      : '',
    !opts.includeToc && !model.customLayout && model.projects.length > 1
      ? `<style:style style:name="PBHeading1" style:family="paragraph" style:parent-style-name="Heading1"><style:paragraph-properties fo:break-before="page" /></style:style>`
      : '',
    flags.detailStyles ? buildDetailAutoStyles(opts) : '',
    flags.imageStyles ? buildImageAutoStyles(opts) : '',
    // Layout paragraph styles (interned while rendering — empty when unused).
    buildLayoutParaAutoStyles(),
    flags.tables ? buildLayoutTableAutoStyles() : '',
    // Inline character styles collected while rendering code/structure
    // (syntax colors, bold/italic, glyph-fallback font — spec §7).
    buildSpanAutoStyles(),
  ].join('');

  // Root element — the extra table/draw/svg namespaces are appended only when
  // the new features need them (baseline keeps the historical attribute list).
  const rootAttrs = [
    `<office:document-content`,
    `        xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"`,
    `        xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"`,
    `        xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"`,
    `        xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"`,
    `        xmlns:xlink="http://www.w3.org/1999/xlink"`,
    ...(flags.tables
      ? [`        xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"`]
      : []),
    ...(pictures.length > 0
      ? [
          `        xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"`,
          `        xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"`,
        ]
      : []),
    `        office:version="1.2">`,
  ].join('\n');

  const parts: string[] = [`<?xml version="1.0" encoding="UTF-8"?>`, rootAttrs];
  if (autoStyles) {
    parts.push(`<office:automatic-styles>${autoStyles}</office:automatic-styles>`);
  }
  parts.push(...body);
  parts.push(`</office:document-content>`);

  return { xml: parts.join('\n'), pictures };
}

/** Standard TOC emission (shared by the standard flow and the `toc` block). */
function buildTocParts(model: DocumentModel, opts: DocumentOptions, tocSpacerCm: number): string[] {
  const parts: string[] = [];
  if (tocSpacerCm >= 0.05) {
    parts.push(`<text:p text:style-name="TocSpacer"/>`);
  }
  parts.push(`<text:p text:style-name="TocHeading1">Table of Contents</text:p>`);
  let n = 1;
  for (const project of model.projects) {
    parts.push(
      `<text:p text:style-name="TocEntry">${n}. ${xmlEscape(project.label)}</text:p>`,
    );
    let m = 1;
    for (const file of project.files) {
      const meta = opts.showFileMetadata
        ? `   ${n}.${m}  ${xmlEscape(file.relativePath)}  ·  ${languageLabel(file.language)} · ${formatBytes(file.sizeBytes)}`
        : `   ${n}.${m}  ${xmlEscape(file.relativePath)}`;
      parts.push(`<text:p text:style-name="TocEntry">${meta}</text:p>`);
      m++;
    }
    n++;
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Custom layout stream renderer (spec §35) — reuses the exact standard
// machinery (renderFileHeader / renderCodeLine) so code looks identical.
// ---------------------------------------------------------------------------

interface OdtLayoutContext {
  model: DocumentModel;
  options: DocumentOptions;
  /** Body element list (renderers push into it; cells splice their range). */
  body: string[];
  pictures: OdtPicture[];
  flags: { detailStyles: boolean; imageStyles: boolean; tables: boolean };
  lineNumberWidth: number;
  defaultColor: string;
  contentWCm: number;
  maxImgWCm: number;
  maxImgHCm: number;
}

/** Find a DocumentFile by its highlighted fileId across all projects. */
function odtFileById(model: DocumentModel, fileId: string): DocumentFile | undefined {
  for (const project of model.projects) {
    const file = project.files.find((f) => f.highlighted.fileId === fileId);
    if (file) return file;
  }
  return undefined;
}

/** A 1pt line box paragraph used as a table separator / page-break carrier. */
function odtTinyPara(fmt: {
  parent: string;
  fontSizePt?: number;
  lineHeightCm?: number;
  marginTopCm?: number;
  marginBottomCm?: number;
  breakBefore?: boolean;
  backgroundColor?: string;
}): string {
  return `<text:p text:style-name="${layoutParaStyleName(fmt)}"/>`;
}

function renderOdtLayoutBlocks(
  model: DocumentModel,
  blocks: readonly ResolvedLayoutBlock[],
  ctx: OdtLayoutContext,
): void {
  let lastWasTable = false;
  for (const block of blocks) {
    const isTable = block.kind === 'panel' || block.kind === 'columns';
    if (isTable && lastWasTable) {
      // Adjacent ODF tables would visually merge into one — separate them.
      ctx.body.push(
        odtTinyPara({ parent: 'TextBody', fontSizePt: 1, lineHeightCm: 0.15, marginTopCm: 0, marginBottomCm: 0 }),
      );
    }
    renderOdtLayoutBlock(model, block, ctx);
    lastWasTable = isTable;
  }
}

function renderOdtLayoutBlock(
  model: DocumentModel,
  block: ResolvedLayoutBlock,
  ctx: OdtLayoutContext,
): void {
  const opts = ctx.options;
  switch (block.kind) {
    case 'heading': {
      const level =
        block.level === 1 ? 'Heading1' : block.level === 2 ? 'Heading2' : 'Heading3';
      const hasOverrides =
        block.align || block.fontSizePt || block.bold !== undefined || block.italic !== undefined || block.color;
      const style = hasOverrides
        ? layoutParaStyleName({
            parent: level,
            align: block.align,
            fontSizePt: block.fontSizePt,
            bold: block.bold,
            italic: block.italic,
            color: block.color,
          })
        : level;
      ctx.body.push(`<text:p text:style-name="${style}">${xmlEscape(block.text)}</text:p>`);
      break;
    }
    case 'paragraph': {
      const hasOverrides =
        block.align || block.fontSizePt || block.bold !== undefined || block.italic !== undefined || block.color;
      const style = hasOverrides
        ? layoutParaStyleName({
            parent: 'TextBody',
            align: block.align,
            fontSizePt: block.fontSizePt,
            bold: block.bold,
            italic: block.italic,
            color: block.color,
          })
        : 'TextBody';
      ctx.body.push(`<text:p text:style-name="${style}">${xmlEscape(block.text)}</text:p>`);
      break;
    }
    case 'labeled': {
      ctx.body.push(...odtDetailParagraphs(block.label, block.text, block, opts, ctx.flags));
      break;
    }
    case 'fileHeader': {
      const file = odtFileById(model, block.fileId);
      if (file && opts.showFileHeaders !== false) {
        ctx.body.push(renderFileHeader(file, opts));
      }
      break;
    }
    case 'code': {
      const file = odtFileById(model, block.fileId);
      if (file) {
        for (const line of file.highlighted.lines) {
          ctx.body.push(renderCodeLine(line, opts, ctx.lineNumberWidth, ctx.defaultColor));
        }
      }
      break;
    }
    case 'image': {
      const img: DocumentImage = {
        id: block.imageId,
        name: block.name,
        dataUrl: block.dataUrl,
        mime: block.mime,
        width: block.width,
        height: block.height,
        caption: block.captionVisible && block.caption ? block.caption : undefined,
      };
      ctx.flags.imageStyles = true;
      ctx.body.push(
        ...odtImageParagraphs(img, ctx.pictures, ctx.maxImgWCm, ctx.maxImgHCm, block.align ?? 'center'),
      );
      break;
    }
    case 'pageBreak': {
      ctx.body.push(
        odtTinyPara({
          parent: 'TextBody',
          breakBefore: true,
          fontSizePt: 1,
          lineHeightCm: 0.15,
          marginTopCm: 0,
          marginBottomCm: 0,
        }),
      );
      break;
    }
    case 'spacer': {
      ctx.body.push(
        odtTinyPara({
          parent: 'TextBody',
          marginTopCm: block.heightPt * PT_TO_CM,
          fontSizePt: 1,
          lineHeightCm: 0.15,
          marginBottomCm: 0,
        }),
      );
      break;
    }
    case 'divider': {
      // §6 — horizontal rule: a filled line box in the bar color.
      const thicknessCm = Math.max(0.03, block.heightPt * PT_TO_CM);
      ctx.body.push(
        odtTinyPara({
          parent: 'TextBody',
          fontSizePt: 1,
          lineHeightCm: thicknessCm,
          marginTopCm: 0.12,
          marginBottomCm: 0.16,
          backgroundColor: block.fillColor ?? '#888888',
        }),
      );
      break;
    }
    case 'panel': {
      ctx.flags.tables = true;
      const names = layoutTableStyleNames({
        columns: 1,
        fillColor: block.fillColor ?? null,
        borderColor: block.borderColor ?? null,
        borderWidthPt: block.borderWidthPt ?? 1,
        paddingPt: block.paddingPt ?? 8,
        widthCm: ctx.contentWCm,
      });
      const start = ctx.body.length;
      renderOdtLayoutBlocks(model, block.children, ctx);
      const children = ctx.body.splice(start);
      ctx.body.push(
        `<table:table table:style-name="${names.table}">` +
          `<table:table-column table:style-name="${names.col}" />` +
          `<table:table-row>` +
          `<table:table-cell table:style-name="${names.cell}">${children.length > 0 ? children.join('') : '<text:p text:style-name="TextBody"/>'}</table:table-cell>` +
          `</table:table-row>` +
          `</table:table>`,
      );
      break;
    }
    case 'columns': {
      ctx.flags.tables = true;
      const count = block.count;
      const names = layoutTableStyleNames({
        columns: count,
        fillColor: null,
        borderColor: null,
        borderWidthPt: 0,
        paddingPt: 0,
        widthCm: ctx.contentWCm,
      });
      const cells = block.columns
        .map((stack) => {
          const start = ctx.body.length;
          renderOdtLayoutBlocks(model, stack, ctx);
          const children = ctx.body.splice(start);
          return `<table:table-cell table:style-name="${names.cell}">${children.length > 0 ? children.join('') : '<text:p text:style-name="TextBody"/>'}</table:table-cell>`;
        })
        .join('');
      ctx.body.push(
        `<table:table table:style-name="${names.table}">` +
          `<table:table-column table:style-name="${names.col}" table:number-columns-repeated="${count}" />` +
          `<table:table-row>${cells}</table:table-row>` +
          `</table:table>`,
      );
      break;
    }
    case 'toc': {
      const pageDims = PAGE_DIMENSIONS_CM[opts.pageSize] ?? PAGE_DIMENSIONS_CM.A4;
      const tocEntryLines =
        2 + model.projects.reduce((acc, p) => acc + 1 + p.files.length, 0);
      const tocSpacerCm = computeTocSpacerCm(opts, pageDims[1], tocEntryLines);
      ctx.body.push(...buildTocParts(model, opts, tocSpacerCm));
      break;
    }
    case 'metadata': {
      // Compact title-page group: the standard metadata fields at their
      // standard sizes, aligned like the title page (without the vertical
      // positioning spacer — this is an inline block, not a full page).
      const md = model.metadata;
      const metaAlign = opts.titlePageHorizontalAlignment ?? 'center';
      ctx.body.push(
        `<text:p text:style-name="${layoutParaStyleName({
          parent: 'TextBody',
          align: metaAlign,
          fontFamily: opts.headingFont,
          fontSizePt: 28,
          bold: true,
          marginBottomCm: 0.3,
        })}">${xmlEscape(md.title ?? 'Project Report')}</text:p>`,
      );
      if (md.subtitle) {
        ctx.body.push(
          `<text:p text:style-name="${layoutParaStyleName({ parent: 'TextBody', align: metaAlign, fontSizePt: 14, italic: true, color: '#4b5563' })}">${xmlEscape(md.subtitle)}</text:p>`,
        );
      }
      if (md.author) {
        ctx.body.push(
          `<text:p text:style-name="${layoutParaStyleName({ parent: 'TextBody', align: metaAlign, fontSizePt: 14 })}">${xmlEscape(md.author)}</text:p>`,
        );
      }
      if (md.course) {
        ctx.body.push(
          `<text:p text:style-name="${layoutParaStyleName({ parent: 'TextBody', align: metaAlign, fontSizePt: 12 })}">${xmlEscape(md.course)}</text:p>`,
        );
      }
      if (md.university) {
        ctx.body.push(
          `<text:p text:style-name="${layoutParaStyleName({ parent: 'TextBody', align: metaAlign, fontSizePt: 12 })}">${xmlEscape(md.university)}</text:p>`,
        );
      }
      ctx.body.push(
        `<text:p text:style-name="${layoutParaStyleName({ parent: 'TextBody', align: metaAlign, fontSizePt: 11, color: '#586069' })}">Generated: ${xmlEscape(new Date(model.generatedAt).toLocaleString())}</text:p>`,
      );
      if (md.version) {
        ctx.body.push(
          `<text:p text:style-name="${layoutParaStyleName({ parent: 'TextBody', align: metaAlign, fontSizePt: 11, color: '#586069' })}">Version: ${xmlEscape(md.version)}</text:p>`,
        );
      }
      if (md.description) {
        ctx.body.push(
          `<text:p text:style-name="${layoutParaStyleName({ parent: 'TextBody', align: metaAlign, fontSizePt: 11 })}">${xmlEscape(md.description)}</text:p>`,
        );
      }
      break;
    }
    case 'projectHeader': {
      const index = model.projects.findIndex((p) => p.id === block.projectId);
      const project = model.projects[index];
      if (project) {
        ctx.body.push(
          `<text:p text:style-name="Heading1">${index + 1}. ${xmlEscape(project.label)}</text:p>`,
        );
      }
      break;
    }
    default:
      // Unknown block kinds are skipped defensively (never crash an export).
      break;
  }
}

export const odtExporter: DocumentExporter = {
  format: 'odt',
  label: 'OpenDocument Text (.odt)',
  mimeType: 'application/vnd.oasis.opendocument.text',
  extension: 'odt',
  async export(
    model: DocumentModel,
    options: ExportOptions,
  ): Promise<ExportResult> {
    const start = performance.now();

    const { xml, pictures } = await buildContentXml(model);

    const zip = new JSZip();
    // mimetype must be the first entry, stored uncompressed.
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text', {
      compression: 'STORE',
    });

    zip.file('META-INF/manifest.xml', buildManifestXml(pictures));
    zip.file('styles.xml', buildStylesXml(model.options, model));
    zip.file('meta.xml', buildMetaXml(model));
    zip.file('content.xml', xml);
    // Embedded images: real pixel binaries under Pictures/ (spec §12),
    // registered in the manifest above.
    for (const pic of pictures) {
      zip.file(pic.path, pic.bytes);
    }

    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.oasis.opendocument.text',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    const elapsed = performance.now() - start;
    return {
      blob,
      filename: `${options.filename || 'codice'}.odt`,
      format: 'odt',
      elapsedMs: elapsed,
    };
  },
};
