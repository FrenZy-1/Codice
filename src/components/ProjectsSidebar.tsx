/**
 * Projects sidebar — lists added projects and lets the user select one to
 * view its file tree.
 */

import { useAppState } from '@/hooks/useAppState';
import { ProjectUpload } from '@/components/ProjectUpload';
import { FileTree } from '@/components/FileTree/FileTree';
import { DocumentOrderPanel } from '@/components/FileProperties/DocumentOrderPanel';
import { SelectionRulesPanel } from '@/components/common/SelectionRulesPanel';
import { MergeProjectsDialog } from '@/components/Merge/MergeProjectsDialog';
import { formatBytes } from '@/lib/fileDiscovery';
import { dominantLanguage, languageHueColor } from '@/lib/documentStats';
import { languageFilterOptions } from '@/lib/languageDetection';
import {
  filterVisibleFiles,
  visibleIdsFor,
  computeBulkSelection,
  totalSizeForIds,
} from '@/lib/bulkSelection';
import { useMemo, useRef, useState } from 'react';
import {
  Trash,
  Search,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronRight,
  FolderCog,
  GripVertical,
  CheckSquare,
  Square,
  FlipHorizontal2,
  Merge,
  Split,
  ImagePlus,
  Pencil,
} from '@/components/common/Icons';
import type { ProjectEntry, ImageAsset } from '@/types';

interface Props {
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
}

/** §44 — computed ONCE from the central language mapping (module scope). */
const LANGUAGE_FILTER_OPTIONS = languageFilterOptions();

