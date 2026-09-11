/**
 * Projects sidebar — lists added projects and lets the user select one to
 * view its file tree.
 */

import { useAppState } from '@/hooks/useAppState';
import { ProjectUpload } from '@/components/ProjectUpload';
import { FileTree } from '@/components/FileTree/FileTree';
import { formatBytes } from '@/lib/fileDiscovery';
import { useMemo, useState } from 'react';
import {
  Trash,
  Search,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronRight,
  FolderCog,
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

  const selectedProject = useMemo(
    () => state.projects.find((p) => p.id === selectedProjectId) ?? null,
    [state.projects, selectedProjectId],
  );

  // Compute available extensions across the selected project.
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

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#30363d] p-3">
        <ProjectUpload
          onProjectAdded={(id) => {
            onSelectProject(id);
            setExpandedProjects((prev) => new Set(prev).add(id));
          }}
        />
      </div>

      <div className="flex-1 overflow-auto">
        {state.projects.length === 0 ? (
          <div className="p-6 text-center text-sm text-[#6e7681]">
            No projects yet. Drop a folder above to get started.
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {state.projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
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
              />
            ))}
          </div>
        )}
      </div>

      {selectedProject && (
        <div className="border-t border-[#30363d]">
          <div className="space-y-2 p-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search
                  size={14}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-[#6e7681]"
                />
                <input
                  type="text"
                  className="input pl-7"
                  placeholder="Search files…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <select
                className="select w-24"
                value={extensionFilter}
                onChange={(e) => setExtensionFilter(e.target.value)}
                title="Filter by extension"
              >
                <option value="">All</option>
                {extensions.map((ext) => (
                  <option key={ext} value={ext}>
                    {ext}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs text-[#7d8590] cursor-pointer">
              <input
                type="checkbox"
                checked={showExcluded}
                onChange={(e) => setShowExcluded(e.target.checked)}
                className="h-3.5 w-3.5 accent-brand-500"
              />
              Show excluded files
            </label>
            <div className="text-xs text-[#6e7681]">
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
          <div className="max-h-96 overflow-auto border-t border-[#30363d]">
            <FileTree
              project={selectedProject}
              searchQuery={searchQuery}
              extensionFilter={extensionFilter}
              showExcluded={showExcluded}
            />
          </div>
          {selectedProject.warnings.length > 0 && (
            <div className="border-t border-[#30363d] p-2 space-y-1 max-h-32 overflow-auto">
              {selectedProject.warnings.slice(0, 5).map((w, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-1.5 text-xs ${
                    w.severity === 'warn'
                      ? 'text-[#d29922]'
                      : w.severity === 'error'
                        ? 'text-[#f85149]'
                        : 'text-[#7d8590]'
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
                <div className="text-xs text-[#6e7681]">
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
  isExpanded,
  onToggleExpand,
  isSelected,
  onSelect,
  onRemove,
  selectedCount,
}: {
  project: ProjectEntry;
  isExpanded: boolean;
  onToggleExpand: () => void;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  selectedCount: number;
}) {
  const { dispatch } = useAppState();
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(project.label);

  return (
    <div
      className={`rounded-md border transition-colors ${
        isSelected
          ? 'border-brand-500/50 bg-brand-500/5'
          : 'border-transparent hover:border-[#30363d]'
      }`}
    >
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer"
        onClick={() => {
          onSelect();
          if (!isExpanded) onToggleExpand();
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          className="text-[#7d8590] hover:text-[#e6edf3]"
        >
          {isExpanded ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
        </button>
        <span className="text-[#7d8590]">
          <FolderCog size={14} />
        </span>
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
            className="flex-1 truncate text-sm text-[#e6edf3] font-medium"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
            title={project.label}
          >
            {project.label}
          </span>
        )}
        <span className="badge bg-[#21262d] text-[#7d8590]">
          {selectedCount}/{project.files.length}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="text-[#7d8590] hover:text-[#f85149]"
          title="Remove project"
        >
          <Trash size={14} />
        </button>
      </div>
    </div>
  );
}
