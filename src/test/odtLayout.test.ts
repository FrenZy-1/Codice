/**
 * ODT layout regression tests (spec §18/§21/§9/§7).
 *
 * The generated ODT used to squish code blocks into nearly a single
 * compressed line in LibreOffice. Root causes covered here:
 *
 *   1. Invalid fo:line-height — a bare multiplier ("1.5") is not valid ODF
 *      and mis-parses; it must be a percentage ("150%").
 *   2. ODF collapses runs of literal spaces inside <text:p>, destroying all
 *      code indentation / tree prefixes — whitespace must be encoded as
 *      <text:s text:c="N"/> / <text:tab/>, and empty lines must emit a
 *      <text:s/> placeholder so they keep their height.
 *   3. Every code line stays its own <text:p text:style-name="CodeLine">
 *      with zero margins (borders merge into one visual block).
 *   4. Title-page group alignment (§9) + vertical positioning (§21).
 *   5. {time} token resolves in the ODT page header (§7), {page} stays live.
 *
 * The pure helpers are exported from odtExporter for direct unit testing;
 * the full-export tests unzip the blob and parse content.xml with the
 * jsdom DOMParser to assert well-formed XML.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  buildStylesXml,
  computeTitlePageSpacerCm,
  odtExporter,
  renderCodeLine,
  xmlEscapeWithSpaces,
} from '../lib/exporters/odtExporter';
import type {
  DocumentModel,
  DocumentOptions,
  HighlightedFile,
  HighlightedLine,
  HighlightToken,
} from '@/types';
import { defaultDocumentOptions } from '@/lib/defaultOptions';

// ---------------------------------------------------------------------------
// Local fixtures (deliberately local — the existing exporter tests are
// untouched).
// ---------------------------------------------------------------------------

function makeOptions(overrides?: Partial<DocumentOptions>): DocumentOptions {
  return { ...defaultDocumentOptions(), ...overrides };
}

/** One token covering the whole line (what Shiki emits for plain text). */
function fullToken(text: string, color = '#24292e'): HighlightToken[] {
  return text.length === 0
    ? []
    : [{ start: 0, length: text.length, scopes: [], color }];
}

function makeLine(
  lineNumber: number,
  text: string,
  tokens?: HighlightToken[],
): HighlightedLine {
  return { lineNumber, text, tokens: tokens ?? fullToken(text) };
}

/** Exercise every whitespace case: indent, double space, empty line, tab. */
const SAMPLE_LINES: HighlightedLine[] = [
  makeLine(1, 'public class Main {'),
  makeLine(2, '    int x  =  1;'),
  makeLine(3, ''),
  makeLine(4, '\treturn x;'),
  makeLine(5, '}'),
];

function makeModel(
  options: DocumentOptions,
  lines: HighlightedLine[] = SAMPLE_LINES,
): DocumentModel {
  const highlighted: HighlightedFile = {
    fileId: 'f1',
    relativePath: 'src/Main.java',
    language: 'java',
    lines,
  };
  return {
    metadata: {
      title: 'Layout Test',
      subtitle: 'A subtitle',
      author: 'Ada',
      version: '1.2.3',
      description: 'A description.',
    },
    options,
    projects: [
      {
        id: 'p1',
        label: 'sample-app',
        folderName: 'sample-app',
        files: [
          {
            projectId: 'p1',
            projectLabel: 'sample-app',
            relativePath: 'src/Main.java',
            language: 'java',
            highlighted,
            sizeBytes: 512,
          },
        ],
        structurePaths: [
          'src/Main.java',
          'src/util/Helper.java',
          'docs/guide.md',
          'README.md',
        ],
      },
    ],
    generatedAt: new Date('2026-02-14T10:15:00Z').toISOString(),
  };
}

/** Parse XML and fail loudly when the payload is not well-formed. */
function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const errors = doc.getElementsByTagName('parsererror');
  if (errors.length > 0) {
    throw new Error(`Malformed XML: ${errors[0].textContent?.slice(0, 300)}`);
  }
  return doc;
}

/** Run the real exporter and return the unzipped content.xml. */
async function exportContentXml(model: DocumentModel): Promise<string> {
  const result = await odtExporter.export(model, {
    format: 'odt',
    filename: 'odt-layout',
  });
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  return zip.file('content.xml')!.async('string');
}

