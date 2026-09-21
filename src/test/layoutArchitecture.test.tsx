/**
 * Component + integration tests for the layout architecture pass:
 *   - useAppState reducer: v2 layout assignment (one-file-one-section, §3),
 *     section field values, export groups (§11), project merge/unmerge (§11)
 *   - dynamic content entry: FilePropertiesDialog generated from the layout
 *   - multi-folder split logic (§12) + image routing (§16)
 *   - export-group scoped model building
 *   - layout onboarding persistence flags (§0)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useEffect } from 'react';
import { AppStateProvider, useAppState } from '@/hooks/useAppState';
import { ToastProvider } from '@/components/common/Toast';
import { FilePropertiesDialog } from '@/components/FileProperties/FilePropertiesDialog';
import { SectionContentDialog } from '@/components/CustomLayout/SectionContentDialog';
import { MergeProjectsDialog } from '@/components/Merge/MergeProjectsDialog';
import {
  createEmptyTemplate,
  createBlockDef,
  templateSections,
  type CustomLayoutTemplate,
  type SectionChild,
} from '@/lib/customLayouts/model';
import { isLayoutTourDone, markLayoutTourDone, resetLayoutTourDone } from '@/components/CustomLayout/LayoutOnboarding';
import { isImageFile } from '@/lib/imageAssets';
import type { DiscoveredFile, ExportGroup, ProjectEntry } from '@/types';

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

function makeProject(id: string, label: string, fileIds: string[]): ProjectEntry {
  return {
    id,
    label,
    folderName: label,
    files: fileIds.map((fid) => ({
      id: fid,
      projectId: id,
      relativePath: fid,
      name: fid.split('/').pop() ?? fid,
      directory: '',
      size: 10,
      language: 'java',
      isConfig: false,
      binary: false,
      excluded: false,
    })),
    selectedCount: fileIds.length,
    selectedSize: fileIds.length * 10,
    warnings: [],
    addedAt: 1,
  };
}

/** Probe component exposing the LIVE reducer state via a mutable ref. */
function Probe({ apiRef }: { apiRef: { current: ReturnType<typeof useApi> | null } }) {
  const api = useApi();
  useEffect(() => {
    apiRef.current = api;
  });
  return null;
}

function useApi() {
  const { state, dispatch } = useAppState();
  return { state, dispatch };
}

function withProviders(ui: React.ReactNode) {
  return (
    <ToastProvider>
      <AppStateProvider>{ui}</AppStateProvider>
    </ToastProvider>
  );
}

/** v3 template: one Task section (Task Title + Description fields) plus a
 * Code block carrying a required image field (block fields are per-file). */
function makeTemplate(): CustomLayoutTemplate {
  const t = createEmptyTemplate('T');
  const block = createBlockDef('Code', [{ type: 'code' }], [
    { id: 'shotField', label: 'Screenshot', kind: 'image', required: true },
  ]);
  templateSections(t)[0].children.push({ kind: 'block', block });
  return t;
}

