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
  DocumentModel,
  DocumentOptions,
  ExportOptions,
  ExportResult,
  FooterSlotType,
  HighlightedFile,
  HighlightedLine,
} from '@/types';
import type { DocumentExporter } from './types';
import { parseHex } from './colors';
import { getThemeColors } from '@/lib/highlight/highlighter';
import { formatBytes } from '@/lib/fileDiscovery';
import { splitRuns, GLYPH_FALLBACK_FONT } from './unicodeFallback';
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
export function computeTitlePageSpacerCm(options: DocumentOptions, pageHeightCm: number): number {
  const textHeightCm = Math.max(0, pageHeightCm - (options.margins.top + options.margins.bottom) / 10);
  const vAlign = options.titlePageVerticalAlignment ?? 'top';
  const offsetCm = Math.max(0, options.titlePageVerticalOffsetPt ?? 0) * PT_TO_CM;
  let spacer: number;
  if (vAlign === 'center') {
    // Center/Center places the group AT the center — the offset is a
    // top-mode nudge and must not skew centering (spec §9/§29).
    spacer = Math.max(0, (textHeightCm - TITLE_PAGE_GROUP_HEIGHT_CM) / 2);
  } else if (vAlign === 'bottom') {
    spacer = Math.max(0, textHeightCm - TITLE_PAGE_GROUP_HEIGHT_CM) + offsetCm;
  } else {
    spacer = offsetCm;
  }
  return Math.min(Math.max(spacer, 0), Math.max(0, textHeightCm - 2));
}

/**
 * Automatic styles for the title page (emitted into content.xml).
 *
 * All title-page paragraphs share ONE horizontal alignment (spec §9): three
 * automatic styles derive from the common Title / Subtitle / TextBody styles
 * and override fo:text-align. The vertical spacer style carries the computed
 * fo:margin-top that pushes the group toward its vertical position.
 */