function codeParagraphs(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagName('text:p')).filter(
    (p) => p.getAttribute('text:style-name') === 'CodeLine',
  );
}

// ---------------------------------------------------------------------------

describe('xmlEscapeWithSpaces', () => {
  it('encodes leading indentation and multi-space runs as <text:s>', () => {
    expect(xmlEscapeWithSpaces('    indented  code')).toBe(
      '<text:s text:c="4"/>indented<text:s text:c="2"/>code',
    );
  });

  it('keeps single internal spaces as literal spaces', () => {
    expect(xmlEscapeWithSpaces('public class')).toBe('public class');
    expect(xmlEscapeWithSpaces('a b c')).toBe('a b c');
  });

  it('escapes XML special characters outside of the generated space elements', () => {
    expect(xmlEscapeWithSpaces('a < b & "c" \'d\'')).toBe(
      'a &lt; b &amp; &quot;c&quot; &apos;d&apos;',
    );
    // Escaping and space runs together (trailing run stays encoded).
    expect(xmlEscapeWithSpaces('  x<y  ')).toBe(
      '<text:s text:c="2"/>x&lt;y<text:s text:c="2"/>',
    );
  });

  it('converts tabs to <text:tab/>', () => {
    expect(xmlEscapeWithSpaces('\tcode\there')).toBe(
      '<text:tab/>code<text:tab/>here',
    );
  });

  it('preserves box-drawing glyphs and encodes tree prefixes', () => {
    expect(xmlEscapeWithSpaces('├── src/')).toBe('├── src/');
    expect(xmlEscapeWithSpaces('│   └── Main.kt')).toBe(
      '│<text:s text:c="3"/>└── Main.kt',
    );
  });
});

describe('renderCodeLine', () => {
  it('emits an explicit <text:s/> placeholder for empty lines (keeps line height)', () => {
    const xml = renderCodeLine(
      makeLine(3, ''),
      makeOptions({ showLineNumbers: false }),
      1,
      '#24292e',
    );
    expect(xml).toBe('<text:p text:style-name="CodeLine"><text:s/></text:p>');
  });

  it('encodes code indentation and double spaces inside token spans', () => {
    const xml = renderCodeLine(
      SAMPLE_LINES[1],
      makeOptions({ showLineNumbers: false }),
      1,
      '#24292e',
    );
    expect(xml).toContain('<text:s text:c="4"/>');
    expect(xml).toContain('<text:s text:c="2"/>=');
    // Indentation must not survive as a collapsible literal space run.
    expect(xml).not.toContain('    int');
  });

  it('encodes tab indentation as <text:tab/>', () => {
    const xml = renderCodeLine(
      SAMPLE_LINES[3],
      makeOptions({ showLineNumbers: false }),
      1,
      '#24292e',
    );
    expect(xml).toContain('<text:tab/>return x;');
  });

  it('encodes line-number gutter padding as <text:s>', () => {
    const xml = renderCodeLine(
      makeLine(7, 'x'),
      makeOptions({ showLineNumbers: true }),
      3,
      '#24292e',
    );
    expect(xml).toContain('<text:s text:c="2"/>7 ');
  });

  it('keeps the DejaVu fallback span for box-drawing glyph runs', () => {
    const text = '├── src/';
    const xml = renderCodeLine(
      makeLine(1, text, fullToken(text)),
      makeOptions({ showLineNumbers: false }),
      1,
      '#24292e',
    );
    expect(xml).toContain('├──');
    expect(xml).toContain('fo:font-family="DejaVu Sans Mono"');
  });
});

describe('buildStylesXml', () => {
  it('emits a percentage fo:line-height for the code line-height multiplier', () => {
    const xml = buildStylesXml(makeOptions({ codeLineHeight: 1.5 }), makeModel(makeOptions()));
    expect(xml).toContain('fo:line-height="150%"');
    // A bare multiplier is invalid ODF and collapses paragraphs in LibreOffice.
    expect(xml).not.toMatch(/fo:line-height="[0-9.]+"/);
  });

  it('keeps code-line margins at zero so adjacent lines form one block', () => {
    const xml = buildStylesXml(makeOptions(), makeModel(makeOptions()));
    expect(xml).toMatch(/style:name="CodeLine"[\s\S]*?fo:margin-top="0pt" fo:margin-bottom="0pt"/);
  });
});

