/**
 * R16 regression tests — this round's features:
 *
 *   1. summarizeGroup (lib/generateAll.ts): the per-group live summary —
 *      only live projects with selected files count (mirrors the Generate
 *      guard), dead ids skipped, byte size from the selected files
 *      themselves.
 *   2. The "Move to…" strip (EXPORT-021): the drag gesture's accessible
 *      twin — a ▸ button on every chip opens an inline strip listing the
 *      OTHER groups; clicking a target dispatches the exact same
 *      MOVE_PROJECT_BETWEEN_GROUPS move (append semantics); targets the
 *      project already belongs to are disabled with a strike-through;
 *      the button is disabled when there is no other group; Escape
 *      closes the strip.
 *   3. The per-group summary line (EXPORT-022): renders "N projects ·
 *      M files · size" under the chips and updates after a move; hidden
 *      for a group with no live selected content.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { AppStateProvider, useAppState } from '@/hooks/useAppState';
import { ToastProvider } from '@/components/common/Toast';
import { ExportPanel } from '@/components/ExportPanel';
import { summarizeGroup } from '@/lib/generateAll';
import type { ProjectEntry } from '@/types';

/* ------------------------------------------------------------------ */
/* Factories                                                           */
/* ------------------------------------------------------------------ */

function makeProject(
  id: string,
  label: string,
  fileSpecs: Array<{ name: string; size: number; excluded?: boolean }>,
): ProjectEntry {
  return {
    id,
    label,
    folderName: label,
    files: fileSpecs.map((f, i) => ({
      id: `${id}-f${i + 1}`,
      projectId: id,
      relativePath: f.name,
      name: f.name,
      directory: '',
      size: f.size,
      language: 'kotlin',
      isConfig: false,
      binary: false,
      excluded: f.excluded ?? false,
    })),
    selectedCount: fileSpecs.filter((f) => !f.excluded).length,
    selectedSize: fileSpecs.filter((f) => !f.excluded).reduce((s, f) => s + f.size, 0),
    warnings: [],
    addedAt: 1,
  };
}

function group(id: string, name: string, projectIds: string[]) {
  return { id, name, projectIds };
}

function SeedOnce({
  dispatch,
  actions,
}: {
  dispatch: ReturnType<typeof useAppState>['dispatch'];
  actions: unknown[];
}) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    for (const action of actions) dispatch(action as never);
  }, [dispatch, actions]);
  return null;
}

function PanelProbe({ actions }: { actions: unknown[] }) {
  const { dispatch } = useAppState();
  return (
    <>
      <SeedOnce dispatch={dispatch} actions={actions} />
      <ExportPanel />
    </>
  );
}

function withProviders(ui: React.ReactNode) {
  return (
    <ToastProvider>
      <AppStateProvider>{ui}</AppStateProvider>
    </ToastProvider>
  );
}

/* ------------------------------------------------------------------ */
/* 1. summarizeGroup                                                   */
/* ------------------------------------------------------------------ */

describe('summarizeGroup', () => {
  const alpha = makeProject('p1', 'Alpha', [
    { name: 'a.kt', size: 100 },
    { name: 'b.kt', size: 250 },
  ]);
  const beta = makeProject('p2', 'Beta', [
    { name: 'c.kt', size: 50 },
    { name: 'skip.bin', size: 9000, excluded: true },
  ]);

  it('counts only live projects with selected files, byte-accurate', () => {
    // Beta's excluded file is NOT selected → 50 B, not 9050 B.
    const summary = summarizeGroup(
      ['p1', 'p2'],
      [alpha, beta],
      (pid) => new Set(pid === 'p1' ? ['p1-f1', 'p1-f2'] : ['p2-f1']),
    );
    expect(summary).toEqual({ projects: 2, files: 3, bytes: 400 });
  });

  it('skips dead ids and zero-selection projects silently', () => {
    const summary = summarizeGroup(
      ['p1', 'ghost', 'p2'],
      [alpha, beta],
      (pid) => (pid === 'p1' ? new Set(['p1-f1']) : new Set()),
    );
    expect(summary).toEqual({ projects: 1, files: 1, bytes: 100 });
  });

  it('returns all zeros for an empty assignment', () => {
    expect(summarizeGroup([], [alpha], () => new Set())).toEqual({
      projects: 0,
      files: 0,
      bytes: 0,
    });
  });
});

/* ------------------------------------------------------------------ */
/* 2 + 3. The Move-to strip + summary line (UI)                        */
/* ------------------------------------------------------------------ */

const twoGroups = [
  { type: 'ADD_PROJECT', project: makeProject('p1', 'Alpha', [{ name: 'a.kt', size: 120 }]) },
  { type: 'ADD_PROJECT', project: makeProject('p2', 'Beta', [{ name: 'b.kt', size: 340 }]) },
  { type: 'ADD_EXPORT_GROUP', group: group('g1', 'First', ['p1']) },
  { type: 'ADD_EXPORT_GROUP', group: group('g2', 'Second', ['p2']) },
  { type: 'SET_OUTPUT_MODE', mode: 'groups' },
];

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('li.codice-group-row'));
}

/** The Move-to strip target button with the given group name (scoped to
 * the strip — the row's own name button shares the accessible name). */
