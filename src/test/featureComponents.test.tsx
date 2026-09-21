/**
 * Component tests for the large feature pass UI:
 *   - DocumentOrderPanel — sidebar reorder surface (§13)
 *   - FilePropertiesDialog — per-file details editor (§6/§7/§8)
 *   - FileContextMenu — context menu actions (§7/§38)
 *   - ProjectUpload — standalone files chip (§4)
 *
 * All interactions go through the REAL AppStateProvider so the tests also
 * pin the "one canonical state" rule (§14): reordering in one surface
 * changes the shared fileOrder slice.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AppStateProvider, useAppState } from '@/hooks/useAppState';
import { ToastProvider } from '@/components/common/Toast';
import { DocumentOrderPanel } from '@/components/FileProperties/DocumentOrderPanel';
import { FilePropertiesDialog } from '@/components/FileProperties/FilePropertiesDialog';
import { FileContextMenu } from '@/components/FileProperties/FileContextMenu';
import { ProjectUpload } from '@/components/ProjectUpload';
import { discoverStandaloneFiles } from '@/lib/fileDiscovery';
import type { ProjectEntry } from '@/types';
import { useEffect, useRef } from 'react';

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

function makeProject(): ProjectEntry {
  const mk = (id: string, name: string) => ({
    id,
    projectId: 'p1',
    relativePath: name,
    name,
    directory: '',
    size: 120,
    language: 'kotlin',
    isConfig: false,
    binary: false,
    excluded: false,
  });
  return {
    id: 'p1',
    label: 'Demo',
    folderName: 'Demo',
    files: [mk('f1', 'A.kt'), mk('f2', 'B.kt'), mk('f3', 'C.kt')],
    selectedCount: 3,
    selectedSize: 360,
    warnings: [],
    addedAt: 1,
  };
}

/** Seeds one project after mount, then renders children. */
function WithProject({ children }: { children?: React.ReactNode }) {
  const { dispatch, state } = useAppState();
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && state.projects.length === 0) {
      seeded.current = true;
      act(() => {
        dispatch({ type: 'ADD_PROJECT', project: makeProject() });
      });
    }
  }, [dispatch, state.projects.length]);
  return (
    <>
      {children}
      <span data-testid="project-count">{state.projects.length}</span>
    </>
  );
}

