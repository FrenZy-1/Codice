/**
 * R11 regression tests — export-group rename, reorder, and drag-to-assign
 * (the EXPORT-004 enhancement).
 *
 * Covers:
 *   1. REORDER_EXPORT_GROUPS reducer: splice semantics (forward + backward
 *      moves), same-index no-op (SAME reference), and out-of-range guard
 *      (a stale drag must never corrupt the list).
 *   2. Inline rename UI: pencil + double-click open the editor; Enter
 *      commits (trimmed, empty keeps the old name); Escape cancels.
 *   3. Drag-to-assign: dropping a sidebar project drag
 *      ('application/x-codice-project' payload) onto a group row appends
 *      the project (order = drop order) and toasts; a duplicate drop is
 *      rejected with an info toast and NO state change.
 *   4. Keyboard reorder: ArrowDown/ArrowUp on the row handle moves the
 *      group by one position.
 *   5. Drag-in-flight hint: the sidebar's CustomEvents ('codice-project-
 *      drag-start' / '-end') show/hide the "drop onto a group" hint.
 *
 * jsdom has no DataTransfer, so drop events use a minimal mock carrying
 * the custom payload — same approach as the sidebar-reorder tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { AppStateProvider, reducer, useAppState } from '@/hooks/useAppState';
import type { AppState } from '@/hooks/useAppState';
import { ToastProvider } from '@/components/common/Toast';
import { ExportPanel } from '@/components/ExportPanel';
import type { ExportGroup, ProjectEntry } from '@/types';

/* ------------------------------------------------------------------ */
/* Factories                                                           */
/* ------------------------------------------------------------------ */

function makeProject(id: string, label: string): ProjectEntry {
  return {
    id,
    label,
    folderName: label,
    files: [
      {
        id: `${id}-f1`,
        projectId: id,
        relativePath: 'Main.kt',
        name: 'Main.kt',
        directory: '',
        size: 10,
        language: 'kotlin',
        isConfig: false,
        binary: false,
        excluded: false,
      },
    ],
    selectedCount: 1,
    selectedSize: 10,
    warnings: [],
    addedAt: 1,
  };
}

function group(id: string, name: string, projectIds: string[]): ExportGroup {
  return { id, name, projectIds };
}

/* ------------------------------------------------------------------ */
/* 1. REORDER_EXPORT_GROUPS reducer                                    */
/* ------------------------------------------------------------------ */

describe('REORDER_EXPORT_GROUPS (reducer)', () => {
  const abc = [group('a', 'A', []), group('b', 'B', []), group('c', 'C', [])];
  const state = { exportGroups: abc } as unknown as AppState;

  it('moves a group forward (0 → 2)', () => {
    const next = reducer(state, { type: 'REORDER_EXPORT_GROUPS', from: 0, to: 2 });
    expect(next.exportGroups.map((g) => g.id)).toEqual(['b', 'c', 'a']);
  });

  it('moves a group backward (2 → 0)', () => {
    const next = reducer(state, { type: 'REORDER_EXPORT_GROUPS', from: 2, to: 0 });
    expect(next.exportGroups.map((g) => g.id)).toEqual(['c', 'a', 'b']);
  });

  it('is a same-reference no-op when from === to', () => {
    const next = reducer(state, { type: 'REORDER_EXPORT_GROUPS', from: 1, to: 1 });
    expect(next).toBe(state);
  });

  it('is a no-op (same reference) on out-of-range indices', () => {
    expect(
      reducer(state, { type: 'REORDER_EXPORT_GROUPS', from: -1, to: 0 }),
    ).toBe(state);
    expect(
      reducer(state, { type: 'REORDER_EXPORT_GROUPS', from: 0, to: 3 }),
    ).toBe(state);
    expect(
      reducer(state, { type: 'REORDER_EXPORT_GROUPS', from: 5, to: 0 }),
    ).toBe(state);
  });
});

