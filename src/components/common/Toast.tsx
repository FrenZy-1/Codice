/**
 * Toast notification system.
 *
 * A small, self-contained React context that renders stacked toasts in a
 * fixed position and auto-dismisses them after a configurable duration.
 * Supports success / warning / error / info states and manual close.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Check, AlertTriangle, Info, X, Loader } from '@/components/common/Icons';

export type ToastKind = 'success' | 'warning' | 'error' | 'info' | 'loading';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  /** Auto-dismiss after N ms. 0 = sticky. Default 5000 for non-loading. */
  durationMs: number;
  createdAt: number;
}

interface ToastContextValue {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id' | 'createdAt' | 'durationMs'> & { durationMs?: number }) => string;
  dismiss: (id: string) => void;
  update: (id: string, patch: Partial<Omit<Toast, 'id' | 'createdAt'>>) => void;
}

const ToastCtx = createContext<ToastContextValue | null>(null);

const MAX_TOASTS = 4;

let nextId = 1;
function genId(): string {
  return `t-${nextId++}-${Date.now().toString(36)}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback<ToastContextValue['push']>(
    (toast) => {
      const id = genId();
      const durationMs = toast.durationMs ?? (toast.kind === 'loading' ? 0 : 5000);
      const newToast: Toast = {
        id,
        kind: toast.kind,
        title: toast.title,
        message: toast.message,
        durationMs,
        createdAt: Date.now(),
      };
      setToasts((prev) => {
        const next = [...prev, newToast];
        // Cap the stack — drop the oldest.
        if (next.length > MAX_TOASTS) {
          const dropped = next.shift()!;
          const t = timers.current.get(dropped.id);
          if (t) {
            clearTimeout(t);
            timers.current.delete(dropped.id);
          }
        }
        return next;
      });
      if (durationMs > 0) {
        const timer = window.setTimeout(() => dismiss(id), durationMs);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  const update = useCallback<ToastContextValue['update']>(
    (id, patch) => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
      // Reset auto-dismiss timer if a new duration was provided.
      if (patch.durationMs && patch.durationMs > 0) {
        const existing = timers.current.get(id);
        if (existing) clearTimeout(existing);
        const timer = window.setTimeout(() => dismiss(id), patch.durationMs);
        timers.current.set(id, timer);
      }
    },
    [dismiss],
  );

  // Cleanup on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  return (
    <ToastCtx.Provider value={{ toasts, push, dismiss, update }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

/**
 * Toast access for components that may render OUTSIDE the ToastProvider
 * (tests render AppStateProvider bare, for example). Returns null when
 * no provider is mounted — callers must treat toasting as optional.
 */
export function useToastOptional(): ToastContextValue | null {
  return useContext(ToastCtx);
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      className="codice-print-hidden pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const iconColor =
    toast.kind === 'success'
      ? 'text-[var(--color-success)]'
      : toast.kind === 'warning'
        ? 'text-[var(--color-warning)]'
        : toast.kind === 'error'
          ? 'text-[var(--color-error)]'
          : toast.kind === 'loading'
            ? 'text-[var(--color-accent)]'
            : 'text-[var(--color-accent)]';

  const borderColor =
    toast.kind === 'success'
      ? 'border-l-[var(--color-success)]'
      : toast.kind === 'warning'
        ? 'border-l-[var(--color-warning)]'
        : toast.kind === 'error'
          ? 'border-l-[var(--color-error)]'
          : 'border-l-[var(--color-accent)]';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`codice-toast-in pointer-events-auto flex items-start gap-3 rounded-md border border-[var(--color-border)] border-l-4 ${borderColor} bg-[var(--color-surface-elevated)] px-4 py-3 shadow-lg`}
    >
      <div className={`mt-0.5 flex-shrink-0 ${iconColor}`}>
        {toast.kind === 'success' ? (
          <Check size={16} />
        ) : toast.kind === 'warning' || toast.kind === 'error' ? (
          <AlertTriangle size={16} />
        ) : toast.kind === 'loading' ? (
          <Loader size={16} className="animate-spin" />
        ) : (
          <Info size={16} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[var(--color-text-primary)]">
          {toast.title}
        </div>
        {toast.message && (
          <div className="mt-0.5 text-xs text-[var(--color-text-secondary)] break-words">
            {toast.message}
          </div>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
    </div>
  );
}
