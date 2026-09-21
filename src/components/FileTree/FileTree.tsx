/**
 * File tree component.
 *
 * Renders a hierarchical tree of discovered files with checkboxes for
 * selection. Supports search, filtering by extension, and expand/collapse
 * per directory.
 */

import { Fragment, useMemo, useState, useCallback } from 'react';
import type { DiscoveredFile, ProjectEntry } from '@/types';
import { useAppState } from '@/hooks/useAppState';
import { formatBytes } from '@/lib/fileDiscovery';
import { findDuplicateFileNames, duplicateContext, fileSelectionKey } from '@/lib/fileDuplicates';
import { filterVisibleFiles } from '@/lib/bulkSelection';
import { languageLabel } from '@/lib/languageDetection';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, MoreVertical, Image as ImageIcon } from '@/components/common/Icons';
import {
  FileContextMenu,
  type FileContextMenuState,
} from '@/components/FileProperties/FileContextMenu';
import { FilePropertiesDialog } from '@/components/FileProperties/FilePropertiesDialog';

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  /** Leaf files. May hold MORE THAN ONE file when two merged projects
   * contribute the exact same relative path (§12 — a merged document must
   * keep every file visible, even when paths collide). */
  files: DiscoveredFile[];
  children: Map<string, TreeNode>;
}

/** Exported for tests — §12 duplicate-path leaves. */
export function buildTree(files: DiscoveredFile[]): TreeNode {
  const root: TreeNode = {
    name: '',
    path: '',
    isDir: true,
    files: [],
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
          files: [],
          children: new Map(),
        });
      }
      node = node.children.get(part)!;
      if (isLast) node.files.push(file);
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
  /** §44 — language id filter (from the central language mapping). */
  languageFilter: string;
  showExcluded: boolean;
}

