/**
 * Tests for the onboarding tour geometry + catalogue (pure functions).
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  getTourSteps,
  isTourDone,
  markTourDone,
  positionTooltip,
  resetTourDone,
  spotlightRect,
  TOOLTIP_GAP,
  TOOLTIP_WIDTH,
  TOUR_DONE_STORAGE_KEY,
} from '../lib/onboardingTour';

const VIEWPORT = { width: 1280, height: 800 };

beforeEach(() => {
  window.localStorage.clear();
});

describe('tour step catalogue', () => {
  it('covers the key regions in a sensible order', () => {
    const steps = getTourSteps();
    expect(steps.map((s) => s.target)).toEqual([
      'upload',
      'files',
      'rules',
      'stats',
      'template',
      'preview',
      'export',
    ]);
  });

  it('every step has a title, body and valid placement', () => {
    for (const step of getTourSteps()) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
      expect(['bottom', 'top', 'right', 'left']).toContain(step.placement);
    }
  });

  it('storage flag round-trips', () => {
    expect(isTourDone()).toBe(false);
    markTourDone();
    expect(isTourDone()).toBe(true);
    resetTourDone();
    expect(isTourDone()).toBe(false);
    expect(window.localStorage.getItem(TOUR_DONE_STORAGE_KEY)).toBeNull();
  });
});

describe('positionTooltip', () => {
  const tallSidebar: Rect0 = { left: 0, top: 0, width: 320, height: 640 };

  type Rect0 = { left: number; top: number; width: number; height: number };

  it('places a bottom-preferred tooltip below the target', () => {
    const rect = { left: 500, top: 100, width: 200, height: 40 };
    const pos = positionTooltip(rect, 'bottom', VIEWPORT);
    expect(pos.placement).toBe('bottom');
    expect(pos.top).toBe(rect.top + rect.height + TOOLTIP_GAP);
    // Horizontally centered on the target.
    expect(pos.left).toBeCloseTo(rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2);
  });

  it('flips to top when there is no room below', () => {
    const rect = { left: 500, top: 720, width: 200, height: 60 };
    const pos = positionTooltip(rect, 'bottom', VIEWPORT);
    expect(pos.placement).toBe('top');
    expect(pos.top).toBeLessThan(rect.top);
  });

  it('falls back to bottom for side placements that fit nowhere', () => {
    // Full-width bar target → tooltip can't sit left or right of it.
    const rect = { left: 0, top: 0, width: 1280, height: 100 };
    const pos = positionTooltip(rect, 'right', VIEWPORT);
    expect(pos.placement).toBe('bottom');
  });

  it('falls back to top when neither side nor bottom fits', () => {
    const rect = { left: 0, top: 700, width: 1280, height: 100 };
    const pos = positionTooltip(rect, 'left', VIEWPORT);
    expect(pos.placement).toBe('top');
  });

  it('clamps the tooltip inside the viewport horizontally', () => {
    // Target hugging the left edge → a centered bottom tooltip would clip.
    const rect = { left: 0, top: 100, width: 120, height: 40 };
    const pos = positionTooltip(rect, 'bottom', VIEWPORT);
    expect(pos.left).toBeGreaterThanOrEqual(0);
    expect(pos.left + TOOLTIP_WIDTH).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it('clamps vertically for tall tooltips near the bottom edge', () => {
    const rect = { left: 500, top: 700, width: 280, height: 90 };
    const pos = positionTooltip(rect, 'top', VIEWPORT, 400);
    expect(pos.top).toBeGreaterThanOrEqual(0);
    expect(pos.top + 400).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it('honors a right preference when there is room', () => {
    const rect = { left: 100, top: 300, width: 200, height: 60 };
    const pos = positionTooltip(rect, 'right', VIEWPORT);
    expect(pos.placement).toBe('right');
    expect(pos.left).toBe(rect.left + rect.width + TOOLTIP_GAP);
  });

  it('handles tiny viewports without throwing', () => {
    const pos = positionTooltip(tallSidebar, 'right', { width: 200, height: 200 });
    expect(Number.isFinite(pos.left)).toBe(true);
    expect(Number.isFinite(pos.top)).toBe(true);
  });
});

describe('spotlightRect', () => {
  it('inflates the target by the margin', () => {
    const rect = { left: 100, top: 100, width: 200, height: 80 };
    const spot = spotlightRect(rect, VIEWPORT);
    expect(spot.left).toBeLessThan(rect.left);
    expect(spot.top).toBeLessThan(rect.top);
    expect(spot.width).toBeGreaterThan(rect.width);
    expect(spot.height).toBeGreaterThan(rect.height);
  });

  it('clamps to the viewport edges', () => {
    const rect = { left: -50, top: -50, width: 100, height: 100 };
    const spot = spotlightRect(rect, VIEWPORT);
    expect(spot.left).toBeGreaterThanOrEqual(0);
    expect(spot.top).toBeGreaterThanOrEqual(0);
  });

  it('never produces negative dimensions for off-screen targets', () => {
    const offscreen = { left: 2000, top: 2000, width: 100, height: 100 };
    const spot = spotlightRect(offscreen, VIEWPORT);
    expect(spot.width).toBe(0);
    expect(spot.height).toBe(0);
  });
});
