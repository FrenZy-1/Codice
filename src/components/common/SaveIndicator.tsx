/**
 * SaveIndicator (R14) — a quiet header affordance for the autosave.
 *
 * Listens to the persist-signal window events (src/lib/persistSignal.ts):
 *   'dirty' → amber pulsing dot + "Saving…" (the debounced write is pending)
 *   'saved' → green check + "Saved", fading back to a muted check after
 *             ~1.6 s so the header stays calm between edits.
 *
 * Announced via role="status"/aria-live="polite"; screen readers get the
 * same state changes without the header gaining focus.
 */

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import {
  onPersistSignal,
  type PersistSignalStatus,
} from '@/lib/persistSignal';

type Phase = 'idle' | 'dirty' | 'saved';

/** How long the "Saved" confirmation stays before fading back to idle. */
export const SAVED_LINGER_MS = 1600;

export function SaveIndicator() {
  const [phase, setPhase] = useState<Phase>('idle');

  useEffect(() => {
    return onPersistSignal((detail: { status: PersistSignalStatus }) => {
      setPhase(detail.status === 'dirty' ? 'dirty' : 'saved');
    });
  }, []);

  // "Saved" lingers briefly, then the indicator fades back to the muted
  // idle check so the header does not stay busy after a burst of edits.
  useEffect(() => {
    if (phase !== 'saved') return;
    const timer = window.setTimeout(() => setPhase('idle'), SAVED_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  return (
    <span
      className="codice-save-indicator"
      role="status"
      aria-live="polite"
      title="Changes are saved automatically in your browser"
      data-testid="save-indicator"
      data-phase={phase}
    >
      {phase === 'dirty' ? (
        <>
          <span className="codice-save-dot" aria-hidden="true" />
          <span>Saving…</span>
        </>
      ) : phase === 'saved' ? (
        <>
          <Check size={11} aria-hidden="true" className="codice-save-saved" />
          <span className="codice-save-saved">Saved</span>
        </>
      ) : (
        <Check size={11} aria-hidden="true" className="text-muted" />
      )}
    </span>
  );
}