export function FileTree({
  project,
  searchQuery,
  languageFilter,
  showExcluded,
}: FileTreeProps) {
  const { state, dispatch, getSelectedFiles } = useAppState();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // §7 — file context menu + properties dialog (right-click or the ⋮ button).
  const [menu, setMenu] = useState<FileContextMenuState | null>(null);
  const [propertiesTarget, setPropertiesTarget] = useState<{
    projectId: string;
    fileId: string;
  } | null>(null);

  const selectedIds = getSelectedFiles(project.id);

  /** Files with attached images (§49 discoverability) — badge in the tree. */
  const imageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [fileId, ids] of Object.entries(state.fileImages)) {
      if (ids.length > 0) counts.set(fileId, ids.length);
    }
    return counts;
  }, [state.fileImages]);

  /** Filenames that occur more than once in this project — shown with path context. */
  const duplicateNames = useMemo(
    () => findDuplicateFileNames(project.files),
    [project.files],
  );

  const filteredFiles = useMemo(
    () =>
      filterVisibleFiles(project.files, {
        showExcluded,
        languageFilter,
        searchQuery,
        inclusions: state.inclusions,
        projectId: project.id,
      }),
    [
      project.files,
      project.id,
      showExcluded,
      languageFilter,
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
    if (searchQuery || languageFilter) {
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
  }, [expanded, searchQuery, languageFilter, tree]);

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
          } else {
            for (const f of child.files) acc.push(f.id);
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

  /** Open the context menu (right-click or ⋮ button) for a file. */
  const openMenu = useCallback(
    (file: DiscoveredFile, x: number, y: number, invoker?: HTMLElement | null) => {
      setMenu({
        fileId: file.id,
        fileName: file.name,
        relativePath: file.relativePath,
        selected: selectedIds.has(file.id),
        x,
        y,
        invoker,
      });
    },
    [selectedIds],
  );

  /** 'Open in preview' — jump to this file's anchor in the main preview
   * using its STABLE identity (fileId + owning project id), §15. */
  const navigateToFile = useCallback(
    (fileId: string) => {
      window.dispatchEvent(
        new CustomEvent('codice:navigate-to-file', {
          detail: { fileId, projectId: project.id },
        }),
      );
    },
    [project.id],
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
          else {
            for (const f of c.files) {
              const sel = isFileSelected(f);
              if (sel) noneSelected = false;
              else allSelected = false;
            }
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

    // §12 — a leaf may hold MULTIPLE files with the exact same path
    // (merged projects). Each file renders as its own selectable row keyed
    // by its unique id — merged duplicates never collapse into one. The
    // keyed Fragment keeps React's list reconciliation happy when renderNode
    // returns multiple rows.
    return (
      <Fragment key={`leaf-${node.path}`}>
        {node.files.map((file) => {
          const isSelected = isFileSelected(file);
          const isExcluded =
            file.excluded && !state.inclusions[project.id]?.has(file.id);
          // Only duplicated filenames get path context — unique names stay clean.
          const needsContext = duplicateNames.has(file.name);
          return (
          <FileRow
            key={`file-${fileSelectionKey(file)}`}
            file={file}
            isSelected={isSelected}
            isExcluded={isExcluded}
            needsContext={needsContext}
            depth={depth}
            imageCount={imageCounts.get(file.id)}
            onToggle={toggleFile}
            onContextMenu={openMenu}
          />
          );
        })}
      </Fragment>
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
    <div className="py-1" onContextMenu={(e) => e.preventDefault()}>
      {renderNode(tree, 0)}
      {menu && (
        <FileContextMenu
          state={menu}
          onOpen={() => navigateToFile(menu.fileId)}
          onProperties={() =>
            setPropertiesTarget({ projectId: project.id, fileId: menu.fileId })
          }
          onToggle={(selected) =>
            dispatch({
              type: 'TOGGLE_FILE',
              projectId: project.id,
              fileId: menu.fileId,
              selected,
            })
          }
          onClose={() => setMenu(null)}
        />
      )}
      {propertiesTarget && (
        <FilePropertiesDialog
          target={propertiesTarget}
          onClose={() => setPropertiesTarget(null)}
        />
      )}
    </div>
  );
}

/** One selectable file row (§12) — identical-path files render as separate
 * rows because the key is the unique file id, never the path. */
function FileRow({
  file,
  isSelected,
  isExcluded,
  needsContext,
  depth,
  imageCount,
  onToggle,
  onContextMenu,
}: {
  file: DiscoveredFile;
  isSelected: boolean;
  isExcluded: boolean;
  needsContext: boolean;
  depth: number;
  /** §49 — number of images attached to this file (badge when > 0). */
  imageCount?: number;
  onToggle: (file: DiscoveredFile, selected: boolean) => void;
  onContextMenu: (
    file: DiscoveredFile,
    x: number,
    y: number,
    invoker?: HTMLElement | null,
  ) => void;
}) {
  return (
    <div
      className={`group flex items-start gap-1.5 rounded px-1.5 py-0.5 hover-surface ${
        isExcluded ? 'opacity-50' : ''
      }`}
      style={{ paddingLeft: depth * 12 + 22 }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(file, e.clientX, e.clientY);
      }}
    >
      <input
        type="checkbox"
        className="mt-1 h-3.5 w-3.5"
        checked={isSelected}
        onChange={(e) => onToggle(file, e.target.checked)}
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
      {typeof imageCount === 'number' && imageCount > 0 && (
        <span
          className="mt-0.5 flex flex-shrink-0 items-center gap-0.5 rounded-full border border-app px-1.5 text-[10px] text-secondary"
          title={`${imageCount} image${imageCount === 1 ? '' : 's'} attached — manage in File properties`}
          aria-label={`${imageCount} image${imageCount === 1 ? '' : 's'} attached`}
        >
          <ImageIcon size={9} />
          {imageCount}
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
      <button
        type="button"
        className="mt-0.5 flex-shrink-0 rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
        title={`File actions for ${file.name} — right-click works too`}
        aria-label={`File actions for ${file.name}`}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onContextMenu(file, rect.left, rect.bottom + 2, e.currentTarget as HTMLElement);
        }}
      >
        <MoreVertical size={13} />
      </button>
    </div>
  );
}