describe('ADJUST_EXPORT_GROUP_COUNT (BUG-008 regression, reducer)', () => {
  // BUG-008: the component's absolute-target stepper read a stale state
  // snapshot, so rapid + clicks misnamed every appended group "Export 1".
  // The delta action resolves against FRESH state each dispatch.
  const empty = { exportGroups: [] as ExportGroup[] } as unknown as AppState;

  it('sequential + dispatches name groups Export 1, 2, 3 (no duplicates)', () => {
    let s = empty;
    for (let i = 0; i < 3; i++) {
      s = reducer(s, { type: 'ADJUST_EXPORT_GROUP_COUNT', delta: 1 });
    }
    expect(s.exportGroups.map((g) => g.name)).toEqual([
      'Export 1',
      'Export 2',
      'Export 3',
    ]);
    expect(new Set(s.exportGroups.map((g) => g.id)).size).toBe(3);
    expect(s.exportGroups.every((g) => g.projectIds.length === 0)).toBe(true);
  });

  it('shrinks from the TRAILING end and clamps at zero', () => {
    let s = empty;
    for (let i = 0; i < 3; i++) {
      s = reducer(s, { type: 'ADJUST_EXPORT_GROUP_COUNT', delta: 1 });
    }
    s = reducer(s, { type: 'ADJUST_EXPORT_GROUP_COUNT', delta: -1 });
    expect(s.exportGroups.map((g) => g.name)).toEqual(['Export 1', 'Export 2']);
    s = reducer(s, { type: 'ADJUST_EXPORT_GROUP_COUNT', delta: -5 });
    expect(s.exportGroups).toEqual([]);
    // Clamped: further shrink is a same-reference no-op.
    expect(reducer(s, { type: 'ADJUST_EXPORT_GROUP_COUNT', delta: -1 })).toBe(s);
  });
});

/* ------------------------------------------------------------------ */
/* UI harness — mirrors exportModeGuard.test.tsx                       */
/* ------------------------------------------------------------------ */

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

const pencilFor = (name: string) =>
  screen.getByTitle(`Rename group ${name}`);

function mountTwoGroups() {
  const actions = [
    { type: 'ADD_PROJECT', project: makeProject('p1', 'Alpha') },
    { type: 'ADD_PROJECT', project: makeProject('p2', 'Beta') },
    { type: 'ADD_EXPORT_GROUP', group: group('g1', 'A + C', []) },
    { type: 'ADD_EXPORT_GROUP', group: group('g2', 'Solo', []) },
    { type: 'SET_OUTPUT_MODE', mode: 'groups' },
  ];
  render(withProviders(<PanelProbe actions={actions} />));
}

/* ------------------------------------------------------------------ */
/* 2. Inline rename                                                    */
/* ------------------------------------------------------------------ */