export function ProjectsSidebar({ selectedProjectId, onSelectProject }: Props) {
  const { state, dispatch, getSelectedFiles } = useAppState();
  const [searchQuery, setSearchQuery] = useState('');
  // §44 — the file-type filter is LANGUAGE-based, derived from the central
  // languageDetection mapping (C, C++, C#, Kotlin, Java, Python, … — every
  // language the mapping knows is offered automatically).
  const [languageFilter, setLanguageFilter] = useState('');
  const [showExcluded, setShowExcluded] = useState(false);
  // §11 — project merge flow (explicit, undoable via Unmerge).
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);

  // ---- Drag-to-reorder (projects order = document section order) ----
  const dragIndex = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropHint, setDropHint] = useState<{
    index: number;
    below: boolean;
  } | null>(null);
  const canReorder = state.projects.length > 1;

  const selectedProject = useMemo(
    () => state.projects.find((p) => p.id === selectedProjectId) ?? null,
    [state.projects, selectedProjectId],
  );

  // ---- Bulk selection (All / None / Invert over the FILTERED view) ----
  const visibleFiles = useMemo(
    () =>
      selectedProject
        ? filterVisibleFiles(selectedProject.files, {
            showExcluded,
            languageFilter,
            searchQuery,
            inclusions: state.inclusions,
            projectId: selectedProject.id,
          })
        : [],
    [
      selectedProject,
      showExcluded,
      languageFilter,
      searchQuery,
      state.inclusions,
    ],
  );

  const runBulkAction = (mode: 'all' | 'none' | 'invert') => {
    if (!selectedProject) return;
    const selectedIds = getSelectedFiles(selectedProject.id);
    const { selectIds, deselectIds } = computeBulkSelection(
      mode,
      visibleIdsFor(visibleFiles),
      (id) => selectedIds.has(id),
    );
    if (selectIds.length > 0) {
      dispatch({
        type: 'TOGGLE_DIRECTORY',
        projectId: selectedProject.id,
        fileIds: selectIds,
        selected: true,
      });
    }
    if (deselectIds.length > 0) {
      dispatch({
        type: 'TOGGLE_DIRECTORY',
        projectId: selectedProject.id,
        fileIds: deselectIds,
        selected: false,
      });
    }
  };

  // Selection summary for the progress bar
  const selectionSummary = useMemo(() => {
    if (!selectedProject) return null;
    const ids = getSelectedFiles(selectedProject.id);
    const total = selectedProject.files.length;
    const selected = ids.size;
    return {
      selected,
      total,
      pct: total === 0 ? 0 : Math.round((selected / total) * 100),
      size: totalSizeForIds(selectedProject.files, ids),
    };
  }, [selectedProject, getSelectedFiles]);

  const moveProject = (from: number, to: number) => {
    if (from === to || to < 0 || to >= state.projects.length) return;
    dispatch({ type: 'REORDER_PROJECTS', from, to });
  };

  const handleRowDragOver = (e: React.DragEvent, index: number) => {
    if (dragIndex.current === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const below = e.clientY > rect.top + rect.height / 2;
    setDropHint((prev) =>
      prev && prev.index === index && prev.below === below
        ? prev
        : { index, below },
    );
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragIndex.current;
    const hint = dropHint;
    clearDragState();
    if (from === null || !hint) return;
    let to = hint.below ? hint.index + 1 : hint.index;
    if (from < to) to -= 1;
    moveProject(from, to);
  };

  const clearDragState = () => {
    dragIndex.current = null;
    setDraggingIndex(null);
    setDropHint(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`flex-shrink-0 border-b border-app ${state.projects.length > 0 ? 'p-2' : 'p-3'}`}>
        <ProjectUpload
          onProjectAdded={(id) => {
            onSelectProject(id);
          }}
        />
      </div>

      {/* Project list — bounded so the file tree always keeps its scroll
          region; it becomes the flexible area only when no tools are shown. */}
      <div
        className={
          selectedProject
            ? 'max-h-44 flex-shrink-0 overflow-auto'
            : 'min-h-[96px] min-h-0 flex-1 overflow-auto'
        }
      >
        {state.projects.length === 0 ? (
          <div className="codice-empty m-3">
            <FolderCog size={22} className="mx-auto text-muted" />
            <div className="mt-2 text-sm text-secondary">No projects yet</div>
            <div className="mt-0.5 text-xs text-muted">
              Drop a folder above — or press <kbd className="kbd">?</kbd> for
              keyboard shortcuts.
            </div>
          </div>
        ) : (
          <div
            className="space-y-1 p-2"
            onDragOver={(e) => {
              // Dropping in the gaps between rows still resolves to a row.
              if (dragIndex.current !== null) e.preventDefault();
            }}
            onDrop={handleDrop}
          >
            {state.projects.map((project, index) => {
              const showAbove =
                dropHint !== null &&
                dropHint.index === index &&
                !dropHint.below;
              const showBelow =
                dropHint !== null &&
                dropHint.index === index &&
                dropHint.below;
              return (
                <ProjectRow
                  key={project.id}
                  project={project}
                  index={index}
                  canReorder={canReorder}
                  isDragging={draggingIndex === index}
                  dropIndicator={
                    showAbove ? 'above' : showBelow ? 'below' : null
                  }
                  onDragStart={() => {
                    dragIndex.current = index;
                    setDraggingIndex(index);
                  }}
                  onDragEnd={clearDragState}
                  onDragOverRow={(e) => handleRowDragOver(e, index)}
                  onMoveRelative={(delta) => moveProject(index, index + delta)}
                  isSelected={selectedProjectId === project.id}
                  onSelect={() => onSelectProject(project.id)}
                  onRemove={() => {
                    dispatch({ type: 'REMOVE_PROJECT', projectId: project.id });
                    if (selectedProjectId === project.id) {
                      onSelectProject('');
                    }
                  }}
                  onMerge={() => setMergeTargetId(project.id)}
                  isMerged={Boolean(state.mergeSources[project.id])}
                  onUnmerge={() => dispatch({ type: 'UNMERGE_PROJECTS', mergedId: project.id })}
                  selectedCount={getSelectedFiles(project.id).size}
                  selectedIds={getSelectedFiles(project.id)}
                />
              );
            })}
            {canReorder && (
              <div className="px-1 pt-0.5 text-center text-[10px] text-muted">
                Drag ⋮ to reorder — document sections follow this order
              </div>
            )}
          </div>
        )}
      </div>

      {/* §32 — the image library is a first-class sidebar citizen (above the
          Document order editor): uploaded images are DISCOVERABLE here
          (thumbnail, name, caption) and attachable from File properties /
          layout image fields. One storage system — the sidebar renders the
          same imageAssets slice the preview and exporters read. */}
      <ImageLibraryPanel />

      {/* §13 — canonical document order editor (shared with the Outline). */}
      <DocumentOrderPanel />

      {/* §11 — explicit, undoable project merge. */}
      {mergeTargetId && (
        <MergeProjectsDialog
          projectId={mergeTargetId}
          onClose={() => setMergeTargetId(null)}
        />
      )}

      {/* Stats moved to the preview pane's Statistics pill (spec §16). */}

      {selectedProject && (
        <div className="flex min-h-0 flex-1 flex-col border-t border-app">
          <div className="min-h-0 flex-shrink space-y-2 overflow-y-auto p-3">
            <div className="flex items-center gap-2">
              {/* spec §9 — the extension select is pinned to a fixed width so
                  the search input keeps a sensible, clickable text-field
                  width (.select's width:100% fills this wrapper instead of
                  fighting flex-1 for the whole row). */}
              <div className="w-28 flex-shrink-0">
                <select
                  className="select"
                  value={languageFilter}
                  onChange={(e) => setLanguageFilter(e.target.value)}
                  title="Filter by file type (all supported languages)"
                  aria-label="Filter by file type"
                >
                  <option value="">All types</option>
                  {LANGUAGE_FILTER_OPTIONS.map((lang) => (
                    <option key={lang.id} value={lang.id}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="relative min-w-0 flex-1">
                <Search
                  size={14}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  id="codice-file-search"
                  type="text"
                  className="input pl-7"
                  placeholder="Search files…  (Ctrl+K)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={showExcluded}
                onChange={(e) => setShowExcluded(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Show excluded files
            </label>
            <SelectionRulesPanel project={selectedProject} />
            {visibleFiles.length > 0 && (
              <div
                className="flex items-center gap-1"
                role="group"
                aria-label="Bulk selection actions for visible files"
              >
                <button
                  type="button"
                  className="codice-bulk-btn"
                  title="Select every file matching the current search/filter"
                  onClick={() => runBulkAction('all')}
                >
                  <CheckSquare size={11} /> All
                </button>
                <button
                  type="button"
                  className="codice-bulk-btn"
                  title="Deselect every file matching the current search/filter"
                  onClick={() => runBulkAction('none')}
                >
                  <Square size={11} /> None
                </button>
                <button
                  type="button"
                  className="codice-bulk-btn"
                  title="Flip selection for every file matching the current search/filter"
                  onClick={() => runBulkAction('invert')}
                >
                  <FlipHorizontal2 size={11} /> Invert
                </button>
                <span className="ml-auto text-[10px] text-muted">
                  {visibleFiles.length} shown
                </span>
              </div>
            )}
            {selectionSummary && (
              <div className="space-y-1">
                <div
                  className="h-1 w-full overflow-hidden rounded-full"
                  style={{ background: 'var(--color-border, #e5e7eb)' }}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={selectionSummary.pct}
                  aria-label="Selection coverage"
                  title={`${selectionSummary.selected} of ${selectionSummary.total} files selected`}
                >
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${selectionSummary.pct}%`,
                      background: 'var(--color-accent)',
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted tabular-nums">
                  <span>
                    {selectionSummary.selected}/{selectionSummary.total} files
                  </span>
                  <span>{Math.round(selectionSummary.size / 102.4) / 10} KB</span>
                </div>
              </div>
            )}
            <div className="text-xs text-muted">
              {getSelectedFiles(selectedProject.id).size} selected of{' '}
              {selectedProject.files.length} files ·{' '}
              {formatBytes(
                Array.from(getSelectedFiles(selectedProject.id)).reduce(
                  (acc, id) => {
                    const f = selectedProject.files.find((f) => f.id === id);
                    return acc + (f?.size ?? 0);
                  },
                  0,
                ),
              )}
            </div>
          </div>
          {/* THE file-list scroll region — flexes to the remaining sidebar
              height (min 10rem) and never slides underneath the footer (§14). */}
          <div className="min-h-40 flex-1 overflow-auto border-t border-app">
            <FileTree
              project={selectedProject}
              searchQuery={searchQuery}
              languageFilter={languageFilter}
              showExcluded={showExcluded}
            />
          </div>
          {selectedProject.warnings.length > 0 && (
            <div className="max-h-28 flex-shrink-0 space-y-1 overflow-auto border-t border-app p-2">
              {selectedProject.warnings.slice(0, 5).map((w, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-1.5 text-xs ${
                    w.severity === 'warn'
                      ? 'text-warning'
                      : w.severity === 'error'
                        ? 'text-error'
                        : 'text-secondary'
                  }`}
                >
                  {w.severity === 'warn' ? (
                    <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                  ) : (
                    <Info size={12} className="mt-0.5 flex-shrink-0" />
                  )}
                  <span>{w.message}</span>
                </div>
              ))}
              {selectedProject.warnings.length > 5 && (
                <div className="text-xs text-muted">
                  … and {selectedProject.warnings.length - 5} more
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectRow({
  project,
  index,
  canReorder,
  isDragging,
  dropIndicator,
  onDragStart,
  onDragEnd,
  onDragOverRow,
  onMoveRelative,
  isSelected,
  onSelect,
  onRemove,
  onMerge,
  isMerged,
  onUnmerge,
  selectedCount,
  selectedIds,
}: {
  project: ProjectEntry;
  index: number;
  canReorder: boolean;
  isDragging: boolean;
  dropIndicator: 'above' | 'below' | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverRow: (e: React.DragEvent) => void;
  /** Move this row by a relative offset (keyboard reordering). */
  onMoveRelative: (delta: number) => void;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  /** §11 — open the merge dialog with this project as the source. */
  onMerge: () => void;
  /** §11 — this project is the result of a merge (undoable). */
  isMerged: boolean;
  onUnmerge: () => void;
  selectedCount: number;
  selectedIds: Set<string>;
}) {
  const { state, dispatch } = useAppState();
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(project.label);
  const [dragArmed, setDragArmed] = useState(false);

  // R11 — the handle now serves TWO purposes: sidebar reordering (needs
  // ≥2 projects) and drag-to-assign onto export-group rows (needs at
  // least one group scaffold — the drop targets). Keep the handle hidden
  // only when NEITHER is possible (no nonfunctional controls, §38).
  const canAssignToGroups = state.exportGroups.length > 0;

  // Dominant language dot + total selected size — cheap metadata only.
  const domLang = useMemo(
    () => dominantLanguage(project, selectedIds),
    [project, selectedIds],
  );
  const selectedSize = useMemo(() => {
    let total = 0;
    for (const file of project.files) {
      if (selectedIds.has(file.id)) total += file.size;
    }
    return total;
  }, [project, selectedIds]);

  const rowClasses = [
    'group relative overflow-hidden rounded-md border transition-all duration-150',
    isSelected
      ? 'border-[var(--color-accent)]'
      : 'border-transparent hover:border-app',
    isDragging ? 'codice-row-dragging' : '',
    dropIndicator === 'above' ? 'codice-drop-above' : '',
    dropIndicator === 'below' ? 'codice-drop-below' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={rowClasses}
      style={
        isSelected
          ? { background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)' }
          : undefined
      }
      draggable={dragArmed}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        // R11 — carry the project identity so EXPORT-GROUP rows (Export
        // panel) can accept this drag as an ASSIGNMENT (§EXPORT-004 DnD):
        // dropping a sidebar project onto a group appends it. The sidebar's
        // own drop logic ignores foreign payloads (dragIndex guard), so
        // both behaviors coexist on the same drag gesture.
        e.dataTransfer.setData('application/x-codice-project', project.id);
        window.dispatchEvent(new CustomEvent('codice-project-drag-start'));
        onDragStart();
      }}
      onDragEnd={() => {
        window.dispatchEvent(new CustomEvent('codice-project-drag-end'));
        onDragEnd();
      }}
      onDragOver={onDragOverRow}
    >
      {/* Selected accent bar */}
      <div
        aria-hidden="true"
        className={`absolute left-0 top-0 h-full w-[3px] bg-[var(--color-accent)] transition-opacity duration-150 ${
          isSelected ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover-surface active:scale-[0.995] transition-transform"
        onClick={() => {
          onSelect();
        }}
      >
        {(canReorder || canAssignToGroups) && (
          <button
            type="button"
            className="codice-drag-handle flex-shrink-0"
            title={
              canReorder
                ? `Drag to reorder${canAssignToGroups ? ' — or onto an export group to assign' : ''} — or focus and press ↑/↓ (position ${index + 1})`
                : `Drag onto an export group to assign (position ${index + 1})`
            }
            aria-label={
              canReorder
                ? `Reorder project ${project.label}. Currently position ${index + 1}. Press ArrowUp or ArrowDown to move.${canAssignToGroups ? ' Or drag onto an export group in the export panel to assign it.' : ''}`
                : `Drag project ${project.label} onto an export group in the export panel to assign it.`
            }
            onMouseDown={() => setDragArmed(true)}
            onMouseUp={() => setDragArmed(false)}
            onBlur={() => setDragArmed(false)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                onMoveRelative(-1);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                onMoveRelative(1);
              }
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={13} />
          </button>
        )}
        {/* §38 — no chevron here: the file tree below shows the SELECTED
            project, so a per-row expander had nothing to gate. Clicking the
            row selects the project; that is the only behavior. */}
        <span className="text-secondary">
          <FolderCog size={14} />
        </span>
        {domLang && (
          <span
            aria-hidden="true"
            className="h-2 w-2 flex-shrink-0 rounded-full"
            style={{ background: languageHueColor(domLang) }}
            title={`Mostly ${domLang}`}
          />
        )}
        {isEditing ? (
          <input
            type="text"
            className="input flex-1 py-0.5 text-sm"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => {
              dispatch({
                type: 'RENAME_PROJECT',
                projectId: project.id,
                label: label || project.folderName,
              });
              setIsEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                dispatch({
                  type: 'RENAME_PROJECT',
                  projectId: project.id,
                  label: label || project.folderName,
                });
                setIsEditing(false);
              }
              if (e.key === 'Escape') {
                setLabel(project.label);
                setIsEditing(false);
              }
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="flex-1 truncate text-sm text-primary font-medium"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
            title={project.label}
          >
            {project.label}
          </span>
        )}
        <span className="badge">{selectedCount}/{project.files.length}</span>
        <span
          className="w-12 flex-shrink-0 text-right text-[10px] tabular-nums text-muted"
          title="Total size of selected files"
        >
          {formatBytes(selectedSize)}
        </span>
        {isMerged ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUnmerge();
            }}
            className="text-secondary hover:text-primary"
            title={`Unmerge ${project.label} — restore the original projects`}
            aria-label={`Unmerge ${project.label}`}
          >
            <Split size={14} />
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMerge();
            }}
            className="text-secondary hover:text-primary"
            title={`Merge other projects into ${project.label}`}
            aria-label={`Merge projects into ${project.label}`}
          >
            <Merge size={14} />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="text-secondary hover:text-error"
          title={`Remove project ${project.label}`}
          aria-label={`Remove project ${project.label}`}
        >
          <Trash size={14} />
        </button>
      </div>
    </div>
  );
}

/**
 * §32 — Image library panel. Uploaded images appear alongside the usable
 * content in the sidebar (never a disconnected second storage): each asset
 * shows its thumbnail, name and caption (caption editable inline →
 * UPDATE_IMAGE_ASSET); removing an asset here removes it from the SAME
 * registry the preview and exporters read. Empty library → discoverability
 * hint instead of a hidden subsystem.
 */
function ImageLibraryPanel() {
  const { state } = useAppState();
  // §32 — expanded by default while images exist; collapsible via the
  // chevron when the sidebar space is needed.
  const [open, setOpen] = useState(true);
  const assets = state.imageAssets;

  if (assets.length === 0) {
    return (
      <div
        className="flex items-center gap-1.5 border-t border-app px-3 py-1.5 text-[10px] text-muted"
        title="Images uploaded with the Images button are collected here — attach them in File properties or a layout Image node"
        data-tour="images"
      >
        <ImagePlus size={11} className="flex-shrink-0" />
        <span>
          No images yet — upload via the Images button in the upload area.
          Uploaded images stay in your browser across sessions (up to 40).
        </span>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 border-t border-app">
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-1.5 px-3 py-2 text-xs text-secondary transition-colors hover:text-primary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="codice-image-library"
        title="Images uploaded to the library — attach them in File properties or a layout image field"
        data-tour="images"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="font-medium">Image library</span>
        <span className="badge ml-0.5">{assets.length}</span>
        <span className="ml-auto text-[10px] text-muted">
          {open ? '' : 'attachable'}
        </span>
      </button>
      {open && (
        <div
          id="codice-image-library"
          className="codice-fade-in max-h-44 space-y-1 overflow-y-auto px-2 pb-2"
        >
          {assets.map((asset: ImageAsset) => (
            <ImageLibraryRow key={asset.id} asset={asset} />
          ))}
          <p className="px-1 pt-1 text-[10px] text-muted">
            Attach to a file in File properties, or pick a library image from a
            layout Image node — captions render below the image everywhere.
          </p>
        </div>
      )}
    </div>
  );
}

/** One library row: thumbnail + name/caption + inline caption edit + remove. */
function ImageLibraryRow({ asset }: { asset: ImageAsset }) {
  const { dispatch } = useAppState();
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(asset.caption ?? '');

  const commitCaption = () => {
    setEditing(false);
    if ((asset.caption ?? '') !== caption) {
      dispatch({ type: 'UPDATE_IMAGE_ASSET', id: asset.id, caption });
    }
  };

  return (
    <div className="group rounded px-1 py-1 hover:bg-app">
      <div className="flex items-center gap-2">
        <img
          src={asset.dataUrl}
          alt={asset.name}
          className="h-10 w-10 flex-shrink-0 rounded border border-app object-cover"
          title={`${asset.name}${
            asset.caption ? ` — ${asset.caption}` : ''
          } — ${asset.width}×${asset.height}px`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] text-secondary" title={asset.name}>
            {asset.name}
          </span>
          <span
            className="block truncate text-[9px] text-muted"
            title={asset.caption ? `Caption: ${asset.caption}` : 'No caption set'}
          >
            {asset.caption
              ? asset.caption
              : `${asset.width}×${asset.height}px · ${formatBytes(asset.sizeBytes ?? 0)}`}
          </span>
        </span>
        <button
          type="button"
          className="text-muted opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
          title={`Edit the caption of ${asset.name}`}
          aria-label={`Edit the caption of ${asset.name}`}
          onClick={() => {
            setCaption(asset.caption ?? '');
            setEditing((v) => !v);
          }}
        >
          <Pencil size={11} />
        </button>
        <button
          type="button"
          className="text-muted opacity-0 transition-opacity hover:text-error focus-visible:opacity-100 group-hover:opacity-100"
          title={`Remove ${asset.name} from the library`}
          aria-label={`Remove ${asset.name} from the library`}
          onClick={() => dispatch({ type: 'REMOVE_IMAGE_ASSET', id: asset.id })}
        >
          <Trash size={11} />
        </button>
      </div>
      {editing && (
        <div className="mt-1 pl-12">
          <input
            type="text"
            className="input py-0.5 text-[11px]"
            value={caption}
            placeholder="Caption shown below the image…"
            aria-label={`Caption for ${asset.name}`}
            autoFocus
            onChange={(e) => setCaption(e.target.value)}
            onBlur={commitCaption}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCaption();
              if (e.key === 'Escape') {
                setCaption(asset.caption ?? '');
                setEditing(false);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
