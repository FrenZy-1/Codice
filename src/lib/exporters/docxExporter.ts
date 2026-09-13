/**
 * DOCX exporter.
 *
 * Uses the `docx` library to produce Word documents entirely in the browser.
 * Syntax highlighting is preserved by emitting colored runs for each token.
 * Line numbers (when enabled) are emitted as a separate monospaced run at
 * the start of each line, with a distinct colour so they remain visually
 * separate from the code text.
 */

import {
  AlignmentType,
  BorderStyle,
  Document as DocxDocument,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopPosition,
  TabStopType,
  TextRun,
  WidthType,
  convertInchesToTwip,
  convertMillimetersToTwip,
} from 'docx';
import type {
  DocumentModel,
  DocumentOptions,
  ExportOptions,
  ExportResult,
  FooterSlotType,
  HighlightedFile,
  HighlightedLine,
  HighlightToken,
} from '@/types';
import type { DocumentExporter } from './types';
import { parseHex } from './colors';
import { getThemeColors } from '@/lib/highlight/highlighter';
import { formatBytes } from '@/lib/fileDiscovery';
import { splitRuns, GLYPH_FALLBACK_FONT } from './unicodeFallback';
import {
  buildStaticTokenContext,
  expandTokens,
  tokenizeTemplate,
  type TokenContext,
} from '@/lib/tokens';

/** Build a filename for the export. */
function buildFilename(options: ExportOptions): string {
  return `${options.filename || 'codice'}.docx`;
}

