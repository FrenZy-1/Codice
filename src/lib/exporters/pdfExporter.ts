/**
 * PDF exporter using jsPDF.
 *
 * jsPDF is a pure-JavaScript PDF generator that works in the browser. We
 * render code by manually placing colored text runs at calculated positions
 * — this preserves syntax highlighting while keeping the text selectable.
 *
 * Page layout: code is laid out inside the configured margins, with a
 * background rectangle behind each code block (when configured).
 */

import { jsPDF } from 'jspdf';
import type {
  DocumentModel,
  DocumentOptions,
  ExportOptions,
  ExportResult,
  HighlightedFile,
  HighlightedLine,
} from '@/types';
import type { DocumentExporter } from './types';
import { parseHex, isLightColor } from './colors';
import { getThemeColors } from '@/lib/highlight/highlighter';
import { formatBytes } from '@/lib/fileDiscovery';

/** Page dimensions in points (1pt = 1/72 inch). */
const PAGE_DIMENSIONS_PT: Record<string, [number, number]> = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
  Legal: [612, 1008],
  A3: [841.89, 1190.55],
};

/** mm to pt conversion. */
const MM_TO_PT = 72 / 25.4;

interface LayoutState {
  doc: jsPDF;
  pageW: number;
  pageH: number;
  margin: { top: number; right: number; bottom: number; left: number };
  cursorY: number;
  page: number;
  options: DocumentOptions;
  defaultColor: { r: number; g: number; b: number };
}

/** Build the jsPDF document with all content. */
async function buildPdf(model: DocumentModel): Promise<jsPDF> {
  const opts = model.options;
  const [w, h] = PAGE_DIMENSIONS_PT[opts.pageSize] ?? PAGE_DIMENSIONS_PT.A4;
  const orientation = opts.landscape ? 'landscape' : 'portrait';
  const doc = new jsPDF({
    orientation,
    unit: 'pt',
    format: opts.pageSize.toLowerCase(),
  });

  // Pull theme foreground for the default code color.
  let defaultColor = { r: 36, g: 41, b: 46 };
  try {
    const tc = await getThemeColors(opts.syntaxTheme);
    defaultColor = parseHex(tc.foreground);
  } catch {
    // ignore
  }

  const state: LayoutState = {
    doc,
    pageW: opts.landscape ? h : w,
    pageH: opts.landscape ? w : h,
    margin: {
      top: opts.margins.top * MM_TO_PT,
      right: opts.margins.right * MM_TO_PT,
      bottom: opts.margins.bottom * MM_TO_PT,
      left: opts.margins.left * MM_TO_PT,
    },
    cursorY: opts.margins.top * MM_TO_PT,
    page: 1,
    options: opts,
    defaultColor,
  };

  // Front matter
  if (opts.includeFrontMatter) {
    renderFrontMatter(state, model);
    state.doc.addPage();
    state.cursorY = state.margin.top;
  }

  // Table of contents (simple static version)
  if (opts.includeToc) {
    renderToc(state, model);
    state.doc.addPage();
    state.cursorY = state.margin.top;
  }

  // Per-project sections
  let projectN = 0;
  for (const project of model.projects) {
    projectN++;
    if (projectN > 1) {
      state.doc.addPage();
      state.cursorY = state.margin.top;
    }
    renderHeading1(state, `${projectN}. ${project.label}`);

    if (opts.includeProjectStructure) {
      renderProjectStructure(state, project);
    }

    renderHeading2(state, 'Source Files');

    let fileN = 0;
    for (const file of project.files) {
      fileN++;
      if (opts.pageBreakBetweenFiles && !(projectN === 1 && fileN === 1)) {
        state.doc.addPage();
        state.cursorY = state.margin.top;
      }
      renderHeading3(state, `${projectN}.${fileN}  ${file.relativePath}`);
      if (opts.showFileHeaders) {
        renderFileHeader(state, file.relativePath, file.language, file.sizeBytes);
      }
      renderCodeBlock(state, file.highlighted);
    }
  }

  // Page header / footer
  applyHeaderFooter(state, model);

  return doc;
}

function renderFrontMatter(state: LayoutState, model: DocumentModel) {
  const { doc, pageW, pageH, options } = state;
  const md = model.metadata;

  const titleSize = 32;
  const titleY = pageH / 2 - 80;
  doc.setFont(options.headingFont, 'bold');
  doc.setFontSize(titleSize);
  doc.setTextColor(20, 20, 20);
  doc.text(md.title ?? 'Project Report', pageW / 2, titleY, { align: 'center' });

  let y = titleY + 50;
  doc.setFont(options.bodyFont, 'normal');
  doc.setFontSize(14);
  doc.setTextColor(80, 80, 80);
  if (md.author) {
    doc.text(md.author, pageW / 2, y, { align: 'center' });
    y += 24;
  }
  if (md.course) {
    doc.text(md.course, pageW / 2, y, { align: 'center' });
    y += 24;
  }
  if (md.university) {
    doc.text(md.university, pageW / 2, y, { align: 'center' });
    y += 24;
  }

  y = pageH - 200;
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  doc.text(
    `Generated: ${new Date(model.generatedAt).toLocaleString()}`,
    pageW / 2,
    y,
    { align: 'center' },
  );
  if (md.version) {
    doc.text(`Version: ${md.version}`, pageW / 2, y + 16, { align: 'center' });
  }
  if (md.description) {
    doc.setFontSize(11);
    doc.setTextColor(60, 60, 60);
    const lines = doc.splitTextToSize(
      md.description,
      pageW - state.margin.left * 2,
    );
    doc.text(lines, pageW / 2, y + 36, { align: 'center' });
  }
}

