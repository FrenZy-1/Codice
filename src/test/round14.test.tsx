/**
 * R14 regression tests — the three features shipped this round:
 *
 *   1. MOVE_EXPORT_GROUP_PROJECT reducer: chip reorder WITHIN an export
 *      group (splice semantics; silent no-op on missing group / same index
 *      / out-of-range indices — a stale drag must never corrupt order).
 *   2. planGenerateAll: which groups "Generate all" runs (live = uploaded
 *      AND has selected files) + skipped counting, scaffold order kept.
 *   3. persistSignal + SaveIndicator: the autosave save-state events
 *      ('dirty' on change, 'saved' after the debounced write) drive the
 *      header indicator through idle → dirty → saved → idle.
 *   4. Chip reorder UI: the ↑/↓ chip buttons dispatch the reducer action
 *      with the right indices; a chip DRAG drop reorders too; and a chip
 *      payload dropped on the group ROW is ignored (row-level guard).
 *   5. Generate all button: hidden when no exportable group, visible with
 *      the right aria-label when at least one group is exportable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { AppStateProvider, reducer, useAppState } from '@/hooks/useAppState';
import type { AppState } from '@/hooks/useAppState';
import { ToastProvider } from '@/components/common/Toast';
import { ExportPanel } from '@/components/ExportPanel';
import { SaveIndicator, SAVED_LINGER_MS } from '@/components/common/SaveIndicator';
import { planGenerateAll } from '@/lib/generateAll';
import {
  PERSIST_SIGNAL_EVENT,
  emitPersistSignal,
  onPersistSignal,
} from '@/lib/persistSignal';
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
/* 1. MOVE_EXPORT_GROUP_PROJECT (reducer)                              */
/* ------------------------------------------------------------------ */