/** Convert hex (#rrggbb) to a docx-compatible hex string without #. */
function hexNoHash(hex: string): string {
  return hex.replace(/^#/, '').toUpperCase().padEnd(6, '0').slice(0, 6);
}

/** Convert a color hex into a docx run color string. */
function runColor(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  return hexNoHash(color);
}

/** Page size mapping. */
const PAGE_SIZES_MM: Record<string, [number, number]> = {
  A4: [210, 297],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  A3: [297, 420],
};

/** Page dimensions in twips (portrait) — used to position the title-page group vertically. */
const PAGEDimensions: Record<string, [number, number]> = {
  A4: [11906, 16838],
  Letter: [12240, 15840],
  Legal: [12240, 20160],
  A3: [16838, 23811],
};

/** Approximate height of the whole title-page group in twips (vertical layout). */
const TITLE_GROUP_HEIGHT_TWIPS = 6000;

/** Millimetres to twips for the title-page vertical layout (1 mm ≈ 56.7 twips). */
const MM_TO_TWIP_TITLE_PAGE = 56.7;

/** Map a code border style to the docx BorderStyle enum. */
function codeBorderStyle(style: 'solid' | 'dotted' | 'dashed' | undefined): (typeof BorderStyle)[keyof typeof BorderStyle] {
  if (style === 'dotted') return BorderStyle.DOTTED;
  if (style === 'dashed') return BorderStyle.DASHED;
  return BorderStyle.SINGLE;
}

/** Build a single line of code as a paragraph. */
function buildCodeLine(
  line: HighlightedLine,
  options: DocumentOptions,
  lineNumberWidth: number,
  defaultColor: string,
): Paragraph {
  const children: any[] = [];

  if (options.showLineNumbers) {
    const numStr = String(line.lineNumber).padStart(lineNumberWidth, ' ');
    children.push(
      new TextRun({
        text: numStr + ' ',
        font: options.codeFont,
        size: halfPoints(options.codeFontSize),
        color: '999999'.toUpperCase(),
      }),
    );
  }

  for (const tok of line.tokens) {
    const text = line.text.slice(tok.start, tok.start + tok.length);
    if (text.length === 0) continue;
    // Targeted Unicode fallback: only runs containing box-drawing glyphs
    // switch to the fallback font — the user's code font stays authoritative.
    for (const run of splitRuns(text)) {
      children.push(
        new TextRun({
          text: run.text,
          font: run.fallback ? GLYPH_FALLBACK_FONT : options.codeFont,
          size: halfPoints(options.codeFontSize),
          color: runColor(tok.color, defaultColor),
          bold: tok.bold,
          italics: tok.italic,
          underline: tok.underline ? { type: 'single' } : undefined,
        }),
      );
    }
  }

  // Empty line — emit a single space so the paragraph has visible height.
  if (children.length === 0) {
    children.push(
      new TextRun({
        text: ' ',
        font: options.codeFont,
        size: halfPoints(options.codeFontSize),
      }),
    );
  }

  const shading = options.codeBackground
    ? {
        type: ShadingType.SOLID,
        color: hexNoHash(options.codeBackground),
        fill: hexNoHash(options.codeBackground),
      }
    : undefined;

  // Code block border — solid / dotted / dashed, fully disabled when unset.
  const codeBorder =
    options.codeBorderColor && options.codeBorderStyle
      ? {
          top: { style: codeBorderStyle(options.codeBorderStyle), size: Math.max(2, Math.round(options.codeBorderWidth * 8)), color: hexNoHash(options.codeBorderColor), space: 2 },
          bottom: { style: codeBorderStyle(options.codeBorderStyle), size: Math.max(2, Math.round(options.codeBorderWidth * 8)), color: hexNoHash(options.codeBorderColor), space: 2 },
          left: { style: codeBorderStyle(options.codeBorderStyle), size: Math.max(2, Math.round(options.codeBorderWidth * 8)), color: hexNoHash(options.codeBorderColor), space: 4 },
          right: { style: codeBorderStyle(options.codeBorderStyle), size: Math.max(2, Math.round(options.codeBorderWidth * 8)), color: hexNoHash(options.codeBorderColor), space: 4 },
        }
      : undefined;

  return new Paragraph({
    children,
    shading,
    border: codeBorder,
    spacing: {
      before: 0,
      after: 0,
      line: lineSpacingTwips(options.codeLineHeight, options.codeFontSize),
      lineRule: 'exact',
    },
    indent: { left: 0, right: 0 },
    alignment: AlignmentType.LEFT,
  });
}

/** Convert points to half-points (docx unit for font size). */
function halfPoints(pt: number): number {
  return Math.round(pt * 2);
}

/** Compute line spacing in twentieths of a point. */
function lineSpacingTwips(lineHeight: number, fontSizePt: number): number {
  // 1 point = 20 twips
  return Math.round(lineHeight * fontSizePt * 20);
}

/** Build a header paragraph for a file — name/path/language/size are independent. */
function buildFileHeader(
  file: { relativePath: string; language: string | null; sizeBytes: number; highlighted: HighlightedFile },
  options: DocumentOptions,
): Paragraph {
  const name = file.relativePath.split('/').pop() ?? file.relativePath;
  const parts: string[] = [];
  if (options.showFileName !== false) parts.push(name);
  if (options.showRelativePath !== false) parts.push(file.relativePath);
  if (options.showLanguageLabel !== false) parts.push(languageLabel(file.language));
  if (options.showFileSize !== false) parts.push(formatBytes(file.sizeBytes));
  if (options.showLineCount === true) parts.push(`${file.highlighted.lines.length} lines`);
  const text = parts.join('    ·    ');
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: options.codeFont,
        size: halfPoints(options.codeFontSize - 1),
        color: '586069'.toUpperCase(),
        bold: options.showFileHeaderBold ?? true,
      }),
    ],
    spacing: { before: 200, after: 100 },
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        size: 4,
        color: 'd0d7de'.toUpperCase(),
        space: 4,
      },
    },
  });
}

/** Map language id to a friendly label. */
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

/** Map the title-page horizontal alignment to a docx AlignmentType (default center). */
function titlePageAlignmentType(
  alignment: 'left' | 'center' | 'right' | undefined,
): (typeof AlignmentType)[keyof typeof AlignmentType] {
  if (alignment === 'left') return AlignmentType.LEFT;
  if (alignment === 'right') return AlignmentType.RIGHT;
  return AlignmentType.CENTER;
}

/**
 * Compute the title paragraph's spacing.before so the title-page group sits at
 * the requested vertical position within the page text area (spec §9/§29).
 * 1 pt = 20 twips; the group height is approximated as 6000 twips.
 */
