/**
 * File tree component.
 *
 * Renders a hierarchical, virtualized-friendly tree of discovered files with
 * checkboxes for selection. Supports search, filtering by extension, and
 * expand/collapse per directory.
 */

import { useMemo, useState, useCallback } from 'react';
import type { DiscoveredFile, ProjectEntry } from '@/types';
import { useAppState } from '@/hooks/useAppState';
import { formatBytes } from '@/lib/fileDiscovery';
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
  /** Filter by search query (matches path). */
  searchQuery: string;
  /** Filter by extension (e.g. ".ts"). Empty string = no filter. */
  extensionFilter: string;
  /** Whether to show excluded files in the tree. */
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

  const filteredFiles = useMemo(() => {
    let files = project.files;
    if (!showExcluded) {
      files = files.filter(
        (f) => !f.excluded || state.inclusions[project.id]?.has(f.id),
      );
    }
    if (extensionFilter) {
      const ext = extensionFilter.toLowerCase();
      files = files.filter((f) => {
        const dot = f.name.lastIndexOf('.');
        const fext = dot >= 0 ? f.name.slice(dot).toLowerCase() : '';
        return fext === ext;
      });
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      files = files.filter((f) => f.relativePath.toLowerCase().includes(q));
    }
    return files;
  }, [
    project.files,
    project.id,
    showExcluded,
    extensionFilter,
    searchQuery,
    state.inclusions,
  ]);

  const tree = useMemo(() => {
    const t = buildTree(filteredFiles);
    sortTree(t);
    return t;
  }, [filteredFiles]);

  // Auto-expand directories that match the search query.
  const effectiveExpanded = useMemo(() => {
    if (searchQuery || extensionFilter) {
      // Expand everything when filtering.
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
    (file: DiscoveredFile): boolean => {
      return selectedIds.has(file.id);
    },
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
      // For the root, render children directly without a row.
      if (depth === 0) {
        return (
          <div key={`root-${node.path}`}>
            {childArray.map((c) => renderNode(c, depth))}
          </div>
        );
      }
      // Determine directory selection state.
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
            className="group flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-[#21262d] cursor-pointer"
            style={{ paddingLeft: depth * 12 + 6 }}
            onClick={() => toggleExpand(node.path)}
          >
            <span className="text-[#7d8590]">
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
              className="h-3.5 w-3.5 accent-brand-500"
            />
            <span className="text-[#7d8590]">
              {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
            </span>
            <span className="text-sm text-[#e6edf3] font-medium">
              {node.name}
            </span>
            <span className="ml-auto pr-2 text-xs text-[#6e7681]">
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

    // File node
    const file = node.file!;
    const isSelected = isFileSelected(file);
    const isExcluded =
      file.excluded && !state.inclusions[project.id]?.has(file.id);

    return (
      <div
        key={`file-${file.id}`}
        className={`group flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-[#21262d] ${
          isExcluded ? 'opacity-50' : ''
        }`}
        style={{ paddingLeft: depth * 12 + 22 }}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => toggleFile(file, e.target.checked)}
          className="h-3.5 w-3.5 accent-brand-500"
        />
        <span className="text-[#7d8590]">
          <File size={13} />
        </span>
        <span className="text-sm text-[#e6edf3] truncate flex-1" title={file.name}>
          {file.name}
        </span>
        {file.language && (
          <span className="text-[10px] text-[#6e7681] uppercase tracking-wide hidden md:inline">
            {languageLabel(file.language)}
          </span>
        )}
        <span className="text-[10px] text-[#6e7681] pr-2 tabular-nums">
          {formatBytes(file.size)}
        </span>
        {isExcluded && (
          <span className="text-[10px] text-[#d29922] pr-2">
            {file.exclusionReason ?? 'excluded'}
          </span>
        )}
      </div>
    );
  };

  if (filteredFiles.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-sm text-[#6e7681]">
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
