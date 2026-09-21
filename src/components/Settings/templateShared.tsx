'use client';

/**
 * Shared building blocks for the Codice Template Editor.
 *
 * Includes form primitives (Field / Toggle / NumberInput / ColorInput /
 * WeightSelect), group containers (SubGroup / AdvancedSection), the
 * dependent-setting pattern (parent toggle gates all children), and the
 * setting→preview-region highlight mapping used by the live preview.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, X } from '@/components/common/Icons';
import type { FontWeight, Alignment } from '@/lib/presets/documentPreset';

/* ------------------------------------------------------------------ */
/* Form primitives                                                     */
/* ------------------------------------------------------------------ */

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="label block">{label}</label>
      {children}
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  ariaLabel?: string;
}) {
  return (
    <input
      type="number"
      className="input"
      value={Number.isFinite(value) ? value : 0}
      step={step}
      min={min}
      max={max}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

/** Map FontWeight to numeric CSS font-weight. */
export const WEIGHT_MAP: Record<FontWeight, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

export function WeightSelect({
  value,
  onChange,
}: {
  value: FontWeight;
  onChange: (v: FontWeight) => void;
}) {
  return (
    <select
      className="select"
      value={value}
      onChange={(e) => onChange(e.target.value as FontWeight)}
    >
      <option value="normal">Normal (400)</option>
      <option value="medium">Medium (500)</option>
      <option value="semibold">Semibold (600)</option>
      <option value="bold">Bold (700)</option>
    </select>
  );
}

export function AlignmentSelect({
  value,
  onChange,
  label,
}: {
  value: Alignment;
  onChange: (v: Alignment) => void;
  label?: string;
}) {
  return (
    <select
      className="select"
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value as Alignment)}
    >
      <option value="left">Left</option>
      <option value="center">Center</option>
      <option value="right">Right</option>
    </select>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer py-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4"
      />
      <span className="text-sm text-primary">{label}</span>
    </label>
  );
}

