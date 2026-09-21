'use client';

/**
 * Onboarding tour overlay.
 *
 * Renders a full-screen dimming layer with a spotlight cut-out around the
 * current step's target element (one absolutely-positioned rect with a
 * giant box-shadow — cheap and crisp). A glass tooltip card anchored to
 * the target explains the region and offers Back / Next / Skip controls.
 *
 * Geometry is measured from the live DOM after mount, so the overlay
 * renders null on the first paint and positions correctly on the second.
 * Resize and scroll re-measure via rAF throttling. The component is
 * jsdom-safe: without layout APIs it still renders (rects default to 0).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  getTourSteps,
  markTourDone,
  positionTooltip,
  spotlightRect,
  type Rect,
  type TourStepDef,
} from '@/lib/onboardingTour';
import { X, ChevronRight, ChevronLeft, Compass } from '@/components/common/Icons';

interface Props {
  open: boolean;
  onFinish: () => void;
  /** §55 — custom step catalogue (e.g. the Layout studio tour). Defaults
   * to the main application walk-through. */
  steps?: TourStepDef[];
  /** §55 — which "tour done" storage flag to mark on finish. */
  storageKey?: string;
  /** Accessible dialog label. */
  label?: string;
}

const MEASURE_DEBOUNCE_MS = 60;

export function OnboardingTour({ open, onFinish, steps: stepsProp, storageKey, label = 'Guided tour' }: Props) {
  // Steps are fixed for the component's lifetime — state (not a ref) so the
  // render body never reads mutable data (react-hooks/refs).
  const [steps] = useState<TourStepDef[]>(() => stepsProp ?? getTourSteps());
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const [tooltipHeight, setTooltipHeight] = useState(150);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const measureTimer = useRef<number | null>(null);

  const step = steps[index];
  const total = steps.length;

  const finish = useCallback(() => {
    markTourDone(storageKey);
    onFinish();
  }, [onFinish, storageKey]);

  // Re-measure the target rect (rAF-throttled).
  const measure = useCallback(() => {
    if (!open) return;
    const el =
      typeof document !== 'undefined'
        ? document.querySelector<HTMLElement>(`[data-tour="${steps[index]?.target}"]`)
        : null;
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    if (typeof window !== 'undefined') {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    }
  }, [index, open, steps]);

  // Measure before the next paint. rAF keeps this out of the synchronous
  // effect body (react-hooks/set-state-in-effect) while still landing on
  // the first visible frame.
  useLayoutEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [open, index, measure]);

  // Measure the tooltip's real height for placement math.
  useEffect(() => {
    if (tooltipRef.current) {
      const h = tooltipRef.current.offsetHeight;
      if (h > 0) setTooltipHeight(h);
    }
  }, [index, open, rect]);

  // Keep the target in view while its step is shown.
  useEffect(() => {
    if (!open) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${step?.target}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [open, step]);

  // A step whose target is missing (the rules / stats panels only exist once
  // a project is loaded) would render an empty spotlight and dead-end the
  // tour. After a short retry window, skip forward — or finish when it is
  // the last step.
  useEffect(() => {
    if (!open || rect !== null) return;
    const timer = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-tour="${steps[index]?.target}"]`,
      );
      if (el) {
        measure();
        return;
      }
      if (index < total - 1) setIndex((i) => i + 1);
      else finish();
    }, 160);
    return () => window.clearTimeout(timer);
  }, [open, rect, index, total, steps, measure, finish]);

  // Resize / scroll listeners with a small trailing debounce.
  useEffect(() => {
    if (!open) return;
    const onEvent = () => {
      if (measureTimer.current !== null) return;
      measureTimer.current = window.setTimeout(() => {
        measureTimer.current = null;
        requestAnimationFrame(measure);
      }, MEASURE_DEBOUNCE_MS);
    };
    window.addEventListener('resize', onEvent);
    window.addEventListener('scroll', onEvent, true);
    return () => {
      window.removeEventListener('resize', onEvent);
      window.removeEventListener('scroll', onEvent, true);
      if (measureTimer.current !== null) {
        clearTimeout(measureTimer.current);
        measureTimer.current = null;
      }
    };
  }, [open, measure]);

  // Keyboard navigation: ← back, → / Enter next, Escape skip.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        if (index < total - 1) setIndex((i) => i + 1);
        else finish();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, total, finish]);

  if (!open) return null;

  const spot = rect ? spotlightRect(rect, viewport) : null;
  const tooltip = rect
    ? positionTooltip(rect, step.placement, viewport, tooltipHeight)
    : null;
  const isLast = index === total - 1;

  return (
    <div className="codice-tour-root" role="dialog" aria-modal="true" aria-label={label}>
      {/* Dimming layer with the spotlight cut-out */}
      {spot && (
        <div
          className="codice-tour-spotlight codice-tour-spotlight-in"
          style={{
            left: spot.left,
            top: spot.top,
            width: spot.width,
            height: spot.height,
          }}
        />
      )}

      {/* Click-away = skip the tour (intentional escape hatch). */}
      <div className="codice-tour-backdrop" onClick={finish} aria-hidden="true" />

      {/* Tooltip card */}
      {tooltip && (
        <div
          ref={tooltipRef}
          className="codice-tour-tooltip codice-fade-in"
          style={{ left: tooltip.left, top: tooltip.top, width: 288 }}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Compass size={13} className="text-accent" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                Step {index + 1} of {total}
              </span>
            </div>
            <button
              type="button"
              className="codice-tour-close"
              onClick={finish}
              aria-label="Skip the tour"
              title="Skip tour (Esc)"
            >
              <X size={12} />
            </button>
          </div>

          <h3 className="mt-1.5 text-sm font-semibold text-primary">{step.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-secondary">{step.body}</p>

          {step.hint && (
            <div className="mt-2">
              <kbd className="kbd">{step.hint}</kbd>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-app pt-2.5">
            <div className="flex items-center gap-1" aria-hidden="true">
              {steps.map((s, i) => (
                <span
                  key={s.target}
                  className="codice-tour-dot"
                  data-active={i === index}
                />
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              {index > 0 && (
                <button
                  type="button"
                  className="codice-tour-btn"
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                >
                  <ChevronLeft size={11} />
                  Back
                </button>
              )}
              <button
                type="button"
                className="codice-tour-btn codice-tour-btn-primary"
                onClick={() => (isLast ? finish() : setIndex((i) => i + 1))}
              >
                {isLast ? 'Finish' : 'Next'}
                <ChevronRight size={11} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