function titlePageSpacingBefore(options: DocumentOptions): number {
  const [pageWTwips, pageHTwips] = PAGEDimensions[options.pageSize] ?? PAGEDimensions.A4;
  // Landscape swaps the portrait dimensions (mirrors the section size setup).
  const pageHeightTwips = options.landscape ? pageWTwips : pageHTwips;
  const marginTopTwips = Math.round(options.margins.top * MM_TO_TWIP_TITLE_PAGE);
  const marginBottomTwips = Math.round(options.margins.bottom * MM_TO_TWIP_TITLE_PAGE);
  const textAreaHeight = Math.max(0, pageHeightTwips - marginTopTwips - marginBottomTwips);
  const offsetTwips = Math.round((options.titlePageVerticalOffsetPt ?? 100) * 20);
  const vertical = options.titlePageVerticalAlignment ?? 'top';
  if (vertical === 'center') {
    // Center/Center places the group AT the center — the offset is a
    // top-mode nudge and must not skew centering (spec §9/§29).
    return Math.max(0, Math.round((textAreaHeight - TITLE_GROUP_HEIGHT_TWIPS) / 2));
  }
  if (vertical === 'bottom') {
    return Math.max(marginTopTwips, Math.max(0, textAreaHeight - TITLE_GROUP_HEIGHT_TWIPS) - offsetTwips);
  }
  // top — with the 100pt default offset this preserves the historical ~2000
  // twips of breathing room below the top margin.
  return marginTopTwips + offsetTwips;
}

/** Build the front-matter (title) page. */
export function buildFrontMatter(model: DocumentModel): Paragraph[] {
  const md = model.metadata;
  const out: Paragraph[] = [];

  // The title page is ONE coherent group: every paragraph shares the same
  // horizontal alignment, and the group's vertical position comes from the
  // title paragraph's spacing.before.
  const alignment = titlePageAlignmentType(model.options.titlePageHorizontalAlignment);
  const titleSpacingBefore = titlePageSpacingBefore(model.options);

  out.push(
    new Paragraph({
      children: [
        new TextRun({
          text: md.title ?? 'Project Report',
          bold: true,
          size: 56,
          font: model.options.headingFont,
        }),
      ],
      spacing: { before: titleSpacingBefore, after: 400 },
      alignment,
    }),
  );

  if (md.subtitle) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({
            text: md.subtitle,
            italics: true,
            size: 28,
            font: model.options.bodyFont,
          }),
        ],
        alignment,
        spacing: { after: 200 },
      }),
    );
  }

  if (md.author) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({
            text: md.author,
            size: 28,
            font: model.options.bodyFont,
          }),
        ],
        alignment,
        spacing: { after: 200 },
      }),
    );
  }

  if (md.course) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({
            text: md.course,
            size: 24,
            font: model.options.bodyFont,
          }),
        ],
        alignment,
        spacing: { after: 100 },
      }),
    );
  }

  if (md.university) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({
            text: md.university,
            size: 24,
            font: model.options.bodyFont,
          }),
        ],
        alignment,
        spacing: { after: 100 },
      }),
    );
  }

  out.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Generated: ${new Date(model.generatedAt).toLocaleString()}`,
          size: 22,
          color: '586069'.toUpperCase(),
          font: model.options.bodyFont,
        }),
      ],
      alignment,
      spacing: { before: 600 },
    }),
  );

  if (md.version) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Version: ${md.version}`,
            size: 22,
            color: '586069'.toUpperCase(),
            font: model.options.bodyFont,
          }),
        ],
        alignment,
        spacing: { after: 100 },
      }),
    );
  }

  if (md.description) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({
            text: md.description,
            size: 22,
            font: model.options.bodyFont,
          }),
        ],
        alignment,
        spacing: { before: 400 },
      }),
    );
  }

  // Page break after front matter
  out.push(
    new Paragraph({
      children: [new PageBreak()],
    }),
  );

  return out;
}