function renderToc(state: LayoutState, model: DocumentModel) {
  const { doc, options } = state;
  renderHeading1(state, 'Table of Contents');
  let n = 1;
  for (const project of model.projects) {
    doc.setFont(options.headingFont, 'bold');
    doc.setFontSize(13);
    doc.setTextColor(20, 20, 20);
    ensureSpace(state, 30);
    doc.text(`${n}. ${project.label}`, state.margin.left, state.cursorY);
    state.cursorY += 22;
    let m = 1;
    doc.setFont(options.bodyFont, 'normal');
    doc.setFontSize(11);
    doc.setTextColor(60, 60, 60);
    for (const file of project.files) {
      ensureSpace(state, 18);
      doc.text(
        `   ${n}.${m}  ${file.relativePath}`,
        state.margin.left,
        state.cursorY,
      );
      state.cursorY += 16;
      m++;
    }
    n++;
  }
}

function renderProjectStructure(
  state: LayoutState,
  project: DocumentModel['projects'][number],
) {
  renderHeading2(state, `Project Structure: ${project.label}`);
  const { doc, options } = state;
  doc.setFont(options.codeFont, 'normal');
  doc.setFontSize(options.codeFontSize - 1);
  doc.setTextColor(60, 60, 60);

  const root = buildTree(project.structurePaths);
  const lines: string[] = [];
  renderTree(root, '', true, lines);

  for (const line of lines) {
    ensureSpace(state, options.codeFontSize + 2);
    doc.text(line, state.margin.left, state.cursorY);
    state.cursorY += options.codeFontSize + 2;
  }
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

function renderHeading1(state: LayoutState, text: string) {
  const { doc, options } = state;
  ensureSpace(state, 40);
  if (state.cursorY > state.margin.top + 1) {
    state.cursorY += 12;
  }
  doc.setFont(options.headingFont, 'bold');
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42);
  doc.text(text, state.margin.left, state.cursorY + 20);
  state.cursorY += 32;
}

function renderHeading2(state: LayoutState, text: string) {
  const { doc, options } = state;
  ensureSpace(state, 32);
  state.cursorY += 8;
  doc.setFont(options.headingFont, 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text(text, state.margin.left, state.cursorY + 16);
  state.cursorY += 24;
}

function renderHeading3(state: LayoutState, text: string) {
  const { doc, options } = state;
  ensureSpace(state, 28);
  state.cursorY += 6;
  doc.setFont(options.headingFont, 'bold');
  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59);
  doc.text(text, state.margin.left, state.cursorY + 14);
  state.cursorY += 22;
}

