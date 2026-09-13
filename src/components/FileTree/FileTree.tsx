/**
 * File tree component.
 *
 * Renders a hierarchical tree of discovered files with checkboxes for
 * selection. Supports search, filtering by extension, and expand/collapse
 * per directory.
 */

import { useMemo, useState, useCallback } from 'react';
import type { DiscoveredFile, ProjectEntry } from '@/types';
import { useAppState } from '@/hooks/useAppState';
import { formatBytes } from '@/lib/fileDiscovery';
import { findDuplicateFileNames, duplicateContext, fileSelectionKey } from '@/lib/fileDuplicates';
import { filterVisibleFiles } from '@/lib/bulkSelection';
import { languageLabel } from '@/lib/languageDetection';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from '@/components/common/Icons';

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  file?: DiscoveredFile;
  children: Map<string, TreeNode>;
}

function buildTree(files: DiscoveredFile[]): TreeNode {
  const root: TreeNode = {
    name: '',
    path: '',
    isDir: true,
    children: new Map(),
  };
  for (const file of files) {
    const parts = file.relativePath.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/');
      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          path,
          isDir: !isLast,
          file: isLast ? file : undefined,
          children: new Map(),
        });
      }
      node = node.children.get(part)!;
    }
  }
  return root;
}

function sortTree(node: TreeNode) {
  const entries = Array.from(node.children.values());
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  node.children = new Map(entries.map((e) => [e.name, e]));
  for (const child of node.children.values()) {
    sortTree(child);
  }
}

interface FileTreeProps {
  project: ProjectEntry;
  searchQuery: string;
  extensionFilter: string;
  showExcluded: boolean;
}

export function FileTree({
  project,
  searchQuery,
  extensionFilter,
  showExcluded,
}: FileTreeProps) {
  const { state, dispatch, getSelectedFiles } = useAppState();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const selectedIds = getSelectedFiles(project.id);

  /** Filenames that occur more than once in this project — shown with path context. */
  const duplicateNames = useMemo(
    () => findDuplicateFileNames(project.files),
    [project.files],
  );

  const filteredFiles = useMemo(
    () =>
      filterVisibleFiles(project.files, {
        showExcluded,
        extensionFilter,
        searchQuery,
        inclusions: state.inclusions,
        projectId: project.id,
      }),
    [
      project.files,
      project.id,
      showExcluded,
      extensionFilter,
      searchQuery,
      state.inclusions,
    ],
  );

  const tree = useMemo(() => {
    const t = buildTree(filteredFiles);
    sortTree(t);
    return t;
  }, [filteredFiles]);

  const effectiveExpanded = useMemo(() => {
    if (searchQuery || extensionFilter) {
      const all = new Set<string>();
      const walk = (node: TreeNode) => {
        for (const child of node.children.values()) {
          if (child.isDir) {
            all.add(child.path);
            walk(child);
          }
        }
      };
      walk(tree);
      return new Set([...expanded, ...all]);
    }
    return expanded;
  }, [expanded, searchQuery, extensionFilter, tree]);

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const isFileSelected = useCallback(
    (file: DiscoveredFile): boolean => selectedIds.has(file.id),
    [selectedIds],
  );

  const toggleFile = useCallback(
    (file: DiscoveredFile, selected: boolean) => {
      dispatch({
        type: 'TOGGLE_FILE',
        projectId: project.id,
        fileId: file.id,
        selected,
      });
    },
    [dispatch, project.id],
  );

  const toggleDir = useCallback(
    (node: TreeNode, selected: boolean) => {
      const collect = (n: TreeNode, acc: string[]) => {
        for (const child of n.children.values()) {
          if (child.isDir) {
            collect(child, acc);
          } else if (child.file) {
            acc.push(child.file.id);
          }
        }
      };
      const ids: string[] = [];
      collect(node, ids);
      dispatch({
        type: 'TOGGLE_DIRECTORY',
        projectId: project.id,
        fileIds: ids,
        selected,
      });
    },
    [dispatch, project.id],
  );

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    if (node.isDir) {
      const isExpanded = effectiveExpanded.has(node.path) || depth === 0;
      const childArray = Array.from(node.children.values());
      if (depth === 0) {
        return (
          <div key={`root-${node.path}`}>
            {childArray.map((c) => renderNode(c, depth))}
          </div>
        );
      }
      let allSelected = true;
      let noneSelected = true;
      const visit = (n: TreeNode) => {
        for (const c of n.children.values()) {
          if (c.isDir) visit(c);
          else if (c.file) {
            const sel = isFileSelected(c.file);
            if (sel) noneSelected = false;
            else allSelected = false;
          }
        }
      };
      visit(node);
      const checked = allSelected && !noneSelected;
      const indeterminate = !allSelected && !noneSelected;
      return (
        <div key={`dir-${node.path}`}>
          <div
            className="group flex items-center gap-1 rounded px-1.5 py-0.5 cursor-pointer hover-surface"
            style={{ paddingLeft: depth * 12 + 6 }}
            onClick={() => toggleExpand(node.path)}
          >
            <span className="text-secondary">
              {isExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </span>
            <input
              type="checkbox"
              checked={checked}
              ref={(el) => {
                if (el) el.indeterminate = indeterminate;
              }}
              onChange={(e) => {
                e.stopPropagation();
                toggleDir(node, e.target.checked);
              }}
              onClick={(e) => e.stopPropagation()}
              className="h-3.5 w-3.5"
            />
            <span className="text-secondary">
              {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
            </span>
            <span className="text-sm text-primary font-medium">
              {node.name}
            </span>
            <span className="ml-auto pr-2 text-xs text-muted">
              {childArray.length}
            </span>
          </div>
          {isExpanded && (
            <div>
              {childArray.map((c) => renderNode(c, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    const file = node.file!;
    const isSelected = isFileSelected(file);
    const isExcluded =
      file.excluded && !state.inclusions[project.id]?.has(file.id);
    // Only duplicated filenames get path context — unique names stay clean.
    const needsContext = duplicateNames.has(file.name);

    return (
      <div
        key={`file-${fileSelectionKey(file)}`}
        className={`group flex items-start gap-1.5 rounded px-1.5 py-0.5 hover-surface ${
          isExcluded ? 'opacity-50' : ''
        }`}
        style={{ paddingLeft: depth * 12 + 22 }}
      >
        <input
          type="checkbox"
          className="mt-1 h-3.5 w-3.5"
          checked={isSelected}
          onChange={(e) => toggleFile(file, e.target.checked)}
          aria-label={`Select ${file.relativePath}`}
        />
        <span className="mt-0.5 text-secondary">
          <File size={13} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-primary" title={file.relativePath}>
            {file.name}
          </span>
          {needsContext && duplicateContext(file) && (
            <span
              className="block truncate text-[10px] text-muted"
              title={file.relativePath}
            >
              {duplicateContext(file)}
            </span>
          )}
        </span>
        {file.language && (
          <span className="mt-0.5 text-[10px] text-muted uppercase tracking-wide hidden md:inline">
            {languageLabel(file.language)}
          </span>
        )}
        <span className="mt-0.5 text-[10px] text-muted pr-2 tabular-nums">
          {formatBytes(file.size)}
        </span>
        {isExcluded && (
          <span className="mt-0.5 text-[10px] text-warning pr-2">
            {file.exclusionReason ?? 'excluded'}
          </span>
        )}
      </div>
    );
  };

  if (filteredFiles.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-sm text-muted">
        No files match the current filters.
      </div>
    );
  }

  return (
    <div className="py-1">
      {renderNode(tree, 0)}
    </div>
  );
}