describe('computeTitlePageSpacerCm', () => {
  const A4_HEIGHT_CM = 29.7;

  function textHeightCm(options: DocumentOptions): number {
    return A4_HEIGHT_CM - (options.margins.top + options.margins.bottom) / 10;
  }

  it('top → the vertical offset only', () => {
    const top = makeOptions({ titlePageVerticalAlignment: 'top', titlePageVerticalOffsetPt: 0 });
    expect(computeTitlePageSpacerCm(top, A4_HEIGHT_CM)).toBeCloseTo(0, 5);
    const offset = makeOptions({ titlePageVerticalAlignment: 'top', titlePageVerticalOffsetPt: 100 });
    expect(computeTitlePageSpacerCm(offset, A4_HEIGHT_CM)).toBeCloseTo((100 * 2.54) / 72, 2);
  });

  it('center → half of the leftover text height (group ≈ 9cm)', () => {
    const options = makeOptions({ titlePageVerticalAlignment: 'center', titlePageVerticalOffsetPt: 0 });
    const expected = Math.max(0, (textHeightCm(options) - 9) / 2);
    expect(computeTitlePageSpacerCm(options, A4_HEIGHT_CM)).toBeCloseTo(expected, 2);
  });

  it('bottom → the full leftover text height', () => {
    const options = makeOptions({ titlePageVerticalAlignment: 'bottom', titlePageVerticalOffsetPt: 0 });
    const expected = Math.max(0, textHeightCm(options) - 9);
    expect(computeTitlePageSpacerCm(options, A4_HEIGHT_CM)).toBeCloseTo(expected, 2);
  });

  it('never pushes the group past the printable area', () => {
    const options = makeOptions({ titlePageVerticalAlignment: 'bottom', titlePageVerticalOffsetPt: 5000 });
    expect(computeTitlePageSpacerCm(options, A4_HEIGHT_CM)).toBeLessThanOrEqual(textHeightCm(options) - 2);
    expect(computeTitlePageSpacerCm(options, A4_HEIGHT_CM)).toBeGreaterThanOrEqual(0);
  });
});