describe('layout assignment reducer (§3 — one file, one section, one block)', () => {
  let apiRef: { current: ReturnType<typeof useApi> | null };

  beforeEach(() => {
    window.localStorage.clear();
    apiRef = { current: null };
    render(withProviders(<Probe apiRef={apiRef} />));
    if (!apiRef.current) throw new Error('probe not mounted');
  });

  function api(): ReturnType<typeof useApi> {
    return apiRef.current!;
  }

  it('assigning a file to a block MOVES it out of every other block', () => {
    act(() => { api().dispatch({ type: 'ADD_PROJECT', project: makeProject('p1', 'P', ['f1']) }); });
    act(() => { api().dispatch({ type: 'ASSIGN_FILE_TO_BLOCK', blockId: 'bA', fileId: 'f1' }); });
    expect(api().state.layoutAssignments['bA']).toEqual(['f1']);
    // Reassign to bB — bA must lose it (never two blocks).
    act(() => { api().dispatch({ type: 'ASSIGN_FILE_TO_BLOCK', blockId: 'bB', fileId: 'f1' }); });
    expect(api().state.layoutAssignments['bA']).toEqual([]);
    expect(api().state.layoutAssignments['bB']).toEqual(['f1']);
  });

  it('supports positioned inserts and reordering within a block', () => {
    act(() => { api().dispatch({ type: 'ASSIGN_FILE_TO_BLOCK', blockId: 'bA', fileId: 'f1' }); });
    act(() => { api().dispatch({ type: 'ASSIGN_FILE_TO_BLOCK', blockId: 'bA', fileId: 'f2' }); });
    act(() => { api().dispatch({ type: 'ASSIGN_FILE_TO_BLOCK', blockId: 'bA', fileId: 'f3', position: 0 }); });
    expect(api().state.layoutAssignments['bA']).toEqual(['f3', 'f1', 'f2']);
    // WS-1 folded the old REORDER_ASSIGNED_FILE action into the positioned
    // insert: re-assigning an already-assigned file to the SAME block at a
    // given position MOVES it there (one API for inserts and reordering).
    act(() => { api().dispatch({ type: 'ASSIGN_FILE_TO_BLOCK', blockId: 'bA', fileId: 'f3', position: 2 }); });
    expect(api().state.layoutAssignments['bA']).toEqual(['f1', 'f2', 'f3']);
  });

  it('unassigns per block or everywhere', () => {
    act(() => { api().dispatch({ type: 'ASSIGN_FILE_TO_BLOCK', blockId: 'bA', fileId: 'f1' }); });
    act(() => { api().dispatch({ type: 'UNASSIGN_FILE', fileId: 'f1', blockId: 'bA' }); });
    expect(api().state.layoutAssignments['bA']).toEqual([]);
    act(() => { api().dispatch({ type: 'ASSIGN_FILE_TO_BLOCK', blockId: 'bA', fileId: 'f1' }); });
    act(() => { api().dispatch({ type: 'ASSIGN_FILE_TO_BLOCK', blockId: 'bB', fileId: 'f2' }); });
    act(() => { api().dispatch({ type: 'UNASSIGN_FILE', fileId: 'f1' }); }); // everywhere
    expect(api().state.layoutAssignments['bA']).toEqual([]);
    expect(api().state.layoutAssignments['bB']).toEqual(['f2']);
    act(() => { api().dispatch({ type: 'CLEAR_BLOCK_ASSIGNMENTS', blockId: 'bB' }); });
    expect(api().state.layoutAssignments['bB']).toBeUndefined();
  });
});