/** Build a table-of-contents section. */
function buildToc(model: DocumentModel): Paragraph[] {
  const out: Paragraph[] = [];
  out.push(
    new Paragraph({
      text: 'Table of Contents',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 200, after: 200 },
    }),
  );

  // Use docx's TableOfContents — Word will populate it on open.
  // We emit a placeholder instructing the user to update the TOC field.
  out.push(
    new Paragraph({
      children: [
        new TextRun({
          text: '(Update this field in Word: right-click → Update Field)',
          italics: true,
          color: '808080',
          size: 18,
        }),
      ],
      spacing: { after: 200 },
    }),
  );

  // Emit a static TOC as a fallback for viewers that don't update fields.
  let n = 1;
  for (const project of model.projects) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${n}. ${project.label}`,
            bold: true,
            size: 24,
            font: model.options.headingFont,
          }),
        ],
        spacing: { before: 100, after: 40 },
      }),
    );
    let m = 1;
    for (const file of project.files) {
      const meta = model.options.showFileMetadata
        ? `   ${n}.${m}  ${file.relativePath}  ·  ${languageLabel(file.language)} · ${formatBytes(file.sizeBytes)}`
        : `   ${n}.${m}  ${file.relativePath}`;
      out.push(
        new Paragraph({
          children: [
            new TextRun({
              text: meta,
              size: 22,
              font: model.options.bodyFont,
            }),
          ],
          spacing: { after: 20 },
        }),
      );
      m += 1;
    }
    n += 1;
  }

  out.push(
    new Paragraph({
      children: [new PageBreak()],
    }),
  );

  return out;
}

/** Build a tree-like text representation of project structure. */
function buildProjectStructure(
  model: DocumentModel,
  project: DocumentModel['projects'][number],
): Paragraph[] {
  const out: Paragraph[] = [];
  out.push(
    new Paragraph({
      text: `Project Structure: ${project.label}`,
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 100 },
    }),
  );

  // Build a tree from the structurePaths. Box-drawing glyphs are split into
  // fallback-font runs so they render in every viewer.
  const root = buildTree(project.structurePaths);
  const lines: string[] = [];
  renderTree(root, '', true, lines);
  for (const line of lines) {
    const children: any[] = splitRuns(line).map((run) =>
      new TextRun({
        text: run.text,
        font: run.fallback ? GLYPH_FALLBACK_FONT : model.options.codeFont,
        size: halfPoints(model.options.codeFontSize - 1),
      }),
    );
    out.push(
      new Paragraph({
        children,
        spacing: { before: 0, after: 0 },
      }),
    );
  }
  return out;
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

/** Convert millimetres to docx twips. */
function mmToTwip(mm: number): number {
  return convertMillimetersToTwip(mm);
}

const HF_GRAY = '808080';
const HF_SIZE = 18;

function hfTextRun(text: string, font: string): TextRun {
  return new TextRun({ text, size: HF_SIZE, color: HF_GRAY, font });
}

/**
 * Expand a header/footer text template into runs. `{page}` / `{pages}`
 * become live Word PAGE / NUMPAGES fields; every other known token is
 * resolved from the token context; unknown tokens are kept literally.
 */
function templateRuns(template: string, font: string, ctx: TokenContext): TextRun[] {
  const runs: TextRun[] = [];
  for (const part of tokenizeTemplate(template)) {
    if (part.kind === 'token') {
      if (part.value === '{page}') {
        runs.push(new TextRun({ children: [PageNumber.CURRENT], size: HF_SIZE, color: HF_GRAY, font }));
        continue;
      }
      if (part.value === '{pages}') {
        runs.push(new TextRun({ children: [PageNumber.TOTAL_PAGES], size: HF_SIZE, color: HF_GRAY, font }));
        continue;
      }
      const resolved = expandTokens(part.value, ctx);
      if (resolved !== part.value || ctxKey(part.value) in ctx) {
        runs.push(hfTextRun(resolved, font));
      } else {
        runs.push(hfTextRun(part.value, font));
      }
    } else if (part.value) {
      runs.push(hfTextRun(part.value, font));
    }
  }
  return runs;
}

/** Extract the bare key from a `{key}` token string. */
function ctxKey(token: string): string {
  return token.slice(1, -1);
}

/** Build the page header with single / dual / triple layout regions. */
function buildHeader(opts: DocumentOptions, contentWidthTwips: number, ctx: TokenContext): Header | undefined {
  const show = opts.pageHeaderShow ?? Boolean(opts.pageHeader);
  if (!show) return undefined;
  const layout = opts.pageHeaderLayout ?? 'single';
  const align = opts.pageHeaderAlign ?? 'right';

  const singleRuns = () => {
    const text = opts.pageHeaderCenter ?? opts.pageHeader ?? '';
    if (!text) return null;
    return templateRuns(text, opts.bodyFont, ctx);
  };
  const dualRuns = () => {
    const left = opts.pageHeaderLeft ?? '';
    const right = opts.pageHeaderRight ?? '';
    if (!left && !right) return null;
    return [
      ...templateRuns(left, opts.bodyFont, ctx),
      new TextRun({ text: '\t', size: HF_SIZE }),
      ...templateRuns(right, opts.bodyFont, ctx),
    ];
  };
  const tripleRuns = () => {
    const left = opts.pageHeaderLeft ?? '';
    const center = opts.pageHeaderCenter ?? '';
    const right = opts.pageHeaderRight ?? '';
    if (!left && !center && !right) return null;
    return [
      ...templateRuns(left, opts.bodyFont, ctx),
      new TextRun({ text: '\t', size: HF_SIZE }),
      ...templateRuns(center, opts.bodyFont, ctx),
      new TextRun({ text: '\t', size: HF_SIZE }),
      ...templateRuns(right, opts.bodyFont, ctx),
    ];
  };

  let runs: TextRun[] | null;
  let alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT;
  let tabStops;
  if (layout === 'single') {
    runs = singleRuns();
    alignment =
      align === 'left' ? AlignmentType.LEFT : align === 'center' ? AlignmentType.CENTER : AlignmentType.RIGHT;
  } else if (layout === 'dual') {
    runs = dualRuns();
    tabStops = [{ type: TabStopType.RIGHT, position: contentWidthTwips }];
  } else {
    runs = tripleRuns();
    tabStops = [
      { type: TabStopType.CENTER, position: Math.round(contentWidthTwips / 2) },
      { type: TabStopType.RIGHT, position: contentWidthTwips },
    ];
  }
  if (!runs) return undefined;
  return new Header({
    children: [
      new Paragraph({
        children: runs,
        alignment,
        tabStops,
      }),
    ],
  });
}

/**
 * Build the page footer with structured slots. Only values that can be
 * calculated reliably in Word are rendered as fields (page number / page
 * count); per-page line counts, file names, and project names are not
 * available to Word's header engine, so those slots render as the
 * generation date or a literal value instead.
 */
function buildFooter(opts: DocumentOptions, contentWidthTwips: number, ctx: TokenContext): Footer | undefined {
  const show = opts.pageFooterShow ?? Boolean(opts.pageFooter);
  if (!show) return undefined;
  const layout = opts.pageFooterLayout ?? 'single';
  const align = opts.pageFooterAlign ?? 'center';

  /** Render one slot's runs. `position` biases literal fallbacks. */
  const slotRuns = (type: FooterSlotType | undefined): any[] => {
    switch (type) {
      case 'pageNumber':
        return [new TextRun({ children: [PageNumber.CURRENT], size: HF_SIZE, color: HF_GRAY, font: opts.bodyFont })];
      case 'pageCount':
        return [new TextRun({ children: [PageNumber.TOTAL_PAGES], size: HF_SIZE, color: HF_GRAY, font: opts.bodyFont })];
      case 'date':
        return [hfTextRun(new Date().toLocaleDateString(), opts.bodyFont)];
      case 'text':
        return templateRuns(opts.pageFooterText ?? '', opts.bodyFont, ctx);
      case 'linesOnPage':
      case 'fileName':
      case 'projectName':
      case 'none':
      default:
        return [];
    }
  };

  let children: any[];
  let alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.CENTER;
  let tabStops;
  if (layout === 'single') {
    children = slotRuns(opts.pageFooterCenter ?? 'pageNumber');
    if (children.length === 0) {
      // Legacy fallback: template string with {page}/{pages} tokens.
      children = templateRuns(opts.pageFooter ?? '', opts.bodyFont, ctx);
    }
    alignment =
      align === 'left' ? AlignmentType.LEFT : align === 'center' ? AlignmentType.CENTER : AlignmentType.RIGHT;
  } else if (layout === 'dual') {
    children = [...slotRuns(opts.pageFooterLeft), new TextRun({ text: '\t', size: HF_SIZE }), ...slotRuns(opts.pageFooterRight)];
    tabStops = [{ type: TabStopType.RIGHT, position: contentWidthTwips }];
    alignment = AlignmentType.LEFT;
  } else {
    children = [
      ...slotRuns(opts.pageFooterLeft),
      new TextRun({ text: '\t', size: HF_SIZE }),
      ...slotRuns(opts.pageFooterCenter),
      new TextRun({ text: '\t', size: HF_SIZE }),
      ...slotRuns(opts.pageFooterRight),
    ];
    tabStops = [
      { type: TabStopType.CENTER, position: Math.round(contentWidthTwips / 2) },
      { type: TabStopType.RIGHT, position: contentWidthTwips },
    ];
    alignment = AlignmentType.LEFT;
  }
  if (children.length === 0) return undefined;
  return new Footer({
    children: [new Paragraph({ children, alignment, tabStops })],
  });
}



/** Build the docx Document object from a DocumentModel. */
async function buildDocx(model: DocumentModel): Promise<DocxDocument> {
  const opts = model.options;
  const [pageW, pageH] = PAGE_SIZES_MM[opts.pageSize] ?? PAGE_SIZES_MM.A4;
  const orientation = opts.landscape
    ? PageOrientation.LANDSCAPE
    : PageOrientation.PORTRAIT;

  // Compute the longest line number width across all files (for alignment).
  let maxLineNum = 0;
  for (const project of model.projects) {
    for (const file of project.files) {
      if (file.highlighted.lines.length > maxLineNum) {
        maxLineNum = file.highlighted.lines.length;
      }
    }
  }
  const lineNumberWidth = String(maxLineNum).length;

  // Determine default foreground color from the theme.
  let defaultColor = '24292e';
  try {
    const colors = await getThemeColors(opts.syntaxTheme);
    defaultColor = hexNoHash(colors.foreground);
  } catch {
    // ignore
  }

  const children: Paragraph[] = [];

  if (opts.includeFrontMatter) {
    children.push(...buildFrontMatter(model));
  }

  if (opts.includeToc) {
    children.push(...buildToc(model));
  }

  // Per-project sections
  let projectIndex = 0;
  for (const project of model.projects) {
    projectIndex++;
    children.push(
      new Paragraph({
        text: `${projectIndex}. ${project.label}`,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 },
        pageBreakBefore: projectIndex > 1 || opts.includeToc,
      }),
    );

    if (opts.includeProjectStructure) {
      children.push(...buildProjectStructure(model, project));
    }

    children.push(
      new Paragraph({
        text: 'Source Files',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
      }),
    );

    let fileIndex = 0;
    for (const file of project.files) {
      fileIndex++;
      const heading = new Paragraph({
        text: `${projectIndex}.${fileIndex}  ${file.relativePath}`,
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 100 },
        pageBreakBefore:
          opts.pageBreakBetweenFiles && !(projectIndex === 1 && fileIndex === 1),
      });
      children.push(heading);

      if (opts.showFileHeaders) {
        children.push(buildFileHeader(file, opts));
      }

      for (const line of file.highlighted.lines) {
        children.push(buildCodeLine(line, opts, lineNumberWidth, defaultColor));
      }
    }
  }

  // Page header — structured single / dual / triple layouts.
  const contentWidthTwips = mmToTwip(opts.landscape ? pageH : pageW) - mmToTwip(opts.margins.left) - mmToTwip(opts.margins.right);

  // Shared token context — same engine the preview uses, so header/footer
  // tokens resolve to identical values in preview and export.
  const hfCtx: TokenContext = {
    ...buildStaticTokenContext({
      metadata: model.metadata,
      firstProjectLabel: model.projects[0]?.label ?? null,
      fileCount: model.projects.reduce((acc, p) => acc + p.files.length, 0),
      now: new Date(model.generatedAt),
    }),
    fileName: model.projects[0]?.files[0]?.relativePath.split('/').pop() ?? '',
  };
  const header = buildHeader(opts, contentWidthTwips, hfCtx);

  // Page footer with structured slots.
  const footer = buildFooter(opts, contentWidthTwips, hfCtx);

  return new DocxDocument({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: mmToTwip(pageW),
              height: mmToTwip(pageH),
              orientation,
            },
            margin: {
              top: mmToTwip(opts.margins.top),
              right: mmToTwip(opts.margins.right),
              bottom: mmToTwip(opts.margins.bottom),
              left: mmToTwip(opts.margins.left),
            },
          },
        },
        headers: header ? { default: header } : undefined,
        footers: footer ? { default: footer } : undefined,
        children,
      },
    ],
    styles: {
      default: {
        document: {
          run: {
            font: opts.bodyFont,
            size: halfPoints(opts.bodyFontSize),
          },
        },
      },
    },
  });
}

// Re-export DocumentProject for the helper above.
import type { DocumentProject } from '@/types';

// (Module-level helper builds the project structure tree.)
type _DocProject = DocumentProject;

export const docxExporter: DocumentExporter = {
  format: 'docx',
  label: 'Word Document (.docx)',
  mimeType:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  extension: 'docx',
  async export(
    model: DocumentModel,
    options: ExportOptions,
  ): Promise<ExportResult> {
    const start = performance.now();
    const doc = await buildDocx(model);
    const blob = await Packer.toBlob(doc);
    const elapsed = performance.now() - start;
    return {
      blob,
      filename: buildFilename(options),
      format: 'docx',
      elapsedMs: elapsed,
    };
  },
};
