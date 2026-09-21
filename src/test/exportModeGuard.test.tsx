/**
 * BUG-005 regression tests — the "dead Generate control" bug.
 *
 * Discovered during the browser QA round (master checklist round 10):
 * a persisted `outputMode: 'groups'` combined with a single live project
 * made the Mode select DISPLAY 'combined' (display fallback) while the
 * main Generate button stayed ENABLED — but handleExport() silently
 * returns in groups mode (§11: groups use their own per-group Generate).
 * The user clicked Generate and nothing happened, with no feedback.
 *
 * The fix (ExportPanel):
 *   1. The Mode select always shows the REAL state.outputMode, and stays
 *      escapable — disabled only when outputMode is the default 'combined'
 *      AND there are fewer than two projects.
 *   2. The main Generate button is disabled whenever state.outputMode is
 *      'groups' (matching the handleExport guard), with an explanatory
 *      title pointing at the per-group Generate buttons.
 *
 * These tests pin that behavior so the guard and the UI can never drift
 * apart again.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { AppStateProvider, useAppState } from '@/hooks/useAppState';
import { ToastProvider } from '@/components/common/Toast';
import { ExportPanel } from '@/components/ExportPanel';
import type { ProjectEntry } from '@/types';

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

function PanelProbe({ seed }: { seed?: (payload: { dispatch: ReturnType<typeof useAppState>['dispatch'] }) => void }) {
  const { state, dispatch } = useAppState();
  return (
    <>
      {seed ? seed({ dispatch }) : null}
      <div data-testid="mode">{state.outputMode}</div>
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

describe('BUG-005 — groups mode with a single project (dead Generate guard)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  function mountGroupsModeWithOneProject() {
    const group: { id: string; name: string; projectIds: string[] } = {
      id: 'g1',
      name: 'Export 1',
      projectIds: [],
    };
    const project = makeProject('p1', 'Proj');
    function Seed({ dispatch }: { dispatch: ReturnType<typeof useAppState>['dispatch'] }) {
      return (
        <SeedOnce
          dispatch={dispatch}
          actions={[
            { type: 'ADD_PROJECT', project } as never,
            { type: 'ADD_EXPORT_GROUP', group } as never,
            { type: 'SET_OUTPUT_MODE', mode: 'groups' } as never,
          ]}
        />
      );
    }
    render(withProviders(<PanelProbe seed={(p) => <Seed dispatch={p.dispatch} />} />));
  }

  it('disables the main Generate button in groups mode even with one project', () => {
    mountGroupsModeWithOneProject();
    expect(screen.getByTestId('mode').textContent).toBe('groups');
    // The main Generate (full-width btn-primary with the Download icon text)
    // must be DISABLED — handleExport() returns silently in groups mode.
    const generate = screen.getByTitle(
      'Pick an export group above and press its Generate button',
    );
    expect(generate.tagName).toBe('BUTTON');
    expect((generate as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the REAL output mode in the select (no combined fallback display)', () => {
    mountGroupsModeWithOneProject();
    const modeSelect = screen.getByTitle(
      'Current packaging mode — add another project to change grouping, or switch back to Combined',
    ) as HTMLSelectElement;
    expect(modeSelect.value).toBe('groups');
    // Escapable: not disabled, because the state is not the default.
    expect(modeSelect.disabled).toBe(false);
  });

  it('re-enables Generate after switching back to Combined mode', () => {
    mountGroupsModeWithOneProject();
    const modeSelect = screen.getByTitle(
      'Current packaging mode — add another project to change grouping, or switch back to Combined',
    ) as HTMLSelectElement;
    fireEvent.change(modeSelect, { target: { value: 'combined' } });
    expect(screen.getByTestId('mode').textContent).toBe('combined');
    // In combined mode the Generate button has no explanatory title — find
    // it by its accessible text instead.
    const generate = screen.getByText('Generate').closest('button')!;
    expect(generate.tagName).toBe('BUTTON');
    expect((generate as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps the mode select locked only in the default state with one project', () => {
    const project = makeProject('p1', 'Proj');
    function Seed({ dispatch }: { dispatch: ReturnType<typeof useAppState>['dispatch'] }) {
      return (
        <SeedOnce
          dispatch={dispatch}
          actions={[{ type: 'ADD_PROJECT', project } as never]}
        />
      );
    }
    render(withProviders(<PanelProbe seed={(p) => <Seed dispatch={p.dispatch} />} />));
    expect(screen.getByTestId('mode').textContent).toBe('combined');
    const modeSelect = screen.getByTitle(
      'Only available with multiple projects selected',
    ) as HTMLSelectElement;
    expect(modeSelect.disabled).toBe(true);
  });
});

import { useEffect, useRef } from 'react';

/** Fires each action exactly once on mount (dispatch identity is stable). */
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