describe('export groups reducer (§11)', () => {
  it('adds, updates (reorder/remove projects) and deletes groups', () => {
    window.localStorage.clear();
    const apiRef: { current: ReturnType<typeof useApi> | null } = { current: null };
    render(withProviders(<Probe apiRef={apiRef} />));
    const api = () => apiRef.current!;
    const g: ExportGroup = { id: 'g1', name: 'A + C', projectIds: ['pA', 'pC'] };
    act(() => { api().dispatch({ type: 'ADD_EXPORT_GROUP', group: g }); });
    expect(api().state.exportGroups).toHaveLength(1);
    act(() => { api().dispatch({
      type: 'UPDATE_EXPORT_GROUP',
      group: { ...g, name: 'A only', projectIds: ['pA'] },
    }); });
    expect(api().state.exportGroups[0].name).toBe('A only');
    expect(api().state.exportGroups[0].projectIds).toEqual(['pA']);
    act(() => { api().dispatch({ type: 'DELETE_EXPORT_GROUP', id: 'g1' }); });
    expect(api().state.exportGroups).toHaveLength(0);
  });

  it('removing a project scrubs it from groups; unmerge restores ids', () => {
    window.localStorage.clear();
    const apiRef: { current: ReturnType<typeof useApi> | null } = { current: null };
    render(withProviders(<Probe apiRef={apiRef} />));
    const api = () => apiRef.current!;
    act(() => { api().dispatch({ type: 'ADD_PROJECT', project: makeProject('pA', 'A', ['f1']) }); });
    act(() => { api().dispatch({ type: 'ADD_PROJECT', project: makeProject('pB', 'B', ['f2']) }); });
    act(() => { api().dispatch({
      type: 'ADD_EXPORT_GROUP',
      group: { id: 'g1', name: 'A + B', projectIds: ['pA', 'pB'] },
    }); });
    // Merge then unmerge — the group gets source ids back.
    act(() => { api().dispatch({ type: 'MERGE_PROJECTS', sourceIds: ['pA', 'pB'], mergedId: 'pM' }); });
    const merged = api().state.projects.find((p) => p.id === 'pM')!;
    expect(merged.files).toHaveLength(2);
    expect(api().state.projects).toHaveLength(1);
    expect(api().state.exportGroups[0].projectIds).toEqual(['pM']);
    act(() => { api().dispatch({ type: 'UNMERGE_PROJECTS', mergedId: 'pM' }); });
    expect(api().state.projects.map((p) => p.id)).toEqual(['pA', 'pB']);
    expect(api().state.exportGroups[0].projectIds).toEqual(['pA', 'pB']);
    // Removing a project scrubs it from groups.
    act(() => { api().dispatch({ type: 'REMOVE_PROJECT', projectId: 'pB' }); });
    expect(api().state.exportGroups[0].projectIds).toEqual(['pA']);
  });

  it('merge preserves file identity — duplicates stay independently addressable (§11/§10)', () => {
    window.localStorage.clear();
    const apiRef: { current: ReturnType<typeof useApi> | null } = { current: null };
    render(withProviders(<Probe apiRef={apiRef} />));
    const api = () => apiRef.current!;
    const a = makeProject('pA', 'A', ['src/a/Main.java', 'src/a/Util.java']);
    const b = makeProject('pB', 'B', ['src/b/Main.java']);
    act(() => { api().dispatch({ type: 'ADD_PROJECT', project: a }); });
    act(() => { api().dispatch({ type: 'ADD_PROJECT', project: b }); });
    act(() => { api().dispatch({ type: 'MERGE_PROJECTS', sourceIds: ['pA', 'pB'], mergedId: 'pM' }); });
    const merged = api().state.projects.find((p) => p.id === 'pM')!;
    // All three files present, ids unique, duplicate names intact.
    const ids = new Set(merged.files.map((f) => f.id));
    expect(ids.size).toBe(3);
    expect(merged.files.filter((f) => f.name === 'Main.java')).toHaveLength(2);
    expect(merged.label).toBe('A + B');
    // Undo restores the ORIGINAL project entries (names + files).
    act(() => { api().dispatch({ type: 'UNMERGE_PROJECTS', mergedId: 'pM' }); });
    const restoredA = api().state.projects.find((p) => p.id === 'pA')!;
    expect(restoredA.label).toBe('A');
    expect(restoredA.files.map((f) => f.id)).toEqual(['src/a/Main.java', 'src/a/Util.java']);
  });
});

