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
 */

import JSZip from 'jszip';
import type {
  DocumentModel,
  DocumentOptions,
  ExportOptions,
  ExportResult,
  HighlightedFile,
  HighlightedLine,
} from '@/types';
import type { DocumentExporter } from './types';
import { parseHex } from './colors';
import { getThemeColors } from '@/lib/highlight/highlighter';
import { formatBytes } from '@/lib/fileDiscovery';

/** XML escape — escapes the 5 special characters. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Convert hex to OpenDocument-compatible hex (no #). */
function hexToOdf(hex: string): string {
  return hex.replace(/^#/, '').padEnd(6, '0').slice(0, 6);
}

/** Page dimensions in cm. */
const PAGE_DIMENSIONS_CM: Record<string, [number, number]> = {
  A4: [21.0, 29.7],
  Letter: [21.59, 27.94],
  Legal: [21.59, 35.56],
  A3: [29.7, 42.0],
};

/** Build the styles.xml content. */
function buildStylesXml(options: DocumentOptions): string {
  const codeBg = options.codeBackground
    ? `<style:background-color>#${hexToOdf(options.codeBackground)}</style:background-color>`
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
      <style:paragraph-properties fo:margin-top="0.1cm" fo:margin-bottom="0.1cm" fo:line-height="1.4" />
      <style:text-properties fo:font-family="${xmlEscape(options.bodyFont)}" fo:font-size="${options.bodyFontSize}pt" fo:color="#1f2937" />
    </style:style>
    <style:style style:name="CodeLine" style:family="paragraph">
      <style:paragraph-properties fo:margin-top="0pt" fo:margin-bottom="0pt" fo:line-height="${options.codeLineHeight}" fo:background-color="#${hexToOdf(options.codeBackground || '#ffffff')}" />
      <style:text-properties fo:font-family="${xmlEscape(options.codeFont)}" fo:font-size="${options.codeFontSize}pt" style:font-name="Mono" fo:color="#24292e" />
    </style:style>
    <style:style style:name="FileHeader" style:family="paragraph">
      <style:paragraph-properties fo:margin-top="0.2cm" fo:margin-bottom="0.1cm" fo:border-bottom="0.5pt solid #d0d7de" fo:padding="0.05cm" />
      <style:text-properties fo:font-family="${xmlEscape(options.codeFont)}" fo:font-size="${options.codeFontSize - 1}pt" fo:font-weight="bold" fo:color="#586069" />
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
  </office:automatic-styles>
  <office:master-styles>
    <style:master-page style:name="Standard" style:page-layout-name="PL1" />
  </office:master-styles>
</office:document-styles>`;
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

/** Render a single line of code as ODF XML. */
function renderCodeLine(
  line: HighlightedLine,
  options: DocumentOptions,
  lineNumberWidth: number,
  defaultColor: string,
): string {
  const parts: string[] = [];

  if (options.showLineNumbers) {
    const numStr = String(line.lineNumber).padStart(lineNumberWidth, ' ');
    parts.push(
      `<text:span style:use-optimal-column-width="false" fo:color="#999999">${xmlEscape(numStr + ' ')}</text:span>`,
    );
  }

  for (const tok of line.tokens) {
    const text = line.text.slice(tok.start, tok.start + tok.length);
    if (text.length === 0) continue;
    const color = tok.color ?? defaultColor;
    const attrs = [`fo:color="#${hexToOdf(color)}"`];
    if (tok.bold) attrs.push('fo:font-weight="bold"');
    if (tok.italic) attrs.push('fo:font-style="italic"');
    if (tok.underline) attrs.push('style:text-underline-style="solid"');
    parts.push(
      `<text:span ${attrs.join(' ')}>${xmlEscape(text)}</text:span>`,
    );
  }

  if (parts.length === 0) {
    parts.push('<text:span> </text:span>');
  }

  return `<text:p text:style-name="CodeLine">${parts.join('')}</text:p>`;
}

function renderFileHeader(
  relativePath: string,
  language: string | null,
  sizeBytes: number,
): string {
  const text = `${relativePath}    ·    ${languageLabel(language)}    ·    ${formatBytes(sizeBytes)}`;
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
  parts.push(`<office:body>`);
  parts.push(`<office:text>`);

  // Front matter
  if (opts.includeFrontMatter) {
    const md = model.metadata;
    parts.push(
      `<text:p text:style-name="Title">${xmlEscape(md.title ?? 'Project Report')}</text:p>`,
    );
    if (md.author)
      parts.push(
        `<text:p text:style-name="Subtitle">${xmlEscape(md.author)}</text:p>`,
      );
    if (md.course)
      parts.push(
        `<text:p text:style-name="Subtitle">${xmlEscape(md.course)}</text:p>`,
      );
    if (md.university)
      parts.push(
        `<text:p text:style-name="Subtitle">${xmlEscape(md.university)}</text:p>`,
      );
    parts.push(
      `<text:p text:style-name="Subtitle">Generated: ${xmlEscape(new Date(model.generatedAt).toLocaleString())}</text:p>`,
    );
    if (md.version)
      parts.push(
        `<text:p text:style-name="Subtitle">Version: ${xmlEscape(md.version)}</text:p>`,
      );
    if (md.description)
      parts.push(
        `<text:p text:style-name="TextBody">${xmlEscape(md.description)}</text:p>`,
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
        parts.push(
          `<text:p text:style-name="TextBody">   ${n}.${m}  ${xmlEscape(file.relativePath)}</text:p>`,
        );
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
        parts.push(
          `<text:p text:style-name="CodeLine">${xmlEscape(line)}</text:p>`,
        );
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
        parts.push(
          renderFileHeader(file.relativePath, file.language, file.sizeBytes),
        );
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
    zip.file('styles.xml', buildStylesXml(model.options));
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