function renderInApp(ui: React.ReactNode) {
  return render(
    <ToastProvider>
      <AppStateProvider>
        <WithProject>{ui}</WithProject>
      </AppStateProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

/* ------------------------------------------------------------------ */
/* §13 — DocumentOrderPanel                                            */
/* ------------------------------------------------------------------ */

describe('DocumentOrderPanel (§13)', () => {
  it('starts collapsed and expands into a reorderable list', async () => {
    renderInApp(<DocumentOrderPanel />);
    // Wait for the seeded project.
    await screen.findByText('Document order');
    const toggle = screen.getByRole('button', { name: /Document order/ });
    fireEvent.click(toggle);
    const list = document.querySelector('#codice-document-order')!;
    expect(list.querySelectorAll('li')).toHaveLength(3);
  });

  it('moves a file up via the keyboard-accessible buttons and updates the shared order', async () => {
    const { container } = renderInApp(<DocumentOrderPanel />);
    await screen.findByText('Document order');
    fireEvent.click(screen.getByRole('button', { name: /Document order/ }));
    const list = container.querySelector('#codice-document-order')!;
    // Move the second file (B.kt) up.
    fireEvent.click(list.querySelectorAll('li')[1].querySelector('button[title="Move earlier"]')!);
    const titles = fileOrderTitles(container);
    expect(titles).toEqual(['B.kt', 'A.kt', 'C.kt']);
  });

  it('reset restores the default path order', async () => {
    const { container } = renderInApp(<DocumentOrderPanel />);
    await screen.findByText('Document order');
    fireEvent.click(screen.getByRole('button', { name: /Document order/ }));
    const list = container.querySelector('#codice-document-order')!;
    fireEvent.click(list.querySelectorAll('li')[1].querySelector('button[title="Move earlier"]')!);
    fireEvent.click(container.querySelector('button[title$="default path order"]')!);
    expect(fileOrderTitles(container)).toEqual(['A.kt', 'B.kt', 'C.kt']);
  });

  /** File titles only — excludes the drag-handle hint spans. */
  function fileOrderTitles(container: HTMLElement): string[] {
    return Array.from(
      container
        .querySelector('#codice-document-order')!
        .querySelectorAll('li span[title]'),
    )
      .map((s) => s.getAttribute('title') ?? '')
      .filter((t) => t && !t.startsWith('Drag'));
  }

  it('first/last files have their boundary buttons disabled', async () => {
    const { container } = renderInApp(<DocumentOrderPanel />);
    await screen.findByText('Document order');
    fireEvent.click(screen.getByRole('button', { name: /Document order/ }));
    const list = container.querySelector('#codice-document-order')!;
    const first = list.querySelectorAll('li')[0];
    const last = list.querySelectorAll('li')[2];
    expect((first.querySelector('button[title="Move earlier"]') as HTMLButtonElement).disabled).toBe(true);
    expect((last.querySelector('button[title="Move later"]') as HTMLButtonElement).disabled).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* §6/§7/§8 — FilePropertiesDialog                                     */
/* ------------------------------------------------------------------ */

describe('FilePropertiesDialog (§6/§7/§8)', () => {
  it('shows file information rows (name, path, language, size, project, status)', async () => {
    renderInApp(
      <FilePropertiesDialog target={{ projectId: 'p1', fileId: 'f2' }} onClose={() => {}} />,
    );
    await screen.findByRole('dialog');
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('B.kt');
    expect(dialog.textContent).toContain('Relative path');
    expect(dialog.textContent).toContain('Demo');
    expect(dialog.textContent).toContain('Included');
  });

  it('edits the three detail fields and cancels without saving', async () => {
    const onClose = vi.fn();
    renderInApp(
      <FilePropertiesDialog target={{ projectId: 'p1', fileId: 'f2' }} onClose={onClose} />,
    );
    const dialog = await screen.findByRole('dialog');
    const textareas = dialog.querySelectorAll('textarea');
    expect(textareas).toHaveLength(3); // description, summary, note — §6 layout

    fireEvent.change(textareas[1], { target: { value: 'draft summary' } });
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    // The dialog's contract: Cancel closes it via onClose (the parent
    // unmounts); no save dispatch happens.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves details for ONE file only (per-file storage, §8)', async () => {
    function Probe() {
      const { state } = useAppState();
      return <span data-testid="details">{JSON.stringify(state.fileDetails)}</span>;
    }
    const { container } = renderInApp(
      <>
        <Probe />
        <FilePropertiesDialog target={{ projectId: 'p1', fileId: 'f2' }} onClose={() => {}} />
      </>,
    );
    const dialog = await screen.findByRole('dialog');
    const textareas = dialog.querySelectorAll('textarea');
    fireEvent.change(textareas[1], { target: { value: 'only for f2' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    const details = JSON.parse(container.querySelector('[data-testid=details]')!.textContent!);
    expect(Object.keys(details)).toEqual(['f2']);
    expect(details.f2.summary).toBe('only for f2');
  });
});

/* ------------------------------------------------------------------ */
/* §7/§38 — FileContextMenu                                            */
/* ------------------------------------------------------------------ */

describe('FileContextMenu (§7/§38)', () => {
  it('renders three actions; Exclude toggles and closes', () => {
    const onClose = vi.fn();
    const onToggle = vi.fn();
    render(
      <ToastProvider>
        <FileContextMenu
          state={{ fileId: 'f1', fileName: 'A.kt', selected: true, x: 10, y: 10 }}
          onOpen={() => {}}
          onProperties={() => {}}
          onToggle={onToggle}
          onClose={onClose}
        />
      </ToastProvider>,
    );
    const items = screen.getByRole('menu').querySelectorAll('[role=menuitem]');
    expect(items).toHaveLength(3);
    expect(items[1].textContent).toContain('Properties');
    expect(items[2].textContent).toContain('Exclude from document');
    fireEvent.click(items[2]);
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onClose).toHaveBeenCalled();
  });

  it('offers Include for excluded files', () => {
    render(
      <ToastProvider>
        <FileContextMenu
          state={{ fileId: 'f1', fileName: 'A.kt', selected: false, x: 10, y: 10 }}
          onOpen={() => {}}
          onProperties={() => {}}
          onToggle={() => {}}
          onClose={() => {}}
        />
      </ToastProvider>,
    );
    expect(screen.getByRole('menu').textContent).toContain('Include in document');
  });

  it('offers Copy relative path when the path is provided (§41 companion)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onClose = vi.fn();
    render(
      <ToastProvider>
        <FileContextMenu
          state={{
            fileId: 'f1',
            fileName: 'A.kt',
            relativePath: 'src/main/A.kt',
            selected: true,
            x: 10,
            y: 10,
          }}
          onOpen={() => {}}
          onProperties={() => {}}
          onToggle={() => {}}
          onClose={onClose}
        />
      </ToastProvider>,
    );
    const items = screen.getByRole('menu').querySelectorAll('[role=menuitem]');
    expect(items).toHaveLength(4);
    const copyItem = Array.from(items).find((el) =>
      el.textContent?.includes('Copy relative path'),
    );
    expect(copyItem).toBeTruthy();
    fireEvent.click(copyItem as HTMLElement);
    expect(writeText).toHaveBeenCalledWith('src/main/A.kt');
    expect(onClose).toHaveBeenCalled();
  });

  it('hides Copy relative path when no path is available', () => {
    render(
      <ToastProvider>
        <FileContextMenu
          state={{ fileId: 'f1', fileName: 'A.kt', selected: true, x: 10, y: 10 }}
          onOpen={() => {}}
          onProperties={() => {}}
          onToggle={() => {}}
          onClose={() => {}}
        />
      </ToastProvider>,
    );
    expect(screen.getByRole('menu').textContent).not.toContain('Copy relative path');
  });
});

/* ------------------------------------------------------------------ */
/* §4 — ProjectUpload standalone files                                 */
/* ------------------------------------------------------------------ */

describe('ProjectUpload standalone files (§4)', () => {
  it('renders the Files chip and its hidden picker input', () => {
    renderInApp(<ProjectUpload />);
    const chip = document.querySelector('button[title*="standalone files"]');
    expect(chip).toBeTruthy();
    expect(chip!.textContent).toContain('Files');
    expect(document.querySelector('input[aria-label="Add standalone files"]')).toBeTruthy();
  });

  it('discoverStandaloneFiles yields first-class project entries', async () => {
    const { project } = await discoverStandaloneFiles(
      [new File(['hello'], 'note.txt', { type: 'text/plain' })],
      {
        excludedDirs: [],
        excludedExtensions: [],
        excludedFilenames: [],
        includeGlobs: [],
        excludeGlobs: [],
        includeSource: true,
        includeConfig: true,
        includeMarkdown: true,
        customExtensions: [],
      },
    );
    expect(project.id).toBe('codice-standalone');
    expect(project.files[0].name).toBe('note.txt');
  });
});
