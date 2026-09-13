'use client';

/**
 * Keyboard shortcuts help overlay.
 *
 * Lists every global shortcut Codice supports. Opened from the top bar
 * keyboard button or by pressing `?` (Shift+/) when not typing in a field.
 * Follows the same dialog pattern as MetadataDialog (fresh mount per open,
 * Escape to close, backdrop click to dismiss).
 */

import { useEffect } from 'react';
import { X, Keyboard, Compass } from '@/components/common/Icons';

export interface ShortcutDef {
  keys: string[];
  label: string;
  /** Optional note shown under the label. */
  note?: string;
  /** Platform-dependent display: pass the platform-correct key list. */
}

/** Global shortcut catalogue (single source of truth for docs + tests). */
export function getShortcuts(isMac: boolean): ShortcutDef[] {
  const mod = isMac ? '⌘ Cmd' : 'Ctrl';
  return [
    {
      keys: [mod, 'E'],
      label: 'Export document',
      note: 'Generate DOCX / PDF / ODT for the current selection',
    },
    {
      keys: [mod, 'T'],
      label: 'Toggle template editor',
      note: 'Open or close the template customizer',
    },
    {
      keys: [mod, 'D'],
      label: 'Toggle light / dark theme',
    },
    {
      keys: [mod, 'K'],
      label: 'Focus file search',
      note: 'Jump to the file filter box in the sidebar',
    },
    {
      keys: [mod, 'O'],
      label: 'Toggle document outline',
      note: 'Jump between title page, projects and files in the preview',
    },
    {
      keys: ['?'],
      label: 'Show this help',
      note: 'Shift + / on most keyboards',
    },
    {
      keys: ['Esc'],
      label: 'Close dialogs and the template editor',
    },
  ];
}

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <HelpDialogInner onClose={onClose} />;
}

function HelpDialogInner({ onClose }: { onClose: () => void }) {
  // Fresh mount on open → compute platform-correct shortcuts once.
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const shortcuts = getShortcuts(isMac);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="panel codice-fade-in relative flex max-h-[85vh] w-full max-w-md flex-col shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-app px-4 py-3">
          <div className="flex items-center gap-2">
            <Keyboard size={15} className="text-secondary" />
            <h2 className="text-sm font-semibold text-primary">
              Keyboard Shortcuts
            </h2>
            <span className="badge">work everywhere</span>
          </div>
          <button onClick={onClose} className="btn-ghost" aria-label="Close">
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-4 py-3">
          <ul className="space-y-1.5">
            {shortcuts.map((s) => (
              <li
                key={s.label}
                className="flex items-center justify-between gap-3 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-app hover-surface"
              >
                <div className="min-w-0">
                  <div className="text-sm text-primary">{s.label}</div>
                  {s.note && (
                    <div className="text-xs text-muted">{s.note}</div>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  {s.keys.map((k) => (
                    <kbd key={k} className="kbd">
                      {k}
                    </kbd>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer hint */}
        <div className="border-t border-app px-4 py-2 text-center text-[11px] text-muted">
          Shortcuts are ignored while typing in inputs or text areas.
          <div className="mt-0.5">
            New here? Click the{' '}
            <Compass size={10} className="inline align-[-1px]" style={{ color: 'var(--color-accent)' }} />{' '}
            compass in the top bar for a guided tour.
          </div>
        </div>
      </div>
    </div>
  );
}