describe('MOVE_EXPORT_GROUP_PROJECT (reducer)', () => {
  const abc = group('g1', 'A', ['a', 'b', 'c']);
  const other = group('g2', 'B', ['x']);
  const state = { exportGroups: [abc, other] } as unknown as AppState;

  it('moves a chip forward (0 → 2) inside the target group only', () => {
    const next = reducer(state, {
      type: 'MOVE_EXPORT_GROUP_PROJECT',
      groupId: 'g1',
      from: 0,
      to: 2,
    });
    expect(next.exportGroups[0].projectIds).toEqual(['b', 'c', 'a']);
    // The other group is untouched.
    expect(next.exportGroups[1]).toBe(other);
  });

  it('moves a chip backward (2 → 0)', () => {
    const next = reducer(state, {
      type: 'MOVE_EXPORT_GROUP_PROJECT',
      groupId: 'g1',
      from: 2,
      to: 0,
    });
    expect(next.exportGroups[0].projectIds).toEqual(['c', 'a', 'b']);
  });

  it('is a same-reference no-op when from === to', () => {
    const next = reducer(state, {
      type: 'MOVE_EXPORT_GROUP_PROJECT',
      groupId: 'g1',
      from: 1,
      to: 1,
    });
    expect(next).toBe(state);
  });

  it('is a no-op when the group id is unknown (stale drag)', () => {
    const next = reducer(state, {
      type: 'MOVE_EXPORT_GROUP_PROJECT',
      groupId: 'missing',
      from: 0,
      to: 1,
    });
    expect(next).toBe(state);
  });

  it('is a no-op on out-of-range indices', () => {
    for (const [from, to] of [
      [-1, 0],
      [0, -1],
      [0, 3],
      [3, 0],
      [5, 5],
    ]) {
      expect(
        reducer(state, {
          type: 'MOVE_EXPORT_GROUP_PROJECT',
          groupId: 'g1',
          from,
          to,
        }),
      ).toBe(state);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. planGenerateAll                                                  */
/* ------------------------------------------------------------------ */

describe('planGenerateAll', () => {
  it('keeps scaffold order and exports only groups with live projects', () => {
    const groups = [
      group('g1', 'A', ['p1']),
      group('g2', 'B', ['gone']),
      group('g3', 'C', ['p2', 'p1']),
      group('g4', 'D', []),
    ];
    const plan = planGenerateAll(groups, new Set(['p1', 'p2']));
    expect(plan.ids).toEqual(['g1', 'g3']);
    expect(plan.skipped).toBe(2);
  });

  it('reports everything skipped when no project is live', () => {
    const plan = planGenerateAll([group('g1', 'A', ['p1'])], new Set());
    expect(plan.ids).toEqual([]);
    expect(plan.skipped).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* 3. persistSignal                                                    */
/* ------------------------------------------------------------------ */

describe('persistSignal', () => {
  it('emitPersistSignal dispatches a window CustomEvent with detail', () => {
    const seen: Array<{ status: string; at: number }> = [];
    const unsub = onPersistSignal((d) => seen.push({ ...d }));
    act(() => {
      emitPersistSignal('dirty');
    });
    unsub();
    expect(seen).toHaveLength(1);
    expect(seen[0].status).toBe('dirty');
    expect(typeof seen[0].at).toBe('number');
  });

  it('unsubscribes cleanly and ignores foreign events', () => {
    const seen: string[] = [];
    const unsub = onPersistSignal((d) => seen.push(d.status));
    act(() => {
      window.dispatchEvent(new CustomEvent(PERSIST_SIGNAL_EVENT, { detail: { status: 'nope' } }));
      emitPersistSignal('saved');
    });
    unsub();
    act(() => {
      emitPersistSignal('dirty');
    });
    expect(seen).toEqual(['saved']);
  });
});

/* ------------------------------------------------------------------ */
/* 4. SaveIndicator                                                    */
/* ------------------------------------------------------------------ */

describe('SaveIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves idle → dirty → saved → idle on the persist signals', () => {
    render(<SaveIndicator />);
    const el = () => screen.getByTestId('save-indicator');
    expect(el().getAttribute('data-phase')).toBe('idle');
    act(() => {
      emitPersistSignal('dirty');
    });
    expect(el().getAttribute('data-phase')).toBe('dirty');
    expect(el().textContent).toContain('Saving…');
    act(() => {
      emitPersistSignal('saved');
    });
    expect(el().getAttribute('data-phase')).toBe('saved');
    expect(el().textContent).toContain('Saved');
    // The "Saved" confirmation lingers, then fades back to the muted idle
    // check so the header does not stay busy.
    act(() => {
      vi.advanceTimersByTime(SAVED_LINGER_MS + 10);
    });
    expect(el().getAttribute('data-phase')).toBe('idle');
  });
});

/* ------------------------------------------------------------------ */
/* 5. Persistence integration (dirty on change, saved after write)     */
/* ------------------------------------------------------------------ */

function PersistProbe() {
  const { dispatch } = useAppState();
  return (
    <button
      type="button"
      onClick={() => dispatch({ type: 'SET_OUTPUT_FILENAME', filename: 'probe-r14' })}
    >
      poke
    </button>
  );
}

describe('AppStateProvider persist signals (integration)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits dirty immediately and saved after the debounced write', () => {
    const seen: string[] = [];
    const unsub = onPersistSignal((d) => seen.push(d.status));
    render(
      <ToastProvider>
        <AppStateProvider>
          <PersistProbe />
        </AppStateProvider>
      </ToastProvider>,
    );
    // The initial mount writes the restored state back WITHOUT a dirty
    // signal (bookkeeping, not a user edit).
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(seen).toEqual(['saved']);
    // A real edit: dirty fires at once, saved once the 500 ms debounce
    // fires and the write completes.
    seen.length = 0;
    fireEvent.click(screen.getByText('poke'));
    expect(seen).toEqual(['dirty']);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(seen).toEqual(['dirty', 'saved']);
    expect(window.localStorage.getItem('codice-app-state-v2')).toContain('probe-r14');
    unsub();
  });
});

/* ------------------------------------------------------------------ */
/* 6. Chip reorder UI                                                  */
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

const chipActions = [
  { type: 'ADD_PROJECT', project: makeProject('p1', 'Alpha') },
  { type: 'ADD_PROJECT', project: makeProject('p2', 'Beta') },
  { type: 'ADD_PROJECT', project: makeProject('p3', 'Gamma') },
  { type: 'ADD_EXPORT_GROUP', group: group('g1', 'Trio', ['p1', 'p2', 'p3']) },
  { type: 'SET_OUTPUT_MODE', mode: 'groups' },
];

function mountChipGroup() {
  render(withProviders(<PanelProbe actions={chipActions} />));
}

/** Labels of the group's chips in DOM (assembly) order. */
function chipOrder(): string[] {
  const first = screen.getByTestId('group-chip-g1-p1');
  const wrap = first.parentElement!;
  return Array.from(wrap.querySelectorAll<HTMLElement>('[data-testid^="group-chip-g1-"]')).map(
    (el) => {
      const id = el.getAttribute('data-testid')!;
      return id.replace(`group-chip-g1-`, '');
    },
  );
}

describe('Chip reorder within an export group', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('the ↑ button moves a chip up (Beta: 1 → 0)', () => {
    mountChipGroup();
    expect(chipOrder()).toEqual(['p1', 'p2', 'p3']);
    fireEvent.click(screen.getByLabelText('Move Beta up in Trio'));
    expect(chipOrder()).toEqual(['p2', 'p1', 'p3']);
  });

  it('the ↓ button moves a chip down (Gamma: 2 → end is already end; use ↓ on Alpha)', () => {
    mountChipGroup();
    fireEvent.click(screen.getByLabelText('Move Alpha down in Trio'));
    expect(chipOrder()).toEqual(['p2', 'p1', 'p3']);
  });

  it('end chips have their outward button disabled', () => {
    mountChipGroup();
    const up = screen.getByLabelText('Move Alpha up in Trio') as HTMLButtonElement;
    const down = screen.getByLabelText(
      'Move Gamma down in Trio',
    ) as HTMLButtonElement;
    expect(up.disabled).toBe(true);
    expect(down.disabled).toBe(true);
  });

  it('a chip DRAG drop reorders (drag p1 onto the p3 chip)', () => {
    mountChipGroup();
    const target = screen.getByTestId('group-chip-g1-p3');
    const store = new Map<string, string>([
      ['application/x-codice-chip', JSON.stringify({ groupId: 'g1', index: 0 })],
    ]);
    const dt = {
      getData: (t: string) => store.get(t) ?? '',
      types: Array.from(store.keys()),
      dropEffect: 'move',
      effectAllowed: 'move',
      setData: (t: string, v: string) => void store.set(t, v),
    } as unknown as DataTransfer;
    fireEvent.drop(target, { dataTransfer: dt });
    // from=0 onto index=2 with no below-hint → to=2, from<to → to=1.
    expect(chipOrder()).toEqual(['p2', 'p1', 'p3']);
  });

  it('a chip payload dropped on the group ROW is ignored (row guard)', () => {
    mountChipGroup();
    const row = screen.getByText('Trio').closest('li')!;
    const store = new Map<string, string>([
      ['application/x-codice-chip', JSON.stringify({ groupId: 'g1', index: 0 })],
    ]);
    const dt = {
      getData: (t: string) => store.get(t) ?? '',
      types: Array.from(store.keys()),
      dropEffect: 'move',
      effectAllowed: 'move',
      setData: (t: string, v: string) => void store.set(t, v),
    } as unknown as DataTransfer;
    fireEvent.drop(row, { dataTransfer: dt });
    expect(chipOrder()).toEqual(['p1', 'p2', 'p3']);
  });
});

/* ------------------------------------------------------------------ */
/* 7. Generate all button                                              */
/* ------------------------------------------------------------------ */

describe('Generate all', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('is hidden when no group is exportable (empty scaffold)', () => {
    render(
      withProviders(
        <PanelProbe
          actions={[
            { type: 'ADD_EXPORT_GROUP', group: group('g1', 'Empty', []) },
            { type: 'SET_OUTPUT_MODE', mode: 'groups' },
          ]}
        />,
      ),
    );
    expect(screen.queryByLabelText(/^Generate all/)).toBeNull();
  });

  it('is visible with a count label when a group has a live project', () => {
    render(withProviders(<PanelProbe actions={chipActions} />));
    const btn = screen.getByLabelText('Generate all 1 group');
    expect(btn.textContent).toContain('Generate all');
  });
});