function renderFileHeader(
  state: LayoutState,
  relativePath: string,
  language: string | null,
  sizeBytes: number,
) {
  const { doc, options } = state;
  ensureSpace(state, 20);
  doc.setFont(options.codeFont, 'bold');
  doc.setFontSize(options.codeFontSize - 1);
  doc.setTextColor(88, 96, 105);
  const text = `${relativePath}    ·    ${languageLabel(language)}    ·    ${formatBytes(sizeBytes)}`;
  doc.text(text, state.margin.left, state.cursorY + 10);
  // Bottom border
  const lineY = state.cursorY + 14;
  doc.setDrawColor(208, 215, 222);
  doc.setLineWidth(0.5);
  doc.line(
    state.margin.left,
    lineY,
    state.pageW - state.margin.right,
    lineY,
  );
  state.cursorY += 18;
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

function renderCodeBlock(state: LayoutState, file: HighlightedFile) {
  const { doc, options, defaultColor } = state;
  const lineHeight = options.codeFontSize * options.codeLineHeight;
  const blockLeft = state.margin.left;
  const blockRight = state.pageW - state.margin.right;
  const blockWidth = blockRight - blockLeft;

  // Determine line number column width.
  const maxNum = file.lines.length;
  const numWidth = options.showLineNumbers
    ? doc.getTextWidth('0'.repeat(String(maxNum).length + 1))
    : 0;

  // Background rectangle for the entire code block.
  // We render it per-page by computing the available height before page break.
  const blockTop = state.cursorY;
  const availableHeight = state.pageH - state.margin.bottom - blockTop;
  const linesPerPage = Math.floor(availableHeight / lineHeight);
  const totalLines = file.lines.length;
  const blockHeight = Math.min(
    totalLines * lineHeight,
    availableHeight,
  );

  // Draw background.
  if (options.codeBackground) {
    const { r, g, b } = parseHex(options.codeBackground);
    doc.setFillColor(r, g, b);
    doc.rect(
      blockLeft,
      blockTop,
      blockWidth,
      blockHeight + options.codePadding * 2,
      'F',
    );
  }

  // Draw border.
  if (options.codeBorderColor) {
    const { r, g, b } = parseHex(options.codeBorderColor);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(options.codeBorderWidth);
    doc.rect(
      blockLeft,
      blockTop,
      blockWidth,
      blockHeight + options.codePadding * 2,
    );
  }

  state.cursorY += options.codePadding;
  const codeStartX = blockLeft + options.codePadding;
  doc.setFont(options.codeFont, 'normal');
  doc.setFontSize(options.codeFontSize);

  let lineIdx = 0;
  while (lineIdx < totalLines) {
    const remainingOnPage = Math.floor(
      (state.pageH - state.margin.bottom - state.cursorY) / lineHeight,
    );
    if (remainingOnPage <= 0) {
      // Start a new page and re-draw background for the continuation.
      state.doc.addPage();
      state.page++;
      state.cursorY = state.margin.top;
      if (options.codeBackground) {
        const { r, g, b } = parseHex(options.codeBackground);
        doc.setFillColor(r, g, b);
        const continuationHeight = Math.min(
          (totalLines - lineIdx) * lineHeight,
          state.pageH - state.margin.top - state.margin.bottom,
        );
        doc.rect(
          blockLeft,
          state.cursorY,
          blockWidth,
          continuationHeight + options.codePadding * 2,
          'F',
        );
      }
      state.cursorY += options.codePadding;
    }

    const line = file.lines[lineIdx];
    const lineY = state.cursorY + lineHeight * 0.8;

    // Line number.
    if (options.showLineNumbers) {
      doc.setTextColor(150, 150, 150);
      const numStr = String(line.lineNumber);
      doc.text(
        numStr,
        codeStartX + numWidth - doc.getTextWidth(numStr) - 2,
        lineY,
      );
    }

    // Tokens.
    const textX = codeStartX + numWidth;
    let x = textX;
    const maxX = blockRight - options.codePadding;
    for (const tok of line.tokens) {
      const text = line.text.slice(tok.start, tok.start + tok.length);
      if (text.length === 0) continue;
      const color = tok.color
        ? parseHex(tok.color)
        : defaultColor;
      doc.setTextColor(color.r, color.g, color.b);
      if (tok.bold) doc.setFont(options.codeFont, 'bold');
      else if (tok.italic) doc.setFont(options.codeFont, 'italic');
      else doc.setFont(options.codeFont, 'normal');

      if (options.wrapLongLines) {
        // Wrap mode: split token if it overflows.
        const words = text.split(/(\s+)/);
        for (const word of words) {
          if (word.length === 0) continue;
          const wordW = doc.getTextWidth(word);
          if (x + wordW > maxX && x > textX) {
            // Wrap to next line.
            state.cursorY += lineHeight;
            x = textX;
            if (
              state.cursorY + lineHeight >
              state.pageH - state.margin.bottom
            ) {
              // Need a new page — but this complicates the background rect.
              // For simplicity, break out and let the outer loop handle it.
              break;
            }
          }
          doc.text(word, x, state.cursorY + lineHeight * 0.8);
          x += wordW;
        }
      } else {
        // No wrap: clip overflow.
        if (x < maxX) {
          doc.text(text, x, lineY, {
            maxWidth: maxX - x,
          });
        }
        x += doc.getTextWidth(text);
      }
      // Reset font style.
      doc.setFont(options.codeFont, 'normal');
    }

    state.cursorY += lineHeight;
    lineIdx++;
  }

  state.cursorY += options.codePadding + 4;
}

function ensureSpace(state: LayoutState, needed: number) {
  if (state.cursorY + needed > state.pageH - state.margin.bottom) {
    state.doc.addPage();
    state.page++;
    state.cursorY = state.margin.top;
  }
}

function applyHeaderFooter(state: LayoutState, model: DocumentModel) {
  const { doc, options, pageW, pageH, margin } = state;
  const totalPages = doc.getNumberOfPages();

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    if (options.pageHeader) {
      doc.setFont(options.bodyFont, 'normal');
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text(options.pageHeader, pageW - margin.right, margin.top - 8, {
        align: 'right',
      });
    }
    if (options.pageFooter) {
      doc.setFont(options.bodyFont, 'normal');
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      const footer = options.pageFooter
        .replace(/\{page\}/g, String(i))
        .replace(/\{pages\}/g, String(totalPages));
      doc.text(footer, pageW / 2, pageH - margin.bottom + 12, {
        align: 'center',
      });
    }
  }
}

export const pdfExporter: DocumentExporter = {
  format: 'pdf',
  label: 'PDF Document (.pdf)',
  mimeType: 'application/pdf',
  extension: 'pdf',
  async export(
    model: DocumentModel,
    options: ExportOptions,
  ): Promise<ExportResult> {
    const start = performance.now();
    const doc = await buildPdf(model);
    const blob = doc.output('blob');
    const elapsed = performance.now() - start;
    return {
      blob,
      filename: `${options.filename || 'codice'}.pdf`,
      format: 'pdf',
      elapsedMs: elapsed,
    };
  },
};