function buildTitlePageAutoStyles(odfAlign: string, spacerCm: number): string {
  const alignProps = `<style:paragraph-properties fo:text-align="${odfAlign}" />`;
  const styles = [
    `<style:style style:name="TPTitle" style:family="paragraph" style:parent-style-name="Title">${alignProps}</style:style>`,
    `<style:style style:name="TPSubtitle" style:family="paragraph" style:parent-style-name="Subtitle">${alignProps}</style:style>`,
    `<style:style style:name="TPBody" style:family="paragraph" style:parent-style-name="TextBody">${alignProps}</style:style>`,
  ];
  // Only emit the spacer style when it actually moves the group — avoids a
  // stray empty first line for the default top/zero-offset layout.
  if (spacerCm >= 0.05) {
    styles.push(
      `<style:style style:name="TPSpacer" style:family="paragraph"><style:paragraph-properties fo:margin-top="${spacerCm.toFixed(2)}cm" fo:margin-bottom="0cm" /></style:style>`,
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

/**
 * Master-page header/footer for the ODT. Structured slots are flattened to
 * a single region (the primary slot) — OpenDocument master pages render one
 * paragraph per region, and the primary slot preserves the template tokens
 * ({page}, {pages}, …) as live text fields.
 */
function buildMasterHeaderFooter(options: DocumentOptions, ctx: TokenContext): string {
  let xml = '';
  const showHeader = options.pageHeaderShow ?? Boolean(options.pageHeader);
  const showFooter = options.pageFooterShow ?? Boolean(options.pageFooter);
  if (showHeader) {
    const layout = options.pageHeaderLayout ?? 'single';
    let text = '';
    if (layout === 'single') {
      text = options.pageHeaderCenter ?? options.pageHeader ?? '';
    } else if (layout === 'dual') {
      text = [options.pageHeaderLeft, options.pageHeaderRight].filter(Boolean).join('    ');
    } else {
      text = [options.pageHeaderLeft, options.pageHeaderCenter, options.pageHeaderRight].filter(Boolean).join('    ');
    }
    if (text) {
      xml += `<style:header><text:p text:style-name="PageHeaderPara">${odtHeaderFooterInner(text, ctx)}</text:p></style:header>`;
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
    let template: string;
    if (layout === 'single') {
      template = options.pageFooterCenter ? slotText(options.pageFooterCenter) : (options.pageFooter ?? '');
    } else if (layout === 'dual') {
      template = [slotText(options.pageFooterLeft), slotText(options.pageFooterRight)].filter(Boolean).join('    ');
    } else {
      template = [slotText(options.pageFooterLeft), slotText(options.pageFooterCenter), slotText(options.pageFooterRight)]
        .filter(Boolean)
        .join('    ');
    }
    if (template) {
      // Convert remaining {page}/{pages} tokens into live ODT text fields.
      const inner = odtHeaderFooterInner(template, ctx);
      xml += `<style:footer><text:p text:style-name="PageFooterPara">${inner}</text:p></style:footer>`;
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

/** Build the META-INF/manifest.xml content. */
function buildManifestXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest
    xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"
    manifest:version="1.2">
  <manifest:file-entry manifest:media-type="application/vnd.oasis.opendocument.text" manifest:full-path="/" />
  <manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml" />
  <manifest:file-entry manifest:media-type="text/xml" manifest:full-path="styles.xml" />
  <manifest:file-entry manifest:media-type="text/xml" manifest:full-path="meta.xml" />
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
    parts.push(
      `<text:span style:use-optimal-column-width="false" fo:color="#999999">${xmlEscapeWithSpaces(numStr + ' ')}</text:span>`,
    );
  }

  for (const tok of line.tokens) {
    const text = line.text.slice(tok.start, tok.start + tok.length);
    if (text.length === 0) continue;
    const color = tok.color ?? defaultColor;
    const baseAttrs = [`fo:color="#${hexToOdf(color)}"`];
    if (tok.bold) baseAttrs.push('fo:font-weight="bold"');
    if (tok.italic) baseAttrs.push('fo:font-style="italic"');
    if (tok.underline) baseAttrs.push('style:text-underline-style="solid"');
    // Only box-drawing glyph runs switch to the fallback font.
    for (const run of splitRuns(text)) {
      const attrs = run.fallback ? [...baseAttrs, `fo:font-family="${GLYPH_FALLBACK_FONT}"`] : baseAttrs;
      parts.push(`<text:span ${attrs.join(' ')}>${xmlEscapeWithSpaces(run.text)}</text:span>`);
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

/** Build the content.xml for the document. */
async function buildContentXml(model: DocumentModel): Promise<string> {
  const opts = model.options;
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

  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(
    `<office:document-content
        xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
        xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
        xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
        xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
        xmlns:xlink="http://www.w3.org/1999/xlink"
        office:version="1.2">`,
  );

  // Title-page support styles (group alignment + vertical spacer, §9/§21).
  // Defined as automatic styles so they only ship when a title page exists.
  const titleAlign = titleAlignToOdf(opts.titlePageHorizontalAlignment);
  const pageDims = PAGE_DIMENSIONS_CM[opts.pageSize] ?? PAGE_DIMENSIONS_CM.A4;
  const titleSpacerCm = computeTitlePageSpacerCm(opts, pageDims[1]);
  if (opts.includeFrontMatter) {
    parts.push(`<office:automatic-styles>${buildTitlePageAutoStyles(titleAlign, titleSpacerCm)}</office:automatic-styles>`);
  }

  parts.push(`<office:body>`);
  parts.push(`<office:text>`);

  // Front matter — the WHOLE title-page group (title, subtitle, author,
  // course, university, generated, version, description) shares one
  // horizontal alignment; a computed spacer paragraph positions it
  // vertically on the page.
  if (opts.includeFrontMatter) {
    const md = model.metadata;
    if (titleSpacerCm >= 0.05) {
      parts.push(`<text:p text:style-name="TPSpacer"/>`);
    }
    parts.push(
      `<text:p text:style-name="TPTitle">${xmlEscape(md.title ?? 'Project Report')}</text:p>`,
    );
    if (md.subtitle)
      parts.push(
        `<text:p text:style-name="TPSubtitle">${xmlEscape(md.subtitle)}</text:p>`,
      );
    if (md.author)
      parts.push(
        `<text:p text:style-name="TPSubtitle">${xmlEscape(md.author)}</text:p>`,
      );
    if (md.course)
      parts.push(
        `<text:p text:style-name="TPSubtitle">${xmlEscape(md.course)}</text:p>`,
      );
    if (md.university)
      parts.push(
        `<text:p text:style-name="TPSubtitle">${xmlEscape(md.university)}</text:p>`,
      );
    parts.push(
      `<text:p text:style-name="TPSubtitle">Generated: ${xmlEscape(new Date(model.generatedAt).toLocaleString())}</text:p>`,
    );
    if (md.version)
      parts.push(
        `<text:p text:style-name="TPSubtitle">Version: ${xmlEscape(md.version)}</text:p>`,
      );
    if (md.description)
      parts.push(
        `<text:p text:style-name="TPBody">${xmlEscape(md.description)}</text:p>`,
      );
    parts.push(`<text:p><text:soft-page-break/></text:p>`);
  }

  // Table of contents (static)
  if (opts.includeToc) {
    parts.push(`<text:p text:style-name="Heading1">Table of Contents</text:p>`);
    let n = 1;
    for (const project of model.projects) {
      parts.push(
        `<text:p text:style-name="TextBody">${n}. ${xmlEscape(project.label)}</text:p>`,
      );
      let m = 1;
      for (const file of project.files) {
        const meta = opts.showFileMetadata
          ? `   ${n}.${m}  ${xmlEscape(file.relativePath)}  ·  ${languageLabel(file.language)} · ${formatBytes(file.sizeBytes)}`
          : `   ${n}.${m}  ${xmlEscape(file.relativePath)}`;
        parts.push(`<text:p text:style-name="TextBody">${meta}</text:p>`);
        m++;
      }
      n++;
    }
    parts.push(`<text:p><text:soft-page-break/></text:p>`);
  }

  // Per-project
  let projectN = 0;
  for (const project of model.projects) {
    projectN++;
    parts.push(
      `<text:p text:style-name="Heading1">${projectN}. ${xmlEscape(project.label)}</text:p>`,
    );

    if (opts.includeProjectStructure) {
      parts.push(
        `<text:p text:style-name="Heading2">Project Structure: ${xmlEscape(project.label)}</text:p>`,
      );
      const root = buildTree(project.structurePaths);
      const lines: string[] = [];
      renderTree(root, '', true, lines);
      for (const line of lines) {
        // Whitespace preservation matters here too: nested tree prefixes
        // ("│   " / "    ") are pure space runs that would otherwise collapse.
        const runs = splitRuns(line)
          .map((run) =>
            run.fallback
              ? `<text:span fo:font-family="${GLYPH_FALLBACK_FONT}">${xmlEscapeWithSpaces(run.text)}</text:span>`
              : xmlEscapeWithSpaces(run.text),
          )
          .join('');
        parts.push(`<text:p text:style-name="CodeLine">${runs}</text:p>`);
      }
    }

    parts.push(`<text:p text:style-name="Heading2">Source Files</text:p>`);

    let fileN = 0;
    for (const file of project.files) {
      fileN++;
      parts.push(
        `<text:p text:style-name="Heading3">${projectN}.${fileN}  ${xmlEscape(file.relativePath)}</text:p>`,
      );
      if (opts.showFileHeaders) {
        parts.push(renderFileHeader(file, opts));
      }
      for (const line of file.highlighted.lines) {
        parts.push(renderCodeLine(line, opts, lineNumberWidth, defaultColor));
      }
    }
  }

  parts.push(`</office:text>`);
  parts.push(`</office:body>`);
  parts.push(`</office:document-content>`);

  return parts.join('\n');
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

    const zip = new JSZip();
    // mimetype must be the first entry, stored uncompressed.
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text', {
      compression: 'STORE',
    });

    zip.file('META-INF/manifest.xml', buildManifestXml());
    zip.file('styles.xml', buildStylesXml(model.options, model));
    zip.file('meta.xml', buildMetaXml(model));
    zip.file('content.xml', await buildContentXml(model));

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
