/**
 * Save-state signal (R14) — a tiny window-event channel between the
 * persistence layer (useAppState's debounced localStorage write) and the
 * header save indicator.
 *
 * The app autosaves every state change (debounced 500 ms). Rather than
 * threading a `saveStatus` prop from the provider up into the header, the
 * persistence layer emits window CustomEvents:
 *
 *   'dirty'  — state changed, the debounced write is pending
 *   'saved'  — the write completed (or failed irrecoverably — quota errors
 *              are silently swallowed by design, so the indicator must not
 *              hang on "Saving…")
 *
 * Keeping this as a window event means tests can drive the indicator
 * directly and the provider stays free of UI state.
 */

export const PERSIST_SIGNAL_EVENT = 'codice-persist-signal';

export type PersistSignalStatus = 'dirty' | 'saved';

export interface PersistSignalDetail {
  status: PersistSignalStatus;
  /** Epoch millis when the signal was emitted. */
  at: number;
}

/** Emit a persist-status signal (no-op outside a browser window). */
export function emitPersistSignal(status: PersistSignalStatus): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<PersistSignalDetail>(PERSIST_SIGNAL_EVENT, {
      detail: { status, at: Date.now() },
    }),
  );
}

/** Subscribe to persist-status signals; returns the unsubscribe function. */
export function onPersistSignal(
  handler: (detail: PersistSignalDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<PersistSignalDetail>).detail;
    if (detail && (detail.status === 'dirty' || detail.status === 'saved')) {
      handler(detail);
    }
  };
  window.addEventListener(PERSIST_SIGNAL_EVENT, listener);
  return () => window.removeEventListener(PERSIST_SIGNAL_EVENT, listener);
}
