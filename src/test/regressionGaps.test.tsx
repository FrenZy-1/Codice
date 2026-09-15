/**
 * Regression-gap closure tests — the §40 items that were verified in the
 * browser but had no automated coverage yet:
 *
 *   §10 assignment dropdown filtering (assigned files leave every dropdown)
 *   §13 image library is the single registry (sidebar panel + reducer)
 *   §18 popover dismissal (outside click / Escape / competing popovers)
 *   §19 layout preview shares the document surface theme
 *   §21 layout attention dot is derived from real state
 *   §25 panel colors exist, migrate and flow to the export options
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import {
  assignedFileIds,
  createBlockDef,
  createSection,
  createEmptyTemplate,
  normalizeTemplate,
  sanitizeSectionType,
  type CustomLayoutTemplate,
} from '@/lib/customLayouts/model';
import {
  layoutAttentionRequired,
  unassignedFileIds,
  validateCustomLayout,
} from '@/lib/customLayouts/validation';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import { DEFAULT_DOCUMENT_COLORS, migratePreset } from '@/lib/presets/presetMigration';
import { presetToOptions } from '@/lib/presets/presetToOptions';
import { getBuiltInPreset } from '@/lib/presets/builtInPresets';
import { BUILT_IN_DOCUMENT_PRESETS } from '@/lib/presets/builtInPresets';
import type { DocumentProject } from '@/types';
import { AppStateProvider, useAppState } from '@/hooks/useAppState';
import { ToastProvider } from '@/components/common/Toast';
import { ProjectsSidebar } from '@/components/ProjectsSidebar';
import { ResolvedPreview } from '@/components/CustomLayout/ResolvedPreview';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function proj(id: string, label: string, files: Array<{ id: string; path: string }>): DocumentProject {
  return {
    id,
    label,
    folderName: label,
    structurePaths: files.map((f) => f.path),
    files: files.map((f) => ({
      projectId: id,
      projectLabel: label,
      relativePath: f.path,
      language: 'java',
      highlighted: { fileId: f.id, relativePath: f.path, language: 'java', lines: [] },
      sizeBytes: 10,
    })),
  };
}

/** One section with one block that requires nothing (simple assignment map). */
function singleBlockTemplate(): CustomLayoutTemplate {
  const block = createBlockDef('Code', [{ type: 'code' }]);
  const section = createSection('custom', 'Section 1');
  section.children = [{ kind: 'block', id: 'c-b1', block }];
  return {
    id: 'tpl',
    name: 'T',
    version: 2,
    createdAt: 0,
    updatedAt: 0,
    sections: [section],
  };
}

function blockIdOf(tpl: CustomLayoutTemplate): string {
  const child = tpl.sections[0].children.find((c) => c.kind === 'block');
  if (!child || child.kind !== 'block') throw new Error('no block');
  return child.block.id;
}

/* ------------------------------------------------------------------ */
/* §10 — assignment dropdown filtering                                 */
/* ------------------------------------------------------------------ */