describe('Export group inline rename', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('commits a renamed group on Enter (trim included)', () => {
    mountTwoGroups();
    fireEvent.click(pencilFor('A + C'));
    const input = screen.getByLabelText('Rename group (was A + C)');
    fireEvent.change(input, { target: { value: '  Dissertation  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTitle('Dissertation — double-click or use the pencil to rename')).toBeTruthy();
    // Old name gone, other group untouched.
    expect(screen.queryByText('A + C')).toBeNull();
    expect(screen.getByText('Solo')).toBeTruthy();
  });

  it('Escape cancels without changing the name', () => {
    mountTwoGroups();
    fireEvent.click(pencilFor('A + C'));
    const input = screen.getByLabelText('Rename group (was A + C)');
    fireEvent.change(input, { target: { value: 'Wrong' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByText('A + C')).toBeTruthy();
    expect(screen.queryByLabelText('Rename group (was A + C)')).toBeNull();
  });

  it('an empty draft keeps the existing name on commit', () => {
    mountTwoGroups();
    fireEvent.doubleClick(screen.getByText('Solo'));
    const input = screen.getByLabelText('Rename group (was Solo)');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Solo')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* 3. Drag-to-assign (EXPORT-004)                                      */
/* ------------------------------------------------------------------ */

function mockDataTransfer(opts: {
  projectPayload?: string;
  types?: string[];
}): DataTransfer {
  const store = new Map<string, string>();
  if (opts.projectPayload !== undefined) {
    store.set('application/x-codice-project', opts.projectPayload);
  }
  return {
    getData: (t: string) => store.get(t) ?? '',
    types: opts.types ?? Array.from(store.keys()),
    dropEffect: 'copy',
    effectAllowed: 'copy',
    setData: (t: string, v: string) => void store.set(t, v),
  } as unknown as DataTransfer;
}

describe('Export group drag-to-assign', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('appends a dropped project to the group and toasts', () => {
    mountTwoGroups();
    const row = screen.getByText('A + C').closest('li')!;
    fireEvent.drop(row, {
      dataTransfer: mockDataTransfer({ projectPayload: 'p1' }),
    });
    // The chip now exists inside the row, numbered 1.
    const chip = screen.getByTitle('Remove Alpha from group');
    expect(chip).toBeTruthy();
    // Success toast surfaced.
    expect(screen.getByText('Added “Alpha” to “A + C”.')).toBeTruthy();
  });

  it('rejects a duplicate drop with an info toast and no state change', () => {
    // Pre-seed the group WITH the project already assigned.
    const actions = [
      { type: 'ADD_PROJECT', project: makeProject('p1', 'Alpha') },
      { type: 'ADD_EXPORT_GROUP', group: group('g1', 'A + C', ['p1']) },
      { type: 'SET_OUTPUT_MODE', mode: 'groups' },
    ];
    render(withProviders(<PanelProbe actions={actions} />));
    const row = screen.getByText('A + C').closest('li')!;
    fireEvent.drop(row, {
      dataTransfer: mockDataTransfer({ projectPayload: 'p1' }),
    });
    // Still exactly ONE chip (no duplicate) + the info toast, not success.
    expect(screen.getAllByTitle('Remove Alpha from group')).toHaveLength(1);
    expect(screen.getByText('“Alpha” is already in “A + C”.')).toBeTruthy();
    expect(screen.queryByText('Added “Alpha” to “A + C”.')).toBeNull();
  });

  it('ignores drops carrying no project payload', () => {
    mountTwoGroups();
    const row = screen.getByText('A + C').closest('li')!;
    // No payload → treated as an internal reorder drop with no drag state
    // → silent no-op. No chip appears, nothing throws.
    fireEvent.drop(row, { dataTransfer: mockDataTransfer({}) });
    expect(screen.queryByTitle('Remove Alpha from group')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 4. Keyboard reorder via the row handle                              */
/* ------------------------------------------------------------------ */

describe('Export group keyboard reorder', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('ArrowDown moves the first group to position 2 (order + chips renumber)', () => {
    mountTwoGroups();
    const handle = screen.getByLabelText(
      'Reorder export group A + C. Currently position 1. Press ArrowUp or ArrowDown to move.',
    );
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    // After the swap, "A + C" holds position 2 and "Solo" position 1.
    expect(
      screen.getByLabelText(
        'Reorder export group A + C. Currently position 2. Press ArrowUp or ArrowDown to move.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Reorder export group Solo. Currently position 1. Press ArrowUp or ArrowDown to move.',
      ),
    ).toBeTruthy();
  });

  it('ArrowUp on the first group is a no-op (state unchanged)', () => {
    mountTwoGroups();
    const handle = screen.getByLabelText(
      'Reorder export group A + C. Currently position 1. Press ArrowUp or ArrowDown to move.',
    );
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(
      screen.getByLabelText(
        'Reorder export group A + C. Currently position 1. Press ArrowUp or ArrowDown to move.',
      ),
    ).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* 5. Drag-in-flight hint                                              */
/* ------------------------------------------------------------------ */

describe('Project-drag hint (sidebar ↔ export panel)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows the hint while a project drag is active and hides it on drag end', () => {
    mountTwoGroups();
    expect(screen.queryByText(/Drop the project onto a group/)).toBeNull();
    // Raw window events bypass fireEvent's auto-act — wrap explicitly.
    act(() => {
      window.dispatchEvent(new CustomEvent('codice-project-drag-start'));
    });
    expect(screen.getByText(/Drop the project onto a group/)).toBeTruthy();
    act(() => {
      window.dispatchEvent(new CustomEvent('codice-project-drag-end'));
    });
    expect(screen.queryByText(/Drop the project onto a group/)).toBeNull();
  });
});
