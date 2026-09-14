/**
 * Shared preview viewport controls.
 *
 * Both preview environments (main document preview + template-settings
 * preview) render the same toolbar language — a compact square icon button
 * (§12/§13 consistency) — while keeping their zoom STATE independent
 * (§16: coupling the two zoom states is explicitly not desired).
 */

/** Snap ladder for explicit zoom levels (main preview). */
export const ZOOM_LADDER = [30, 40, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200];

/** Move through the ladder one step at a time, clamped to its ends. */
export function stepZoomLadder(current: number, delta: number): number {
  if (delta === 0) return current;
  if (delta > 0) {
    const next = ZOOM_LADDER.find((z) => z > current);
    return Math.min(next ?? ZOOM_LADDER[ZOOM_LADDER.length - 1], ZOOM_LADDER[ZOOM_LADDER.length - 1]);
  }
  const prev = [...ZOOM_LADDER].reverse().find((z) => z < current);
  return Math.max(prev ?? ZOOM_LADDER[0], ZOOM_LADDER[0]);
}

/** Compact square icon button used by both preview toolbars. */
export function ToolbarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-6 w-6 items-center justify-center rounded text-secondary transition-colors hover-surface disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
