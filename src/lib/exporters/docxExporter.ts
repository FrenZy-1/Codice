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
  HighlightedFile,
  HighlightedLine,
  HighlightToken,
} from '@/types';
import type { DocumentExporter } from './types';
import { parseHex } from './colors';
import { getThemeColors } from '@/lib/highlight/highlighter';
import { formatBytes } from '@/lib/fileDiscovery';

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
    children.push(
      new TextRun({
        text,
        font: options.codeFont,
        size: halfPoints(options.codeFontSize),
        color: runColor(tok.color, defaultColor),
        bold: tok.bold,
        italics: tok.italic,
        underline: tok.underline ? { type: 'single' } : undefined,
      }),
    );
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

  return new Paragraph({
    children,
    shading,
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

/** Build a header paragraph for a file. */
function buildFileHeader(
  relativePath: string,
  language: string | null,
  sizeBytes: number,
  options: DocumentOptions,
): Paragraph {
  const text = `${relativePath}    ·    ${languageLabel(language)}    ·    ${formatBytes(sizeBytes)}`;
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: options.codeFont,
        size: halfPoints(options.codeFontSize - 1),
        color: '586069'.toUpperCase(),
        bold: true,
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

/** Build the front-matter (title) page. */
function buildFrontMatter(model: DocumentModel): Paragraph[] {
  const md = model.metadata;
  const out: Paragraph[] = [];

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
      spacing: { before: 2000, after: 400 },
      alignment: AlignmentType.CENTER,
    }),
  );

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
        alignment: AlignmentType.CENTER,
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
        alignment: AlignmentType.CENTER,
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
        alignment: AlignmentType.CENTER,
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
      alignment: AlignmentType.CENTER,
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
        alignment: AlignmentType.CENTER,
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
        alignment: AlignmentType.CENTER,
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
      out.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `   ${n}.${m}  ${file.relativePath}`,
              size: 22,
              font: model.options.bodyFont,
            }),
          ],
          spacing: { after: 20 },
        }),
      );
      m++;
    }
    n++;
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

  // Build a tree from the structurePaths.
  const root = buildTree(project.structurePaths);
  const lines: string[] = [];
  renderTree(root, '', true, lines);
  for (const line of lines) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({
            text: line,
            font: model.options.codeFont,
            size: halfPoints(model.options.codeFontSize - 1),
          }),
        ],
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
        children.push(
          buildFileHeader(
            file.relativePath,
            file.language,
            file.sizeBytes,
            opts,
          ),
        );
      }

      for (const line of file.highlighted.lines) {
        children.push(buildCodeLine(line, opts, lineNumberWidth, defaultColor));
      }
    }
  }

  // Page header
  const header = opts.pageHeader
    ? new Header({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: opts.pageHeader,
                size: 18,
                color: '808080',
                font: opts.bodyFont,
              }),
            ],
            alignment: AlignmentType.RIGHT,
          }),
        ],
      })
    : undefined;

  // Page footer with page numbers
  let footer: Footer | undefined;
  if (opts.pageFooter) {
    const template = opts.pageFooter;
    const parts = template.split(/(\{page\}|\{pages\})/g);
    const runs: any[] = [];
    for (const part of parts) {
      if (part === '{page}') {
        runs.push(
          new TextRun({
            children: [PageNumber.CURRENT],
            size: 18,
            color: '808080',
            font: opts.bodyFont,
          }),
        );
      } else if (part === '{pages}') {
        runs.push(
          new TextRun({
            children: [PageNumber.TOTAL_PAGES],
            size: 18,
            color: '808080',
            font: opts.bodyFont,
          }),
        );
      } else if (part) {
        runs.push(
          new TextRun({
            text: part,
            size: 18,
            color: '808080',
            font: opts.bodyFont,
          }),
        );
      }
    }
    footer = new Footer({
      children: [
        new Paragraph({
          children: runs,
          alignment: AlignmentType.CENTER,
        }),
      ],
    });
  }

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
