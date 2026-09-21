'use client';

/**
 * Document order panel (spec §13-§15).
 *
 * The sidebar's editing surface for the CANONICAL document presentation
 * order. Shows every selected file (grouped under its project) in the order
 * it will appear in the generated document, with:
 *   - drag-and-drop reordering (within the same project only, §15),
 *   - ↑/↓ keyboard-accessible move buttons (§41),
 *   - a per-project reset back to the default path order.
 *
 * This panel does NOT keep its own order state — it reads/writes the same
 * `fileOrder` slice the Outline pill and the preview/exporters consume
 * (§13/§14: one canonical ordering state).
 */

import { useMemo, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  GripVertical,
  RotateCcw,
} from '@/components/common/Icons';
import { effectiveFileOrder, moveFileInOrder } from '@/lib/documentOrder';

export function DocumentOrderPanel() {
  const { state, dispatch, getSelectedFiles } = useAppState();
  const [open, setOpen] = useState(false);
  const [dragFileId, setDragFileId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{
    projectId: string;
    fileId: string;
    below: boolean;
  } | null>(null);
  // §37 — per-project collapse, accordion-style like Template Settings.
  // `null` means “untouched”: the DEFAULT is derived — the first project is
  // expanded, the rest are collapsed when there are more than two projects,
  // and all are expanded otherwise. Once the user toggles, the explicit set
  // wins, so clicking an implicitly-collapsed project really expands it on
  // the first click. Collapse state is session-local and never touches
  // fileOrder.
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string> | null>(null);

  /** Selected files of every project in effective document order. */
  const groups = useMemo(
    () =>
      state.projects
        .map((project) => {
          const selected = getSelectedFiles(project.id);
          const ordered = effectiveFileOrder(project.files, state.fileOrder[project.id])
            .filter((f) => selected.has(f.id));
          return { project, files: ordered };
        })
        .filter((g) => g.files.length > 1),
    [state.projects, state.fileOrder, getSelectedFiles],
  );

  /** §37 — the effective collapsed set (derived default until touched). */
  const effectiveCollapsed = useMemo(() => {
    if (collapsedProjects) return collapsedProjects;
    if (groups.length > 2) {
      return new Set(groups.slice(1).map((g) => g.project.id));
    }
    return new Set<string>();
  }, [collapsedProjects, groups]);

  const toggleProject = (projectId: string) => {
    setCollapsedProjects(() => {
      const next = new Set(effectiveCollapsed);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const move = (projectId: string, fileId: string, delta: number) => {
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) return;
    const order = moveFileInOrder(
      state.fileOrder[projectId],
      project.files,
      fileId,
      delta,
    );
    dispatch({ type: 'SET_FILE_ORDER', projectId, order });
  };

  const dropOn = (targetFileId: string, below: boolean) => {
    if (!dragFileId || !dropHint) return;
    const projectId = dropHint.projectId;
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) return;
    const current = effectiveFileOrder(
      project.files,
      state.fileOrder[projectId],
    )
      .filter((f) => getSelectedFiles(projectId).has(f.id))
      .map((f) => f.id);
    const from = current.indexOf(dragFileId);
    let to = current.indexOf(targetFileId) + (below ? 1 : 0);
    if (from < 0 || to < 0) return;
    if (from < to) to -= 1;
    if (from === to) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    dispatch({ type: 'SET_FILE_ORDER', projectId, order: next });
    setDragFileId(null);
    setDropHint(null);
  };

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-app">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs text-secondary transition-colors hover:text-primary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="codice-document-order"
        title="Reorder files in the generated document"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="font-medium">Document order</span>
        <span className="badge ml-0.5">
          {groups.reduce((acc, g) => acc + g.files.length, 0)}
        </span>
        <span className="ml-auto text-[10px] text-muted">
          {open ? '' : 'reorderable'}
        </span>
      </button>
      {open && (
        <div
          id="codice-document-order"
          className="codice-fade-in max-h-56 space-y-2 overflow-y-auto px-2 pb-2"
        >
          {groups.map(({ project, files }) => {
            const isCollapsed = effectiveCollapsed.has(project.id);
            return (
            <div key={project.id}>
              <div className="flex items-center gap-1.5 px-1 py-0.5">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1 text-left"
                  onClick={() => toggleProject(project.id)}
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${project.label}`}
                  title={isCollapsed ? `Expand ${project.label}` : `Collapse ${project.label}`}
                >
                  {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                  <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {project.label}
                  </span>
                  <span
                    className="badge ml-0.5 flex-shrink-0"
                    title={`${files.length} files in ${project.label}`}
                  >
                    {files.length}
                  </span>
                </button>
                <button
                  type="button"
                  className="codice-bulk-btn"
                  title={`Reset ${project.label} to the default path order`}
                  aria-label={`Reset ${project.label} to the default path order`}
                  onClick={() =>
                    dispatch({ type: 'RESET_FILE_ORDER', projectId: project.id })
                  }
                >
                  <RotateCcw size={10} /> Reset
                </button>
              </div>
              {!isCollapsed && (
              <ol role="list" aria-label={`Document order of ${project.label}`}>
                {files.map((file, i) => {
                  const isDragging = dragFileId === file.id;
                  const hintAbove =
                    dropHint?.fileId === file.id && !dropHint.below;
                  const hintBelow =
                    dropHint?.fileId === file.id && dropHint.below;
                  return (
                    <li
                      key={file.id}
                      className={`group flex items-center gap-1 rounded px-1 py-0.5 ${
                        isDragging ? 'codice-row-dragging' : ''
                      } ${hintAbove ? 'codice-drop-above' : ''} ${
                        hintBelow ? 'codice-drop-below' : ''
                      }`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', file.id);
                        setDragFileId(file.id);
                      }}
                      onDragEnd={() => {
                        setDragFileId(null);
                        setDropHint(null);
                      }}
                      onDragOver={(e) => {
                        if (!dragFileId) return;
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        const below =
                          e.clientY > rect.top + rect.height / 2;
                        setDropHint((prev) =>
                          prev?.fileId === file.id && prev.below === below
                            ? prev
                            : { projectId: project.id, fileId: file.id, below },
                        );
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        dropOn(file.id, dropHint?.below ?? false);
                      }}
                    >
                      <span
                        className="codice-drag-handle flex-shrink-0"
                        title={`Drag to reorder ${file.name}`}
                        aria-hidden="true"
                      >
                        <GripVertical size={11} />
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-[11px] text-secondary"
                        title={file.relativePath}
                      >
                        {file.relativePath}
                      </span>
                      <button
                        type="button"
                        className="codice-bulk-btn"
                        onClick={() => move(project.id, file.id, -1)}
                        disabled={i === 0}
                        aria-label={`Move ${file.name} earlier in the document`}
                        title="Move earlier"
                      >
                        <ChevronUp size={10} />
                      </button>
                      <button
                        type="button"
                        className="codice-bulk-btn"
                        onClick={() => move(project.id, file.id, 1)}
                        disabled={i === files.length - 1}
                        aria-label={`Move ${file.name} later in the document`}
                        title="Move later"
                      >
                        <ChevronDown size={10} />
                      </button>
                    </li>
                  );
                })}
              </ol>
              )}
            </div>
            );
          })}
          <p className="px-1 text-[10px] text-muted">
            Drag or use ↑/↓ — the preview, Outline, and exports all follow
            this order. Files stay within their project.
          </p>
        </div>
      )}
    </div>
  );
}
