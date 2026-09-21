'use client';

/**
 * File context menu (spec §7/§38/§41).
 *
 * Opened by right-clicking a file row (or its keyboard-reachable ⋮ button).
 * Items:
 *   Open        — scroll the main preview to this file's section.
 *   Properties  — open the File Properties dialog.
 *   Exclude / Include — toggle the file's selection state.
 *
 * Keyboard accessible: arrow keys move between items, Escape closes,
 * Enter/Space activates, focus is restored to the invoker on close.
 */

import { useEffect, useRef } from 'react';
import { FolderOpen, Settings2, EyeOff, Eye, Copy } from '@/components/common/Icons';

export interface FileContextMenuState {
  fileId: string;
  fileName: string;
  /** §41 — full project-relative path for the copy action. */
  relativePath?: string;
  selected: boolean;
  x: number;
  y: number;
  /** Element to restore focus to when the menu closes. */
  invoker?: HTMLElement | null;
}

export function FileContextMenu({
  state,
  onOpen,
  onProperties,
  onToggle,
  onClose,
}: {
  state: FileContextMenuState;
  onOpen: () => void;
  onProperties: () => void;
  onToggle: (selected: boolean) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const items: Array<{
    key: string;
    label: string;
    icon: React.ReactNode;
    action: () => void;
  }> = [
    {
      key: 'open',
      label: 'Open in preview',
      icon: <FolderOpen size={13} />,
      action: onOpen,
    },
    {
      key: 'properties',
      label: 'Properties',
      icon: <Settings2 size={13} />,
      action: onProperties,
    },
    {
      key: 'toggle',
      label: state.selected ? 'Exclude from document' : 'Include in document',
      icon: state.selected ? <EyeOff size={13} /> : <Eye size={13} />,
      action: () => onToggle(!state.selected),
    },
  ];

  // §41 — copy the project-relative path (handy for commit messages,
  // build scripts and bug reports). Clipboard may be unavailable → toast.
  if (state.relativePath) {
    items.push({
      key: 'copy-path',
      label: 'Copy relative path',
      icon: <Copy size={13} />,
      action: () => {
        const path = state.relativePath as string;
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(path);
        }
      },
    });
  }

  // Focus the first item; Escape/arrow-key handling; click-away close.
  useEffect(() => {
    itemRefs.current[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        state.invoker?.focus();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const current = itemRefs.current.findIndex((el) => el === document.activeElement);
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const next = (current + delta + items.length) % items.length;
        itemRefs.current[next]?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Keep the menu inside the viewport.
  const clampedX = Math.min(state.x, (typeof window !== 'undefined' ? window.innerWidth : 1024) - 210);
  const clampedY = Math.min(state.y, (typeof window !== 'undefined' ? window.innerHeight : 768) - 170);

  return (
    <div
      ref={menuRef}
      className="codice-fade-in fixed z-[70] min-w-[190px] overflow-hidden rounded-md border border-app bg-surface-elevated py-1 shadow-2xl"
      role="menu"
      aria-label={`File actions for ${state.fileName}`}
      style={{ left: clampedX, top: clampedY }}
    >
      {items.map((item, i) => (
        <button
          key={item.key}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-secondary transition-colors hover:bg-app hover:text-primary focus-visible:bg-app focus-visible:text-primary focus-visible:outline-none"
          onClick={() => {
            item.action();
            onClose();
          }}
        >
          <span className="text-muted">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}
