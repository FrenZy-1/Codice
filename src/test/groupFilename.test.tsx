/**
 * R12 — per-group export filename override.
 *
 * Covers:
 *   1. groupExportFilename unit semantics: default `{base}_{group}`,
 *      plain override, {title}/{group}/{date} tokens, filesystem
 *      sanitization of overrides, whitespace-only override = default,
 *      empty global base falls back to 'Codice_Output'.
 *   2. Persistence: a seeded `codice-app-state-v2` with a group filename
 *      survives loadPersistedState (junk non-string values dropped).
 *   3. UI: typing a filename into the group card's "File name" input and
 *      blurring commits it into app state (UPDATE_EXPORT_GROUP patch);
 *      clearing it reverts to the default.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { AppStateProvider, useAppState } from '@/hooks/useAppState';
import { ToastProvider } from '@/components/common/Toast';
import { ExportPanel } from '@/components/ExportPanel';
import {
  groupExportFilename,
  filenameDateToken,
} from '@/lib/groupFilename';

/* ------------------------------------------------------------------ */
/* 1. Pure helper                                                      */
/* ------------------------------------------------------------------ */

describe('groupExportFilename', () => {
  it('defaults to {base}_{group} with sanitization', () => {
    expect(groupExportFilename({ name: 'A + C' }, 'My_Report')).toBe(
      'My_Report_A_C',
    );
  });

  it('uses a plain override verbatim (sanitized)', () => {
    expect(
      groupExportFilename({ name: 'G', filename: 'chapter one' }, 'Base'),
    ).toBe('chapter_one');
  });

  it('expands {title}, {group} and {date} tokens', () => {
    const out = groupExportFilename(
      { name: 'Dissertation', filename: '{title}_{group}_{date}' },
      'Thesis',
      new Date(2026, 8, 16), // local Sep 16 2026
    );
    expect(out).toBe('Thesis_Dissertation_2026-09-16');
  });

  it('sanitizes unsafe characters in the expanded override', () => {
    const out = groupExportFilename(
      { name: 'G', filename: 'my/{group}:v2' },
      'Base',
    );
    expect(out).toBe('my_G_v2');
  });

  it('whitespace-only override falls back to the default', () => {
    expect(groupExportFilename({ name: 'B', filename: '   ' }, 'Base')).toBe(
      'Base_B',
    );
  });

  it('falls back to Codice_Output when the global base is empty', () => {
    expect(groupExportFilename({ name: 'G' }, '')).toBe('Codice_Output_G');
    expect(groupExportFilename({ name: 'G', filename: '{title}' }, '  ')).toBe(
      'Codice_Output',
    );
  });

  it('never returns an empty name (all-token override sanitizing away)', () => {
    expect(groupExportFilename({ name: 'G', filename: '///' }, 'Base')).toBe(
      'output',
    );
  });

  it('filenameDateToken pads month and day', () => {
    expect(filenameDateToken(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

/* ------------------------------------------------------------------ */
/* 2. Persistence                                                      */
/* ------------------------------------------------------------------ */

function StateProbe() {
  const { state } = useAppState();
  return (
    <div data-testid="groups">
      {state.exportGroups
        .map((g) => `${g.name}:${g.filename ?? '-'}`)
        .join('|')}
    </div>
  );
}

describe('group filename persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('loads a persisted filename override; junk non-string values are dropped', () => {
    window.localStorage.setItem(
      'codice-app-state-v2',
      JSON.stringify({
        outputMode: 'groups',
        exportGroups: [
          { id: 'g1', name: 'One', projectIds: [], filename: '{title}_{date}' },
          { id: 'g2', name: 'Two', projectIds: [], filename: 42 },
        ],
      }),
    );
    render(
      <ToastProvider>
        <AppStateProvider>
          <StateProbe />
        </AppStateProvider>
      </ToastProvider>,
    );
    expect(screen.getByTestId('groups').textContent).toBe(
      'One:{title}_{date}|Two:-',
    );
  });
});

/* ------------------------------------------------------------------ */
/* 3. UI commit                                                        */
/* ------------------------------------------------------------------ */

function makeProject(id: string, label: string) {
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

describe('group filename UI commit', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('blurring the File name input commits the override; clearing reverts', () => {
    function SeedBridge() {
      const { dispatch } = useAppState();
      const done = useRef(false);
      useEffect(() => {
        if (done.current) return;
        done.current = true;
        for (const action of [
          { type: 'ADD_PROJECT', project: makeProject('p1', 'Alpha') },
          {
            type: 'ADD_EXPORT_GROUP',
            group: { id: 'g1', name: 'Solo', projectIds: [] },
          },
          { type: 'SET_OUTPUT_MODE', mode: 'groups' },
        ] as never[]) {
          dispatch(action as never);
        }
      }, [dispatch]);
      return (
        <>
          <ExportPanel />
          <StateProbe />
        </>
      );
    }
    render(
      <ToastProvider>
        <AppStateProvider>
          <SeedBridge />
        </AppStateProvider>
      </ToastProvider>,
    );
    const input = screen.getByLabelText('Output filename for Solo') as HTMLInputElement;
    expect(input.placeholder).toBe('Codice_Output_Solo');
    fireEvent.change(input, { target: { value: '{group}_{date}' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('groups').textContent).toContain('Solo:{group}_{date}');

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('groups').textContent).toContain('Solo:-');
  });
});