describe('§10 assignment dropdown filtering', () => {
  it('a file assigned to any block is excluded from every dropdown; unassigning frees it', () => {
    const tpl = singleBlockTemplate();
    const b1 = blockIdOf(tpl);
    // A second section/block so "any other dropdown" is real.
    const b2 = createBlockDef('Code 2', [{ type: 'code' }]);
    tpl.sections[0].children.push({ kind: 'block', id: 'c-b2', block: b2 });

    const assignments: Record<string, string[]> = { [b1]: ['f1'] };
    const taken = assignedFileIds(tpl, assignments);
    expect(taken.has('f1')).toBe(true);

    // f1 must not be available to b2 (or anywhere), f2 still is.
    const files = [
      proj('p1', 'P1', [{ id: 'f1', path: 'A.java' }, { id: 'f2', path: 'B.java' }]),
    ];
    const available = files[0].files.filter((f) => !taken.has(f.highlighted.fileId));
    expect(available.map((f) => f.highlighted.fileId)).toEqual(['f2']);

    // Unassign → the file becomes available again.
    delete assignments[b1];
    expect(assignedFileIds(tpl, assignments).has('f1')).toBe(false);
  });

  it('counts assignments across ALL sections, not just the visible one', () => {
    const tpl = singleBlockTemplate();
    const b1 = blockIdOf(tpl);
    const s2 = createSection('custom', 'Section 2');
    const b2 = createBlockDef('Code 2', [{ type: 'code' }]);
    s2.children = [{ kind: 'block', id: 'c-b2', block: b2 }];
    tpl.sections.push(s2);
    expect(
      assignedFileIds(tpl, { [b1]: [], [b2.id]: ['f9'] }).has('f9'),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* §21 — derived layout attention dot                                  */
/* ------------------------------------------------------------------ */

describe('§21 layout attention is derived from real state', () => {
  const emptyWorkspace = [proj('p1', 'P1', [])];

  it('no applied layout → no dot', () => {
    expect(
      layoutAttentionRequired(null, {
        projects: [proj('p1', 'P1', [{ id: 'f1', path: 'A.java' }])],
        fileDetails: {},
        fileFieldValues: {},
        sectionFieldValues: {},
        fileAssignments: {},
      }),
    ).toBe(false);
  });

  it('nothing uploaded → no dot (nothing to wire yet)', () => {
    const tpl = singleBlockTemplate();
    expect(
      layoutAttentionRequired(tpl, {
        projects: emptyWorkspace,
        fileDetails: {},
        fileFieldValues: {},
        sectionFieldValues: {},
        fileAssignments: {},
      }),
    ).toBe(false);
  });

  it('an unassigned selected file → dot', () => {
    const tpl = singleBlockTemplate();
    expect(
      layoutAttentionRequired(tpl, {
        projects: [proj('p1', 'P1', [{ id: 'f1', path: 'A.java' }])],
        fileDetails: {},
        fileFieldValues: {},
        sectionFieldValues: {},
        fileAssignments: {},
      }),
    ).toBe(true);
  });

  it('a missing required field value → dot', () => {
    const tpl = singleBlockTemplate();
    const noteField = { id: 'fld-note', label: 'Note', kind: 'text' as const, required: true };
    const block = createBlockDef('Code', [{ type: 'code' }], [noteField]);
    tpl.sections[0].children = [{ kind: 'block', id: 'c-b1', block }];
    const file = proj('p1', 'P1', [{ id: 'f1', path: 'A.java' }]);
    // Assigned but the required "Note" value is empty.
    expect(
      layoutAttentionRequired(tpl, {
        projects: [file],
        fileDetails: {},
        fileFieldValues: {},
        sectionFieldValues: {},
        fileAssignments: { [blockIdOf(tpl)]: ['f1'] },
      }),
    ).toBe(true);
    // Filling it clears the dot.
    expect(
      layoutAttentionRequired(tpl, {
        projects: [file],
        fileDetails: {},
        fileFieldValues: { f1: { [noteField.id]: 'done' } },
        sectionFieldValues: {},
        fileAssignments: { [blockIdOf(tpl)]: ['f1'] },
      }),
    ).toBe(false);
  });

  it('a fully wired layout → no dot', () => {
    const tpl = singleBlockTemplate();
    expect(
      layoutAttentionRequired(tpl, {
        projects: [proj('p1', 'P1', [{ id: 'f1', path: 'A.java' }])],
        fileDetails: {},
        fileFieldValues: {},
        sectionFieldValues: {},
        fileAssignments: { [blockIdOf(tpl)]: ['f1'] },
      }),
    ).toBe(false);
  });

  it('agrees with the explicit validators on the same input', () => {
    const tpl = singleBlockTemplate();
    const input = {
      projects: [proj('p1', 'P1', [{ id: 'f1', path: 'A.java' }])],
      fileDetails: {},
      fileFieldValues: {},
      sectionFieldValues: {},
      fileAssignments: {},
    };
    const derived = layoutAttentionRequired(tpl, input);
    // The dot = missing required values OR unassigned files — exactly the
    // two conditions the export-time checks surface.
    const explicit =
      validateCustomLayout({ ...input, template: tpl }).length > 0 ||
      unassignedFileIds({ ...input, template: tpl }).length > 0;
    expect(derived).toBe(explicit);
  });
});

/* ------------------------------------------------------------------ */
/* §25 — panel colors                                                  */
/* ------------------------------------------------------------------ */

describe('§25 panel colors exist and flow through the model', () => {
  it('the default palette carries panel fill/border/text', () => {
    expect(DEFAULT_DOCUMENT_COLORS.panelFill).toMatch(/^#/);
    expect(DEFAULT_DOCUMENT_COLORS.panelBorder).toMatch(/^#/);
    expect(DEFAULT_DOCUMENT_COLORS.panelText).toMatch(/^#/);
  });

  it('legacy presets migrate to panel color defaults (never undefined)', () => {
    const migrated = migratePreset({
      page: { size: 'a4', orientation: 'portrait' },
      typography: {},
    } as never);
    expect(migrated.colors.panelFill).toBeDefined();
    expect(migrated.colors.panelBorder).toBeDefined();
    expect(migrated.colors.panelText).toBeDefined();
  });

  it('every built-in preset keeps panel colors', () => {
    for (const preset of BUILT_IN_DOCUMENT_PRESETS) {
      expect(preset.colors.panelFill, preset.id).toBeDefined();
      expect(preset.colors.panelBorder, preset.id).toBeDefined();
      expect(preset.colors.panelText, preset.id).toBeDefined();
    }
    expect(getBuiltInPreset('university')).toBeDefined();
  });

  it('presetToOptions maps the panel colors for the exporters', () => {
    const preset = getBuiltInPreset('university')!;
    const options = presetToOptions(preset);
    expect(options.panelFillColor).toBe(preset.colors.panelFill);
    expect(options.panelBorderColor).toBe(preset.colors.panelBorder);
    expect(options.panelTextColor).toBe(preset.colors.panelText);
  });
});

/* ------------------------------------------------------------------ */
/* §26 hardening — section type strings are data                       */
/* ------------------------------------------------------------------ */

describe('§26 unknown section types degrade to custom (no crash)', () => {
  it('sanitizeSectionType maps unknown/empty types to custom', () => {
    expect(sanitizeSectionType('task')).toBe('task');
    expect(sanitizeSectionType('descriptionAnswer')).toBe('descriptionAnswer');
    expect(sanitizeSectionType('description_answer')).toBe('custom');
    expect(sanitizeSectionType('')).toBe('custom');
    expect(sanitizeSectionType(undefined)).toBe('custom');
  });

  it('normalizeTemplate sanitizes persisted/imported section types', () => {
    const tpl = singleBlockTemplate();
    (tpl.sections[0] as unknown as { type: string }).type = 'bogus_legacy_type';
    const normalized = normalizeTemplate(tpl);
    expect(normalized.sections[0].type).toBe('custom');
    // createSection/appendSectionPreset are total too.
    expect(createSection('bogus' as never).type).toBe('custom');
  });
});

/* ------------------------------------------------------------------ */
/* §18 — popover dismissal hook                                        */
/* ------------------------------------------------------------------ */

/** Renders two probes wired to the hook so tests can drive dismissal. */
function DismissProbe({
  open,
  onClose,
  insideSelector,
}: {
  open: boolean;
  onClose: () => void;
  insideSelector: string;
}) {
  usePopoverDismiss(open, onClose, [insideSelector]);
  return (
    <div>
      <div className="panel-under-test">
        <button type="button" onClick={onClose}>close-btn</button>
      </div>
      <span data-testid="state">{open ? 'open' : 'closed'}</span>
    </div>
  );
}

describe('§18 usePopoverDismiss', () => {
  it('closes on outside pointer-down, stays open for inside clicks and the close button, Escape closes', () => {
    let open = true;
    const setOpen = (v: boolean) => {
      open = v;
      rerender(<DismissProbe open={open} onClose={() => setOpen(false)} insideSelector=".panel-under-test" />);
    };
    const { rerender } = render(
      <DismissProbe open={open} onClose={() => setOpen(false)} insideSelector=".panel-under-test" />,
    );

    // Outside click closes.
    fireEvent.pointerDown(document.body);
    expect(open).toBe(false);

    // Re-open: inside clicks (panel + its controls) do NOT close.
    setOpen(true);
    fireEvent.pointerDown(document.querySelector('.panel-under-test')!);
    expect(open).toBe(true);

    // The explicit close button still works (it is INSIDE the panel).
    fireEvent.click(screen.getByText('close-btn'));
    expect(open).toBe(false);

    // Escape closes.
    setOpen(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(open).toBe(false);
  });

  it('a competing popover surface counts as outside for the other popover', () => {
    let outlineOpen = true;
    const setOutline = (v: boolean) => {
      outlineOpen = v;
      rerender(
        <>
          <DismissProbe open={outlineOpen} onClose={() => setOutline(false)} insideSelector=".outline-panel" />
          <div className="stats-panel" />
        </>,
      );
    };
    const { rerender } = render(
      <>
        <DismissProbe open={outlineOpen} onClose={() => setOutline(false)} insideSelector=".outline-panel" />
        <div className="stats-panel" />
      </>,
    );
    // Clicking inside the stats panel closes the outline popover.
    fireEvent.pointerDown(document.querySelector('.stats-panel')!);
    expect(outlineOpen).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* §13 + §19 — provider-backed component checks                        */
/* ------------------------------------------------------------------ */

const IMAGE_ASSET = {
  id: 'img-1',
  name: 'screenshot.png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  mime: 'image/png' as const,
  width: 320,
  height: 240,
  sizeBytes: 2048,
  addedAt: 1,
};

/** Seeds an image asset after mount, then renders children. */
function WithImage({ children }: { children?: React.ReactNode }) {
  const { dispatch, state } = useAppState();
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && state.imageAssets.length === 0) {
      seeded.current = true;
      act(() => {
        dispatch({ type: 'ADD_IMAGE_ASSETS', assets: [IMAGE_ASSET] });
      });
    }
  }, [dispatch, state.imageAssets.length]);
  return <>{children}</>;
}

function renderInApp(ui: React.ReactNode) {
  return render(
    <ToastProvider>
      <AppStateProvider>
        <WithImage>{ui}</WithImage>
      </AppStateProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('§13 image library is the single registry', () => {
  it('the sidebar image library panel lists uploaded assets and removes them through the shared store', async () => {
    const probe = renderInApp(
      <ProjectsSidebar selectedProjectId={null} onSelectProject={() => {}} />,
    );
    // The panel only appears once assets exist.
    const toggle = await screen.findByRole('button', { name: /Image library/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(await screen.findByText('screenshot.png')).toBeTruthy();
    expect(screen.getByTitle(/320×240px/)).toBeTruthy();

    // Removing goes through the SAME reducer the preview/exporters read.
    fireEvent.click(screen.getByRole('button', { name: /Remove screenshot\.png/ }));
    // Panel disappears when the registry is empty again (single registry).
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Image library/ })).toBeNull(),
    );
    expect(screen.queryByText('screenshot.png')).toBeNull();
    probe.unmount();
  });
});

describe('§19 layout preview shares the document surface', () => {
  it('renders on the preset surface — background/text follow the document theme', () => {
    const SurfaceProbe = () => {
      const { state, dispatch } = useAppState();
      const preset = state.preset;
      return (
        <>
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: 'UPDATE_PRESET',
                patch: { colors: { ...preset.colors, background: '#123456' } },
              })
            }
          >
            change-bg
          </button>
          <span data-testid="preset-bg">{preset.colors.background}</span>
          <ResolvedPreview
            blocks={[
              { kind: 'heading', level: 2, text: 'Hello', nodeId: 'n1' },
              { kind: 'paragraph', text: 'World', nodeId: 'n2' },
            ]}
            filesById={{ current: new Map() }}
            onNeedFileText={() => null}
            projects={[]}
          />
        </>
      );
    };
    renderInApp(<SurfaceProbe />);
    const surface = document.querySelector('[data-tour="layout-preview-surface"]') as HTMLElement;
    expect(surface).toBeTruthy();
    // jsdom normalizes #ffffff to rgb(255, 255, 255) — compare normalized.
    expect(surface.style.background).toBe('rgb(255, 255, 255)');
    expect(surface.style.color).toBe('rgb(31, 35, 40)');

    // The surface follows preset changes — never a hardcoded theme.
    fireEvent.click(screen.getByText('change-bg'));
    expect(screen.getByTestId('preset-bg').textContent).toBe('#123456');
    expect((document.querySelector('[data-tour="layout-preview-surface"]') as HTMLElement).style.background).toBe('rgb(18, 52, 86)');
  });
});