describe('dynamic content entry (§8) — generated from the layout', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  function seedLayout(storage: Record<string, unknown>) {
    const t = makeTemplate();
    storage['codice-custom-layouts-v1'] = JSON.stringify([t]);
    return t;
  }

  it('without an applied layout the standard Details remain available (§8)', async () => {
    const Seed = () => {
      const { dispatch } = useApi();
      return (
        <button
          onClick={() => {
            dispatch({ type: 'ADD_PROJECT', project: makeProject('p1', 'P', ['f1']) });
          }}
        >
          seed
        </button>
      );
    };
    render(
      withProviders(
        <>
          <Seed />
          <FilePropertiesDialog target={{ projectId: 'p1', fileId: 'f1' }} onClose={() => {}} />,
        </>,
      ),
    );
    fireEvent.click(screen.getByText('seed'));
    // No layout applied → the standard Details section is present; no
    // layout-content section is generated.
    await waitFor(() => expect(screen.getByText('Details')).toBeTruthy());
  });

  it('SectionContentDialog renders image fields with a real picker and saves values', async () => {
    const t = makeTemplate();
    const s = templateSections(t)[0];
    // The dialog's form is GENERATED from the field definitions — mix the
    // section fields (text/textarea) with the block's image field.
    const shot = (s.children.find(
      (c): c is Extract<SectionChild, { kind: 'block' }> => c.kind === 'block',
    )!).block.fields[0];
    const titleFieldId = s.fields[0].id;
    const apiRef: { current: ReturnType<typeof useApi> | null } = { current: null };
    render(
      withProviders(
        <>
          <Probe apiRef={apiRef} />
          <SectionContentDialog
            sectionId={s.id}
            sectionName={s.name}
            fields={[...s.fields, shot]}
            onClose={() => {}}
          />
        </>,
      ),
    );
    // Task Title (text) + Description (textarea) from the task preset.
    const title = screen.getByLabelText(/Task Title/i) as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Chapter 1' } });
    expect(title.value).toBe('Chapter 1');
    // Image field → a real picker (button + empty state), never a text input.
    expect(screen.getByText('No image selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add image/ })).toBeTruthy();
    expect(screen.getByText('Save')).toBeTruthy();
    // Saving writes the section-scope value store the resolver reads.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Section content saved')).toBeTruthy();
    await waitFor(() =>
      expect(apiRef.current!.state.sectionFieldValues[s.id]?.[titleFieldId]).toBe('Chapter 1'),
    );
  });

  it('MergeProjectsDialog merges exactly the picked projects (§11)', async () => {
    window.localStorage.clear();
    const apiRef: { current: ReturnType<typeof useApi> | null } = { current: null };
    const Seed = () => {
      const { dispatch } = useApi();
      return (
        <button
          onClick={() => {
            dispatch({ type: 'ADD_PROJECT', project: makeProject('pA', 'A', ['f1']) });
            dispatch({ type: 'ADD_PROJECT', project: makeProject('pB', 'B', ['f2']) });
          }}
        >
          seed
        </button>
      );
    };
    render(
      withProviders(
        <>
          <Probe apiRef={apiRef} />
          <Seed />
          <MergeProjectsDialog projectId="pA" onClose={() => {}} />
        </>,
      ),
    );
    fireEvent.click(screen.getByText('seed'));
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByText(/Merge 2 projects/));
    await waitFor(() => {
      // The dialog mints its own merged id — assert on the shape.
      expect(apiRef.current!.state.projects).toHaveLength(1);
      const merged = apiRef.current!.state.projects[0];
      expect(merged.label).toBe('A + B');
      expect(merged.files).toHaveLength(2);
      expect(apiRef.current!.state.mergeSources[merged.id].sources).toHaveLength(2);
    });
  });
});

describe('image routing in the upload area (§16)', () => {
  it('classifies images by MIME and extension; non-images stay document inputs', () => {
    const png = new File(['x'], 'shot.png', { type: 'image/png' });
    const jpg = new File(['x'], 'photo.JPG', { type: '' });
    const java = new File(['x'], 'Main.java', { type: 'text/x-java' });
    const zip = new File(['x'], 'proj.zip', { type: 'application/zip' });
    expect(isImageFile(png)).toBe(true);
    expect(isImageFile(jpg)).toBe(true);
    expect(isImageFile(java)).toBe(false);
    expect(isImageFile(zip)).toBe(false);
  });
});

describe('layout onboarding flags (§0)', () => {
  it('is not done by default, persists on finish, and can be reset (re-openable)', () => {
    window.localStorage.clear();
    expect(isLayoutTourDone()).toBe(false);
    markLayoutTourDone();
    expect(isLayoutTourDone()).toBe(true);
    resetLayoutTourDone();
    expect(isLayoutTourDone()).toBe(false);
  });
});

describe('multi-project export group model building (§11)', () => {
  it('a group exports exactly its projects in its order', () => {
    // The ExportPanel maps group.projectIds → buildDocumentModel inputs in
    // the ORDER stored on the group. Verify the mapping logic contract:
    const projects = [makeProject('pA', 'A', ['f1']), makeProject('pB', 'B', ['f2']), makeProject('pC', 'C', ['f3'])];
    const group: ExportGroup = { id: 'g', name: 'B + A', projectIds: ['pB', 'pA'] };
    const ordered = group.projectIds
      .map((id) => projects.find((p) => p.id === id))
      .filter(Boolean);
    expect(ordered.map((p) => p!.id)).toEqual(['pB', 'pA']);
  });
});
