'use client';

/**
 * §18 — shared popover dismissal for the Outline and Statistics popovers.
 *
 * Semantics (normal popover behavior):
 *   - pointer-down OUTSIDE the popover closes it (capture phase, so it runs
 *     before inside handlers can swallow the event),
 *   - Escape closes it,
 *   - clicking INSIDE never closes,
 *   - the explicit close button keeps working (it is inside the popover),
 *   - another competing popover's surface counts as "outside" for this one,
 *     so opening one dismisses the previous one (§18).
 *
 * `onClose` is kept in a ref so re-renders do not re-subscribe the global
 * listeners while the popover is open.
 */

import { useEffect, useRef } from 'react';

export function usePopoverDismiss(
  open: boolean,
  onClose: () => void,
  /** Selectors counting as "inside" the popover (panel + controls). */
  insideSelectors: readonly string[],
): void {
  const onCloseRef = useRef(onClose);
  const selectorsRef = useRef(insideSelectors);

  // Keep the latest callbacks/selectors without re-subscribing listeners.
  useEffect(() => {
    onCloseRef.current = onClose;
    selectorsRef.current = insideSelectors;
  }, [onClose, insideSelectors]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const inside = selectorsRef.current.some((sel) =>
        Boolean(target.closest(sel)),
      );
      if (!inside) onCloseRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
}
