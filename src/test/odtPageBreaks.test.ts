/**
 * ODT hard page-break + TOC page styles (spec §15/§16/§4/§10).
 *
 * The pre-§15 implementation emitted `<text:soft-page-break/>` inside empty
 * paragraphs, which some ODF consumers ignore (title page ran into the TOC).
 * The exporter now expresses page starts with `fo:break-before="page"` on
 * the first paragraph of each new-page section.
 */

import { describe, expect, it } from 'vitest';
import { odtExporter } from '../lib/exporters/odtExporter';
import { defaultDocumentOptions } from '../lib/defaultOptions';
import type { DocumentModel, DocumentProject, DocumentFile } from '../types';
import { highlightFile } from '../lib/highlight/highlighter';

async function buildFile(
  projectId: string,
  projectLabel: string,
  rel: string,
  source: string,
): Promise<DocumentFile> {
  const hl = await highlightFile(rel, rel, null, source, 'github-light');
  return {
    projectId,
    projectLabel,
    relativePath: rel,
    language: null,
    highlighted: hl,
    sizeBytes: source.length,
  };
}

async function buildModel(opts: Record<string, unknown>): Promise<DocumentModel> {
  const f1 = await buildFile('p1', 'alpha', 'src/Main.kt', 'fun main() {\n    println("hi")\n}\n');
  const f2 = await buildFile('p2', 'beta', 'tool.sh', '#!/bin/sh\necho ok\n');
  const p1: DocumentProject = {
    id: 'p1',
    label: 'alpha',
    folderName: 'alpha',
    files: [f1],
    structurePaths: ['src/Main.kt'],
  };
  const p2: DocumentProject = {
    id: 'p2',
    label: 'beta',
    folderName: 'beta',
    files: [f2],
    structurePaths: ['tool.sh'],
  };
  return {
    metadata: { title: 'Report', author: 'Dev' },
    options: { ...defaultDocumentOptions(), ...opts } as DocumentModel['options'],
    projects: [p1, p2],
    generatedAt: '2025-06-01T10:00:00.000Z',
  };
}

async function exportContentXml(opts: Record<string, unknown>): Promise<string> {
  const model = await buildModel(opts);
  const result = await odtExporter.export(model, { format: 'odt', filename: 't' });
  const blob = result.blob as unknown as { arrayBuffer(): Promise<ArrayBuffer> };
  const text = new TextDecoder().decode(await blob.arrayBuffer());
  // The blob is the ZIP — extract content.xml via JSZip (available in deps).
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return zip.file('content.xml')!.async('text');
}

describe('ODT hard page breaks (spec §15/§16/§10)', () => {
  it('emits NO soft page breaks and NO empty break paragraphs', async () => {
    const xml = await exportContentXml({});
    expect(xml).not.toContain('soft-page-break');
    // The old implementation emitted `<text:p><text:soft-page-break/></text:p>` —
    // make sure no empty break-carrier paragraphs remain.
    expect(xml).not.toMatch(/<text:p>\s*<\/text:p>/);
  });

  it('starts the TOC on a fresh page and each project on its own page', async () => {
    const xml = await exportContentXml({});
    // TocHeading1 + PBHeading1 styles carry the hard break…
    expect(xml).toMatch(/style:name="TocHeading1"[^/]*fo:break-before="page"/);
    expect(xml).toMatch(/style:name="PBHeading1"[^/]*fo:break-before="page"/);
    // …and the project headings use the PB style.
    expect(xml.match(/text:style-name="PBHeading1"/g)?.length).toBe(2);
    // TOC content uses the aligned TocEntry style.
    expect(xml).toContain('text:style-name="TocEntry"');
    expect(xml).toContain('Table of Contents');
  });

  it('keeps code as one paragraph per line with preserved whitespace', async () => {
    const xml = await exportContentXml({});
    expect(xml).toContain('fun main()');
    expect(xml).toContain('<text:s');
    expect(xml.match(/text:style-name="CodeLine"/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('encodes the TOC vertical spacer with its own page break when used', async () => {
    const xml = await exportContentXml({ tocVerticalAlignment: 'center' });
    // Spacer carries the break so it opens the TOC page (no empty page between).
    expect(xml).toMatch(/style:name="TocSpacer"[^/]*fo:break-before="page"/);
    // And then the heading itself does NOT double-break.
    expect(xml).toMatch(/style:name="TocHeading1"[^/]*\/>/);
  });

  it('keeps the unicode tree glyphs byte-identical (spec §21)', async () => {
    const model = await buildModel({});
    model.projects[0].structurePaths = ['src/Main.kt', 'src/util/Helper.kt'];
    const result = await odtExporter.export(model, { format: 'odt', filename: 't' });
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await (result.blob as unknown as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer());
    const xml = await zip.file('content.xml')!.async('text');
    for (const glyph of ['├', '└', '│', '─']) {
      expect(xml).toContain(glyph);
    }
  });
});