export function ColorInput({
  value,
  onChange,
  allowEmpty,
}: {
  value: string;
  onChange: (v: string) => void;
  allowEmpty?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value || '#ffffff'}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-12 rounded border border-app bg-transparent"
        aria-label="Pick color"
      />
      <input
        type="text"
        className="input"
        value={value}
        placeholder={allowEmpty ? '(none)' : '#000000'}
        onChange={(e) => onChange(e.target.value)}
      />
      {allowEmpty && value && (
        <button className="btn-ghost" onClick={() => onChange('')} aria-label="Clear color">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Groups                                                              */
/* ------------------------------------------------------------------ */

/** Sub-group inside an accordion section — rendered as a polished card. */
export function SubGroup({
  label,
  children,
  right,
}: {
  label: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-app bg-surface/40 p-3 space-y-2.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] opacity-70"
          />
          <div className="text-xs font-semibold text-secondary uppercase tracking-wide">
            {label}
          </div>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/**
 * Collapsible "Advanced ▼" region used inside setting groups.
 * Children are hidden until expanded — this is how complexity is
 * progressively revealed.
 */
export function AdvancedSection({
  children,
  defaultOpen = false,
  summary,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  summary?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={`rounded-md border transition-colors ${
        open
          ? 'border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)] bg-app/60'
          : 'border-app'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs font-medium text-secondary hover-surface rounded-md"
        aria-expanded={open}
      >
        <span
          className={`inline-flex transition-transform duration-200 ${
            open ? 'rotate-90' : 'rotate-0'
          }`}
        >
          <ChevronRight size={12} />
        </span>
        Advanced
        {summary && !open && (
          <span className="ml-auto text-[10px] font-normal text-muted truncate max-w-[55%]">{summary}</span>
        )}
      </button>
      {open && <div className="space-y-2 px-2.5 pb-2.5 pt-0.5">{children}</div>}
    </div>
  );
}

/**
 * Dependent-setting gate: renders children only when `enabled` is true.
 * Hidden — NOT merely disabled — so the UI stays clean until the parent
 * feature is turned on.
 */
export function DependentSettings({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  if (!enabled) return null;
  return <div className="space-y-2">{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Highlight mapping (setting changes → preview regions)               */
/* ------------------------------------------------------------------ */

/**
 * Minimal structural shape of a preset — only the groups the mapper reads.
 * Passing the PREVIOUS preset enables change-diffing so a patch that merges
 * a full group (e.g. all five heading level objects) only highlights the
 * levels whose sub-object identity actually changed (spec §8/§30).
 */
export interface PresetShapeForHighlight {
  headings?: object;
  page?: object;
  colors?: object;
}

/**
 * Given a patch applied to the preset (or metadata keys), compute which
 * preview regions should flash. Regions correspond to data-highlight ids
 * rendered by TemplatePreview (and the data-codice-region ids used by the
 * main document preview).
 *
 * When `previous` is supplied, group values are diffed by sub-object
 * identity: `{ ...preset.headings, title: { …changed } }` keeps reference
 * equality for the untouched levels, so only genuinely changed levels
 * produce highlight regions.
 */
export function computeHighlightIds(
  patch: Record<string, unknown>,
  metadataKeys?: string[],
  previous?: PresetShapeForHighlight,
): string[] {
  const ids = new Set<string>();

  const addFor = (key: string, value: unknown) => {
    switch (key) {
      case 'page': {
        const p = value as Record<string, unknown> | undefined;
        if (!p || typeof p !== 'object') {
          ids.add('page');
          break;
        }
        if ('size' in p || 'landscape' in p || 'marginTopMm' in p || 'marginRightMm' in p || 'marginBottomMm' in p || 'marginLeftMm' in p) {
          ids.add('page');
        }
        if ('headerSpacingMm' in p || 'pageHeaderShow' in p || 'pageHeaderLayout' in p || 'pageHeaderAlign' in p || 'pageHeaderLeft' in p || 'pageHeaderCenter' in p || 'pageHeaderRight' in p) {
          ids.add('page-header');
        }
        if ('footerSpacingMm' in p || 'pageFooterShow' in p || 'pageFooterLayout' in p || 'pageFooterAlign' in p || 'pageFooterLeft' in p || 'pageFooterCenter' in p || 'pageFooterRight' in p || 'pageFooterText' in p) {
          ids.add('page-footer');
        }
        break;
      }
      case 'layout': {
        const l = value as Record<string, unknown> | undefined;
        if (!l || typeof l !== 'object') break;
        if ('bodyLineSpacing' in l || 'bodyParagraphSpacingPt' in l) ids.add('body');
        if ('codeBlockSpacingBeforePt' in l || 'codeBlockSpacingAfterPt' in l) ids.add('code');
        if ('headingSpacingBeforePt' in l || 'headingSpacingAfterPt' in l) ids.add('heading-h1');
        if ('titlePageVerticalOffsetPt' in l) ids.add('title-page');
        if ('fileHeaderSpacingPt' in l) ids.add('file-header');
        if ('projectHeaderSpacingBeforePt' in l || 'projectHeaderSpacingAfterPt' in l) ids.add('project-header');
        if ('sectionSpacingPt' in l) ids.add('toc');
        break;
      }
      case 'pageBreaks':
        ids.add('page-breaks');
        break;
      case 'titlePage':
        ids.add('title-page');
        break;
      case 'projectStructure':
        ids.add('structure');
        break;
      case 'fileHeaders':
        ids.add('file-header');
        break;
      case 'projectHeaders':
        ids.add('project-header');
        break;
      case 'misc':
        ids.add('toc');
        break;
      case 'toc':
        // TOC page alignment group (spec §4).
        ids.add('toc');
        break;
      case 'typography':
        ids.add('body');
        break;
      case 'code':
        ids.add('code');
        break;
      case 'syntaxTheme':
        // Code token colors change everywhere — flash the code blocks.
        ids.add('code');
        break;
      case 'colors': {
        // Each document color maps to the regions that semantically consume
        // it (spec §5/§10) — the flash previews exactly what will change.
        const c = value as Record<string, unknown> | undefined;
        if (!c || typeof c !== 'object') break;
        if ('background' in c) ids.add('page');
        if ('headings' in c) {
          // The Headings document color drives Title + H1–H4 (broadcast).
          ids.add('heading-title');
          ids.add('heading-h1');
          ids.add('heading-h2');
          ids.add('heading-h3');
          ids.add('heading-h4');
        }
        if ('borders' in c || 'codeBorder' in c) ids.add('code');
        // Primary text IS the body copy color (spec §5).
        if ('primaryText' in c) ids.add('body');
        // Secondary text: title-page subtitle/author/description, TOC
        // entries, project-structure tree.
        if ('secondaryText' in c) {
          ids.add('title-page');
          ids.add('toc');
          ids.add('structure');
        }
        if ('mutedText' in c) {
          ids.add('title-page');
          ids.add('project-header');
          ids.add('file-header');
        }
        if ('accent' in c) {
          ids.add('toc');
          ids.add('project-header');
          ids.add('structure');
        }
        if ('links' in c) ids.add('body');
        if ('success' in c || 'warning' in c || 'error' in c || 'surface' in c) {
          ids.add('status-card');
        }
        if ('codeHeader' in c || 'lineNumbers' in c) ids.add('code');
        break;
      }
      case 'headings': {
        const h = value as Record<string, unknown> | undefined;
        if (!h || typeof h !== 'object') break;
        const prevHeadings = previous?.headings as
          | Record<string, unknown>
          | undefined;
        for (const level of ['title', 'h1', 'h2', 'h3', 'h4']) {
          if (!(level in h)) continue;
          // Diff by sub-object identity — untouched levels keep the same
          // object reference when the caller merges the full group.
          if (
            prevHeadings &&
            level in prevHeadings &&
            h[level] === prevHeadings[level]
          ) {
            continue;
          }
          ids.add(level === 'title' ? 'heading-title' : `heading-${level}`);
        }
        break;
      }
      default:
        break;
    }
  };

  for (const [key, value] of Object.entries(patch)) {
    addFor(key, value);
  }

  if (metadataKeys && metadataKeys.length > 0) {
    ids.add('title-page');
  }

  return Array.from(ids);
}