function moveTarget(name: string): HTMLButtonElement | null {
  const strip = document.querySelector('.codice-move-strip');
  if (!strip) return null;
  return (
    Array.from(strip.querySelectorAll<HTMLButtonElement>('.codice-move-target')).find(
      (b) => b.textContent === name,
    ) ?? null
  );
}

describe('ExportPanel: Move-to strip + summary line', () => {
  afterEach(() => {
    cleanup();
  });

  it('summary line renders live counts and updates after a move', () => {
    render(withProviders(<PanelProbe actions={twoGroups} />));
    const first = rows()[0];
    expect(first.querySelector('.codice-group-summary')?.textContent).toBe(
      '1 project · 1 file · 120 B',
    );
    expect(rows()[1].querySelector('.codice-group-summary')?.textContent).toBe(
      '1 project · 1 file · 340 B',
    );
    // Move Alpha to "Second" via the accessible strip.
    fireEvent.click(screen.getByLabelText('Move Alpha to another group'));
    fireEvent.click(moveTarget('Second')!);
    // The summary follows the project: First is empty (line gone), Second grew.
    expect(rows()[0].querySelector('.codice-group-summary')).toBeNull();
    expect(rows()[1].querySelector('.codice-group-summary')?.textContent).toBe(
      '2 projects · 2 files · 460 B',
    );
  });

  it('move strip lists only OTHER groups; already-assigned targets are disabled', () => {
    // Alpha belongs to BOTH groups → moving from g1 to g2 is a duplicate.
    const shared = [
      { type: 'ADD_PROJECT', project: makeProject('p1', 'Alpha', [{ name: 'a.kt', size: 120 }]) },
      { type: 'ADD_EXPORT_GROUP', group: group('g1', 'First', ['p1']) },
      { type: 'ADD_EXPORT_GROUP', group: group('g2', 'Second', ['p1']) },
      { type: 'SET_OUTPUT_MODE', mode: 'groups' },
    ];
    render(withProviders(<PanelProbe actions={shared} />));
    // Alpha is in BOTH rows → two identical chip buttons; open row 0's.
    fireEvent.click(screen.getAllByLabelText('Move Alpha to another group')[0]);
    const target = moveTarget('Second');
    expect(target).toBeTruthy();
    expect(target!.disabled).toBe(true);
    // "First" (the chip's own group) is NOT offered as a target.
    const strip = document.querySelector('.codice-move-strip')!;
    const names = Array.from(strip.querySelectorAll('button')).map((b) => b.textContent);
    expect(names).toEqual(['Second']);
  });

  it('Escape closes the strip; the ▸ button toggles it', () => {
    render(withProviders(<PanelProbe actions={twoGroups} />));
    const toggle = () => screen.getByLabelText('Move Alpha to another group');
    fireEvent.click(toggle());
    expect(document.querySelector('.codice-move-strip')).toBeTruthy();
    fireEvent.keyDown(moveTarget('Second')!, { key: 'Escape' });
    expect(document.querySelector('.codice-move-strip')).toBeNull();
    // The ▸ button re-opens, clicking it again closes (toggle).
    fireEvent.click(toggle());
    expect(document.querySelector('.codice-move-strip')).toBeTruthy();
    fireEvent.click(toggle());
    expect(document.querySelector('.codice-move-strip')).toBeNull();
  });

  it('the ▸ button is disabled while there is no other group', () => {
    const single = [
      { type: 'ADD_PROJECT', project: makeProject('p1', 'Alpha', [{ name: 'a.kt', size: 120 }]) },
      { type: 'ADD_EXPORT_GROUP', group: group('g1', 'Only', ['p1']) },
      { type: 'SET_OUTPUT_MODE', mode: 'groups' },
    ];
    render(withProviders(<PanelProbe actions={single} />));
    const btn = screen.getByLabelText('Move Alpha to another group') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('Create another group');
  });

  it('a moved project becomes the LAST section of its new group', () => {
    const ordered = [
      { type: 'ADD_PROJECT', project: makeProject('p1', 'Alpha', [{ name: 'a.kt', size: 120 }]) },
      { type: 'ADD_PROJECT', project: makeProject('p2', 'Beta', [{ name: 'b.kt', size: 340 }]) },
      { type: 'ADD_PROJECT', project: makeProject('p3', 'Gamma', [{ name: 'g.kt', size: 10 }]) },
      { type: 'ADD_EXPORT_GROUP', group: group('g1', 'First', ['p1']) },
      { type: 'ADD_EXPORT_GROUP', group: group('g2', 'Second', ['p2', 'p3']) },
      { type: 'SET_OUTPUT_MODE', mode: 'groups' },
    ];
    render(withProviders(<PanelProbe actions={ordered} />));
    fireEvent.click(screen.getByLabelText('Move Alpha to another group'));
    fireEvent.click(moveTarget('Second')!);
    const wrap = screen.getByTestId('group-chip-g2-p2').parentElement!;
    const ids = Array.from(wrap.querySelectorAll('[data-testid^="group-chip-g2-"]')).map(
      (el) => el.getAttribute('data-testid'),
    );
    // Order = arrival: Alpha appends after Beta and Gamma.
    expect(ids).toEqual(['group-chip-g2-p2', 'group-chip-g2-p3', 'group-chip-g2-p1']);
  });
});