describe('odtExporter layout (full export)', () => {
  it('produces well-formed content.xml with one CodeLine paragraph per code line', async () => {
    const content = await exportContentXml(
      makeModel(makeOptions({
        includeFrontMatter: false,
        includeToc: false,
        includeProjectStructure: false,
        showLineNumbers: true,
      })),
    );
    const doc = parseXml(content); // throws when the XML is malformed
    expect(codeParagraphs(doc)).toHaveLength(SAMPLE_LINES.length);
  }, 30000);

  it('encodes indentation, double spaces, gutter padding and tabs in the exported XML', async () => {
    const content = await exportContentXml(
      makeModel(makeOptions({
        includeFrontMatter: false,
        includeToc: false,
        includeProjectStructure: false,
        showLineNumbers: true,
      })),
    );
    parseXml(content);
    expect(content).toContain('<text:s text:c="4"/>'); // 4-space code indent
    expect(content).toContain('<text:s text:c="2"/>'); // double space in line
    expect(content).toContain('<text:tab/>'); // tab-indented line
    // Indentation must not appear as a collapsible literal space run.
    expect(content).not.toContain('    int x');
  }, 30000);

  it('keeps empty code lines as <text:s/> placeholders', async () => {
    const content = await exportContentXml(
      makeModel(makeOptions({
        includeFrontMatter: false,
        includeToc: false,
        includeProjectStructure: false,
        showLineNumbers: false,
      })),
    );
    parseXml(content);
    expect(content).toContain('<text:p text:style-name="CodeLine"><text:s/></text:p>');
  }, 30000);

  it('renders tree lines with glyphs, fallback font, and preserved prefixes', async () => {
    const content = await exportContentXml(
      makeModel(makeOptions({
        includeFrontMatter: false,
        includeToc: false,
        includeProjectStructure: true,
      })),
    );
    parseXml(content);
    expect(content).toContain('├──');
    expect(content).toContain('└──');
    expect(content).toContain('│');
    expect(content).toContain('─');
    expect(content).toContain('fo:font-family="DejaVu Sans Mono"');
    // The nested tree prefix "│   " keeps its 3 spaces via <text:s>.
    expect(content).toContain('│<text:s text:c="3"/>');
  }, 30000);

  it('applies the title-page group alignment to every front-matter paragraph', async () => {
    const content = await exportContentXml(
      makeModel(makeOptions({
        includeFrontMatter: true,
        titlePageHorizontalAlignment: 'left',
        titlePageVerticalAlignment: 'top',
        titlePageVerticalOffsetPt: 0,
      })),
    );
    parseXml(content);
    // Automatic styles derive from Title/Subtitle/TextBody and override alignment.
    expect(content).toMatch(/style:name="TPTitle"[\s\S]*?fo:text-align="start"/);
    expect(content).toMatch(/style:name="TPSubtitle"[\s\S]*?fo:text-align="start"/);
    expect(content).toMatch(/style:name="TPBody"[\s\S]*?fo:text-align="start"/);
    expect(content).toContain('<text:p text:style-name="TPTitle">Layout Test</text:p>');
    expect(content).toContain('<text:p text:style-name="TPSubtitle">A subtitle</text:p>');
    expect(content).toContain('<text:p text:style-name="TPBody">A description.</text:p>');
    // No front-matter paragraph may keep the old hardcoded centered style.
    expect(content).not.toContain('text:style-name="Title"');
    expect(content).not.toContain('text:style-name="Subtitle"');
  }, 30000);

  it('centers the title group by default (spec §9 default)', async () => {
    const content = await exportContentXml(
      makeModel(makeOptions({ includeFrontMatter: true })),
    );
    expect(content).toMatch(/style:name="TPTitle"[\s\S]*?fo:text-align="center"/);
  }, 30000);

  it('positions the title group vertically via a spacer paragraph', async () => {
    const content = await exportContentXml(
      makeModel(makeOptions({
        includeFrontMatter: true,
        titlePageVerticalAlignment: 'center',
        titlePageVerticalOffsetPt: 0,
      })),
    );
    parseXml(content);
    expect(content).toMatch(/style:name="TPSpacer"[\s\S]*?fo:margin-top="[0-9.]+cm"/);
    const spacerIdx = content.indexOf('<text:p text:style-name="TPSpacer"/>');
    const titleIdx = content.indexOf('<text:p text:style-name="TPTitle">');
    expect(spacerIdx).toBeGreaterThan(-1);
    expect(titleIdx).toBeGreaterThan(-1);
    expect(spacerIdx).toBeLessThan(titleIdx);
  }, 30000);

  it('emits no spacer for the top alignment with zero offset', async () => {
    const content = await exportContentXml(
      makeModel(makeOptions({
        includeFrontMatter: true,
        titlePageVerticalAlignment: 'top',
        titlePageVerticalOffsetPt: 0,
      })),
    );
    expect(content).not.toContain('TPSpacer');
  }, 30000);

  it('resolves {time} in the page header (§7) while {page} stays a live field', async () => {
    const model = makeModel(makeOptions({
      pageHeaderShow: true,
      pageHeaderLayout: 'single',
      pageHeaderCenter: '{title} · generated {time} · page {page}',
    }));
    const result = await odtExporter.export(model, { format: 'odt', filename: 'odt-time' });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const styles = await zip.file('styles.xml')!.async('string');
    parseXml(styles);
    expect(styles).toContain('Layout Test'); // {title} resolved
    expect(styles).not.toContain('{title}');
    expect(styles).not.toContain('{time}'); // {time} resolved, no literal leak
    expect(styles).toContain('text:page-number'); // {page} stays live
  }, 30000);

  it('keeps the mimetype-first ZIP layout and manifest/meta entries', async () => {
    const result = await odtExporter.export(
      makeModel(makeOptions({ includeFrontMatter: false })),
      { format: 'odt', filename: 'odt-zip' },
    );
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(Object.keys(zip.files)[0]).toBe('mimetype');
    expect(zip.file('META-INF/manifest.xml')).toBeTruthy();
    expect(zip.file('meta.xml')).toBeTruthy();
    expect(await zip.file('mimetype')!.async('string')).toBe(
      'application/vnd.oasis.opendocument.text',
    );
  }, 30000);
});
