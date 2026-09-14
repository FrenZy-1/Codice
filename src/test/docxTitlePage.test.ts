import { describe, expect, it } from 'vitest';
import type { Paragraph } from 'docx';
import { buildFrontMatter, estimateTitleGroupHeightTwips } from '../lib/exporters/docxExporter';
import type { DocumentModel, DocumentOptions } from '@/types';
import { defaultDocumentOptions } from '@/lib/defaultOptions';

/** Full metadata so every optional title-page paragraph is emitted. */
const FULL_METADATA = {
  title: 'Title Page',
  subtitle: 'A Subtitle',
  author: 'An Author',
  course: 'Course 101',
  university: 'Some University',
  version: '1.2.3',
  description: 'A description of the document.',
};

/** Group height for FULL_METADATA per the per-field estimator (spec §17). */
const FULL_GROUP_TWIPS = estimateTitleGroupHeightTwips(FULL_METADATA);

function buildModel(opts?: Partial<DocumentOptions>): DocumentModel {
  return {
    metadata: { ...FULL_METADATA },
    options: { ...defaultDocumentOptions(), ...opts },
    projects: [],
    generatedAt: '2024-01-15T10:30:00.000Z',
  };
}

/** Read the raw w:jc alignment value out of a docx v8 Paragraph. */
function alignmentOf(p: Paragraph): string | undefined {
  const props = (
    p as unknown as {
      properties: { root: Array<{ rootKey: string; root: Array<{ root: { val?: string } }> }> };
    }
  ).properties;
  for (const component of props.root) {
    if (component.rootKey === 'w:jc') {
      return component.root[0]?.root?.val;
    }
  }
  return undefined;
}

/** Read the raw w:spacing before/after values out of a docx v8 Paragraph. */
function spacingOf(p: Paragraph): { before?: number; after?: number } {
  const props = (
    p as unknown as {
      properties: { root: Array<{ rootKey: string; root: Array<{ root: { before?: number; after?: number } }> }> };
    }
  ).properties;
  for (const component of props.root) {
    if (component.rootKey === 'w:spacing') {
      return component.root[0]?.root ?? {};
    }
  }
  return {};
}

/** Plain text content of a paragraph (concatenated w:t runs). */
function textOf(p: Paragraph): string {
  const root = (
    p as unknown as {
      root: Array<{ rootKey: string; root: Array<{ rootKey: string; root: unknown[] }> }>;
    }
  ).root;
  const parts: string[] = [];
  for (const child of root) {
    if (child.rootKey !== 'w:r') continue;
    for (const runChild of child.root) {
      if (runChild.rootKey === 'w:t' && typeof runChild.root[1] === 'string') {
        parts.push(runChild.root[1]);
      }
    }
  }
  return parts.join('');
}

/** The title-page paragraphs — buildFrontMatter no longer emits a trailing
 *  page-break paragraph (the break moved to the next section's first
 *  paragraph, spec §17). */
function titlePageParagraphs(model: DocumentModel): Paragraph[] {
  return buildFrontMatter(model);
}

describe('docx buildFrontMatter — title-page group alignment (spec §9/§29)', () => {
  it('defaults every title-page paragraph to CENTER when the option is absent', () => {
    const model = buildModel({ titlePageHorizontalAlignment: undefined });
    const paragraphs = titlePageParagraphs(model);
    // title + subtitle + author + course + university + generated-date + version + description
    expect(paragraphs).toHaveLength(8);
    for (const p of paragraphs) {
      expect(alignmentOf(p)).toBe('center');
    }
  });

  it('applies titlePageHorizontalAlignment to the WHOLE group (left and right)', () => {
    for (const value of ['left', 'right'] as const) {
      const model = buildModel({ titlePageHorizontalAlignment: value });
      const paragraphs = titlePageParagraphs(model);
      expect(paragraphs).toHaveLength(8);
      for (const p of paragraphs) {
        expect(alignmentOf(p)).toBe(value);
      }
    }
  });

  it('top + offsetPt 100 → title spacing.before = marginTwips + 2000 (A4, 20mm margins)', () => {
    const model = buildModel({
      pageSize: 'A4',
      landscape: false,
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      titlePageVerticalAlignment: 'top',
      titlePageVerticalOffsetPt: 100,
    });
    const paragraphs = buildFrontMatter(model);
    // 20mm → 20 * 56.7 = 1134 twips; 100pt → 100 * 20 = 2000 twips.
    expect(spacingOf(paragraphs[0]).before).toBe(1134 + 2000);
    // Non-title spacing (after: 400) is untouched.
    expect(spacingOf(paragraphs[0]).after).toBe(400);
  });

  it('center on A4 with 20mm margins → before ≈ (textArea − groupHeight)/2 with the per-field group height (offset must not skew centering, spec §9/§17)', () => {
    const model = buildModel({
      pageSize: 'A4',
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      titlePageVerticalAlignment: 'center',
      titlePageVerticalOffsetPt: 100,
    });
    const paragraphs = buildFrontMatter(model);
    const textArea = 16838 - 1134 - 1134;
    expect(spacingOf(paragraphs[0]).before).toBe(
      Math.round((textArea - FULL_GROUP_TWIPS) / 2),
    );
  });

  it('bottom places the group’s BOTTOM edge at the text-area bottom (minus the nudge) and clamps at the top margin (spec §17)', () => {
    const base = {
      pageSize: 'A4' as const,
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      titlePageVerticalAlignment: 'bottom' as const,
    };
    // text area = 14570; spacing.before = textArea − groupHeight, so the
    // group's rendered bottom lands exactly at the bottom margin. The
    // offset applies ONLY in top mode (spec §17) — any offset value gives
    // the same bottom position.
    expect(
      spacingOf(buildFrontMatter(buildModel({ ...base, titlePageVerticalOffsetPt: 100 }))[0]).before,
    ).toBe(14570 - FULL_GROUP_TWIPS);
    expect(
      spacingOf(buildFrontMatter(buildModel({ ...base, titlePageVerticalOffsetPt: 500 }))[0]).before,
    ).toBe(14570 - FULL_GROUP_TWIPS);
  });

  it('uses the per-page-size dimensions for the vertical position (Letter)', () => {
    const model = buildModel({
      pageSize: 'Letter',
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      titlePageVerticalAlignment: 'center',
      titlePageVerticalOffsetPt: 0,
    });
    const textArea = 15840 - 1134 - 1134;
    expect(spacingOf(buildFrontMatter(model)[0]).before).toBe(
      Math.round((textArea - FULL_GROUP_TWIPS) / 2),
    );
  });

  it('emits date/version/description paragraphs that honour the group alignment', () => {
    const model = buildModel({
      titlePageHorizontalAlignment: 'right',
      titlePageVerticalAlignment: 'center',
      titlePageVerticalOffsetPt: 0,
    });
    const paragraphs = titlePageParagraphs(model);
    const byText = (needle: string) => paragraphs.find((p) => textOf(p).includes(needle));
    expect(byText('Generated: ')).toBeDefined();
    expect(byText('Version: 1.2.3')).toBeDefined();
    expect(byText('A description of the document.')).toBeDefined();
    for (const p of paragraphs) {
      expect(alignmentOf(p)).toBe('right');
    }
  });
});
