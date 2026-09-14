/**
 * Projects sidebar — lists added projects and lets the user select one to
 * view its file tree.
 */

import { useAppState } from '@/hooks/useAppState';
import { ProjectUpload } from '@/components/ProjectUpload';
import { FileTree } from '@/components/FileTree/FileTree';
import { SelectionRulesPanel } from '@/components/common/SelectionRulesPanel';
import { formatBytes } from '@/lib/fileDiscovery';
import { dominantLanguage, languageHueColor } from '@/lib/documentStats';
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
} from '@/components/common/Icons';
import type { ProjectEntry } from '@/types';

interface Props {
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
}

export function ProjectsSidebar({ selectedProjectId, onSelectProject }: Props) {
  const { state, dispatch, getSelectedFiles } = useAppState();
  const [searchQuery, setSearchQuery] = useState('');
  const [extensionFilter, setExtensionFilter] = useState('');
  const [showExcluded, setShowExcluded] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set(),
  );

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
            extensionFilter,
            searchQuery,
            inclusions: state.inclusions,
            projectId: selectedProject.id,
          })
        : [],
    [
      selectedProject,
      showExcluded,
      extensionFilter,
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

  const extensions = useMemo(() => {
    if (!selectedProject) return [];
    const set = new Set<string>();
    for (const f of selectedProject.files) {
      const dot = f.name.lastIndexOf('.');
      if (dot >= 0) set.add(f.name.slice(dot).toLowerCase());
    }
    return Array.from(set).sort();
  }, [selectedProject]);

  const toggleProjectExpand = (id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
            setExpandedProjects((prev) => new Set(prev).add(id));
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
                  isExpanded={expandedProjects.has(project.id)}
                  onToggleExpand={() => toggleProjectExpand(project.id)}
                  isSelected={selectedProjectId === project.id}
                  onSelect={() => {
                    onSelectProject(project.id);
                    if (!expandedProjects.has(project.id)) {
                      toggleProjectExpand(project.id);
                    }
                  }}
                  onRemove={() => {
                    dispatch({ type: 'REMOVE_PROJECT', projectId: project.id });
                    if (selectedProjectId === project.id) {
                      onSelectProject('');
                    }
                  }}
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

      {/* Stats moved to the preview pane's Statistics pill (spec §16). */}

      {selectedProject && (
        <div className="flex min-h-0 flex-1 flex-col border-t border-app">
          <div className="min-h-0 flex-shrink space-y-2 overflow-y-auto p-3">
            <div className="flex items-center gap-2">
              {/* spec §9 — the extension select is pinned to a fixed width so
                  the search input keeps a sensible, clickable text-field
                  width (.select's width:100% fills this wrapper instead of
                  fighting flex-1 for the whole row). */}
              <div className="w-24 flex-shrink-0">
                <select
                  className="select"
                  value={extensionFilter}
                  onChange={(e) => setExtensionFilter(e.target.value)}
                  title="Filter by extension"
                  aria-label="Filter by extension"
                >
                  <option value="">All</option>
                  {extensions.map((ext) => (
                    <option key={ext} value={ext}>
                      {ext}
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
              extensionFilter={extensionFilter}
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
  isExpanded,
  onToggleExpand,
  isSelected,
  onSelect,
  onRemove,
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
  isExpanded: boolean;
  onToggleExpand: () => void;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  selectedCount: number;
  selectedIds: Set<string>;
}) {
  const { dispatch } = useAppState();
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(project.label);
  const [dragArmed, setDragArmed] = useState(false);

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
      draggable={canReorder && dragArmed}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        onDragStart();
      }}
      onDragEnd={onDragEnd}
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
          if (!isExpanded) onToggleExpand();
        }}
      >
        {canReorder && (
          <button
            type="button"
            className="codice-drag-handle flex-shrink-0"
            title={`Drag to reorder — or focus and press ↑/↓ (position ${index + 1})`}
            aria-label={`Reorder project ${project.label}. Currently position ${index + 1}. Press ArrowUp or ArrowDown to move.`}
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
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          className="text-secondary hover:text-primary"
        >
          {isExpanded ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
        </button>
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
