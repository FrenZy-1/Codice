'use client';

/**
 * Codice Template Editor.
 *
 * Organized into exactly FOUR top-level sections:
 *
 *   ├── Page & Layout     — page geometry, document sections, layout,
 *   │                       spacing, pagination
 *   ├── Fonts Settings    — all document typography (body, headings, code,
 *   │                       project structure)
 *   ├── Theme Settings    — syntax theme + document colors + code colors
 *   └── Save Preset       — preset management
 *
 * (The former "Document & Misc" section was merged into Page & Layout.)
 *
 * Dependent settings are HIDDEN until their parent feature is enabled
 * (not merely disabled). Advanced controls collapse behind "Advanced ▼".
 *
 * The right pane shows a live multi-page preview consuming the SAME
 * `DocumentPreset` as the exporters. Changing a setting briefly highlights
 * the affected preview region.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/components/common/Toast';
import { BUILT_IN_DOCUMENT_PRESETS } from '@/lib/presets/builtInPresets';
import type {
  CodeBlockStyle,
  DocumentColors,
  DocumentPreset,
  FileHeaderStyle,
  FooterSlotType,
  HeaderFooterLayout,
  HeadingStyle,
  HeadingStyles,
  LayoutDensity,
  MiscDocumentOptions,
  PageBreakBehavior,
  PageStyle,
  ProjectHeaderStyle,
  ProjectStructureStyle,
  TitlePageStyle,
  TypographyStyle,
  FontWeight,
  Alignment,
  VerticalAlignment,
} from '@/lib/presets/documentPreset';
import {
  getGroupedSyntaxThemes,
  ensureSyntaxThemeCatalog,
} from '@/lib/themes/syntaxThemeRegistry';
import { FontSelector } from '@/components/common/FontSelector';
import { fontStack } from '@/lib/fonts/fontCatalog';
import {
  ChevronDown,
  ChevronRight,
  X,
  Save,
  Copy,
  Trash,
  Download,
  Upload,
  Palette,
  Type,
  Layout,
  Settings as SettingsIcon,
} from '@/components/common/Icons';
import {
  SubGroup,
  Field,
  NumberInput,
  WeightSelect,
  AlignmentSelect,
  Toggle,
  ColorInput,
  AdvancedSection,
  DependentSettings,
  computeHighlightIds,
} from './templateShared';
import { TemplatePreview, type HighlightSignal } from './TemplatePreview';
import { TOKEN_CATALOG } from '@/lib/tokens';
import type { DocumentMetadata } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Section = 'page' | 'fonts' | 'theme' | 'preset';

const SECTIONS: Array<{ id: Section; label: string; icon: any }> = [
  { id: 'page', label: 'Page & Layout', icon: Layout },
  { id: 'fonts', label: 'Fonts Settings', icon: Type },
  { id: 'theme', label: 'Theme Settings', icon: Palette },
  { id: 'preset', label: 'Save Preset', icon: SettingsIcon },
];

const FOOTER_SLOT_OPTIONS: Array<{ value: FooterSlotType; label: string }> = [
  { value: 'none', label: '— Empty —' },
  { value: 'pageNumber', label: 'Page number' },
  { value: 'pageCount', label: 'Page count' },
  { value: 'linesOnPage', label: 'Lines on this page' },
  { value: 'fileName', label: 'File name' },
  { value: 'projectName', label: 'Project name' },
  { value: 'date', label: 'Date' },
  { value: 'text', label: 'Custom text…' },
];

export function TemplateCustomizer({ open, onClose }: Props) {
  const { state, dispatch, allPresets } = useAppState();
  const toast = useToast();
  const [expanded, setExpanded] = useState<Set<Section>>(
    new Set(['page', 'fonts']),
  );
  const [highlight, setHighlight] = useState<HighlightSignal>({ ids: [], nonce: 0 });
  const highlightTimer = useRef<number | null>(null);
  const nonceRef = useRef(0);

  const preset = state.preset;

  // Keep the syntax-theme catalog in sync with the installed Shiki version.
  const [, setCatalogVersion] = useState(0);
  useEffect(() => {
    ensureSyntaxThemeCatalog().then(() => setCatalogVersion((v) => v + 1));
  }, []);

  // Close the editor with the Escape key.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toggleSection = (id: Section) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const flashHighlight = (ids: string[]) => {
    if (ids.length === 0) return;
    nonceRef.current += 1;
    setHighlight({ ids, nonce: nonceRef.current });
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => {
      setHighlight((h) => ({ ids: [], nonce: h.nonce }));
    }, 1000);
  };

  const patchPreset = (patch: Partial<DocumentPreset>) => {
    if (preset.builtIn) {
      // The UI promises "edit creates a copy": maintain ONE stable editable
      // clone per built-in (id `edited-<builtinId>`) so every keystroke
      // updates the same persisted copy instead of spawning new presets.
      const cloneId = `edited-${preset.id}`;
      const existing = state.customPresets.find((p) => p.id === cloneId);
      const base = existing ?? {
        ...preset,
        id: cloneId,
        name: `${preset.name} (edited)`,
        builtIn: false,
      };
      dispatch({
        type: 'UPDATE_CUSTOM_PRESET',
        preset: { ...base, ...patch },
      });
      if (!existing) {
        toast.push({
          kind: 'info',
          title: 'Editable copy created',
          message: `“${preset.name} (edited)” is now active — built-ins stay pristine.`,
        });
      }
    } else {
      // Persist custom-preset edits so they survive reloads.
      dispatch({
        type: 'UPDATE_CUSTOM_PRESET',
        preset: { ...preset, ...patch },
      });
    }
    // Pass the previous preset so group-merging patches (all five heading
    // level objects, the full page group, …) highlight ONLY the sub-objects
    // that actually changed (spec §8/§30).
    const highlightIds = computeHighlightIds(
      patch as Record<string, unknown>,
      undefined,
      preset,
    );
    flashHighlight(highlightIds);
    // The main document preview flashes the SAME regions — one source of
    // truth for change targeting, shared by both previews (spec §13).
    window.dispatchEvent(
      new CustomEvent('codice:flash-regions', { detail: highlightIds }),
    );
  };

  const patchMetadata = (patch: Partial<DocumentMetadata>) => {
    dispatch({ type: 'SET_METADATA', metadata: patch });
    const metadataIds = computeHighlightIds({}, Object.keys(patch));
    flashHighlight(metadataIds);
    window.dispatchEvent(
      new CustomEvent('codice:flash-regions', { detail: metadataIds }),
    );
  };

  const handleDuplicate = () => {
    dispatch({
      type: 'DUPLICATE_PRESET',
      preset,
      newName: `${preset.name} (copy)`,
    });
    toast.push({
      kind: 'success',
      title: 'Preset duplicated',
      message: 'A copy has been added to your custom presets.',
    });
  };

  const handleDelete = () => {
    if (preset.builtIn) {
      toast.push({
        kind: 'warning',
        title: 'Built-in presets cannot be deleted',
        message: 'Duplicate it first to create an editable copy.',
      });
      return;
    }
    if (!confirm(`Delete preset "${preset.name}"?`)) return;
    dispatch({ type: 'DELETE_CUSTOM_PRESET', id: preset.id });
    toast.push({ kind: 'success', title: 'Preset deleted' });
  };

  const handleExport = () => {
    const json = exportPresetJsonLocal(preset);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${preset.name.replace(/\s+/g, '-').toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
    toast.push({ kind: 'success', title: 'Preset exported' });
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        dispatch({
          type: 'IMPORT_CUSTOM_PRESET',
          json: text,
          fallbackName: file.name.replace(/\.json$/i, ''),
        });
        toast.push({ kind: 'success', title: 'Preset imported' });
      } catch (err) {
        toast.push({
          kind: 'error',
          title: 'Import failed',
          message: err instanceof Error ? err.message : 'Invalid JSON file',
        });
      }
    };
    input.click();
  };

  return (
    <div className="codice-print-hidden fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative ml-auto flex h-full w-full max-w-6xl flex-col border-l border-app bg-app shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-app px-4 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-primary">Template Editor</h2>
            <select
              className="select w-56"
              value={preset.id}
              onChange={(e) => {
                const found = allPresets.find((p) => p.id === e.target.value);
                if (found) dispatch({ type: 'SET_PRESET', preset: found });
              }}
            >
              <optgroup label="Built-in">
                {BUILT_IN_DOCUMENT_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
              {state.customPresets.length > 0 && (
                <optgroup label="Custom">
                  {state.customPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {preset.builtIn && (
              <span className="badge">Built-in · edit creates a copy</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handleDuplicate} className="btn-ghost" title="Duplicate">
              <Copy size={14} />
            </button>
            <button onClick={handleExport} className="btn-ghost" title="Export as JSON">
              <Download size={14} />
            </button>
            <button onClick={handleImport} className="btn-ghost" title="Import JSON">
              <Upload size={14} />
            </button>
            {!preset.builtIn && (
              <button onClick={handleDelete} className="btn-danger" title="Delete">
                <Trash size={14} />
              </button>
            )}
            <button onClick={onClose} className="btn-ghost" aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body: split into editor + preview */}
        <div className="flex flex-1 overflow-hidden">
          {/* Editor pane — 4 accordion sections */}
          <div className="flex w-1/2 flex-col border-r border-app">
            <div className="flex-1 overflow-auto">
              {SECTIONS.map((section) => (
                <AccordionSection
                  key={section.id}
                  label={section.label}
                  icon={section.icon}
                  expanded={expanded.has(section.id)}
                  onToggle={() => toggleSection(section.id)}
                >
                  {section.id === 'page' && (
                    <PageLayoutSection
                      preset={preset}
                      metadata={state.metadata}
                      patchPreset={patchPreset}
                      patchMetadata={patchMetadata}
                    />
                  )}
                  {section.id === 'fonts' && (
                    <FontsSection preset={preset} patchPreset={patchPreset} />
                  )}
                  {section.id === 'theme' && (
                    <ThemeSection preset={preset} patchPreset={patchPreset} />
                  )}
                  {section.id === 'preset' && (
                    <PresetSection
                      preset={preset}
                      onSave={(name) => {
                        dispatch({
                          type: 'SAVE_CUSTOM_PRESET',
                          preset: { ...preset, name, builtIn: false },
                        });
                        toast.push({
                          kind: 'success',
                          title: 'Preset saved',
                          message: `"${name}" is now in your custom presets.`,
                        });
                      }}
                      onRename={(name) => {
                        dispatch({
                          type: 'RENAME_CUSTOM_PRESET',
                          id: preset.id,
                          name,
                        });
                        toast.push({ kind: 'success', title: 'Preset renamed' });
                      }}
                    />
                  )}
                </AccordionSection>
              ))}
            </div>
          </div>

          {/* Preview pane — TemplatePreview owns its toolbar + scroll area */}
          <div className="min-h-0 flex-1">
            <TemplatePreview
              preset={preset}
              metadata={state.metadata}
              highlight={highlight}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Accordion ----------------------------- */

function AccordionSection({
  label,
  icon: Icon,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  icon: any;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-app">
      <button
        onClick={onToggle}
        className={`sticky top-0 z-10 flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-primary backdrop-blur transition-colors ${
          expanded ? 'bg-app/95' : 'bg-app/95 hover-surface'
        }`}
        aria-expanded={expanded}
      >
        <span
          className={`inline-flex text-secondary transition-transform duration-200 ${
            expanded ? 'rotate-90' : 'rotate-0'
          }`}
        >
          <ChevronRight size={14} />
        </span>
        <Icon size={14} className="text-secondary" />
        {label}
        {!expanded && (
          <span className="ml-auto text-[10px] font-normal text-muted">
            collapsed
          </span>
        )}
      </button>
      {expanded && <div className="space-y-3 px-4 pb-4 pt-3">{children}</div>}
    </div>
  );
}

/* --------------------------- Page & Layout --------------------------- */

/** A header/footer text input registered for token insertion. */
interface TokenTarget {
  el: HTMLInputElement;
  apply: (value: string) => void;
}

/**
 * Text input that registers itself as the token-insert target while focused.
 * Token chips insert at the caret of the last-focused target.
 */
function TokenInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  onRegister,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  onRegister: (target: TokenTarget | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const applyRef = useRef<(v: string) => void>(onChange);
  useEffect(() => {
    applyRef.current = onChange;
  }, [onChange]);
  return (
    <input
      ref={ref}
      type="text"
      className="input"
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => {
        if (ref.current) {
          onRegister({
            el: ref.current,
            apply: (v: string) => applyRef.current(v),
          });
        }
      }}
      onBlur={() => onRegister(null)}
    />
  );
}

/**
 * Clickable token catalog — inserts the token at the caret of the
 * focused header/footer input. Chips keep focus on the input via
 * preventDefault-on-mousedown so insertion lands at the caret.
 */
function TokenInsertChips({ targetRef }: { targetRef: RefObject<TokenTarget | null> }) {
  const insert = (token: string) => {
    const target = targetRef.current;
    if (!target) return;
    const el = target.el;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + token + el.value.slice(end);
    target.apply(next);
    requestAnimationFrame(() => {
      el.focus();
      try {
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      } catch {
        // detached input — ignore
      }
    });
  };

  return (
    <div
      className="codice-token-chips"
      role="toolbar"
      aria-label="Insert token"
    >
      <span className="text-[10px] text-muted uppercase tracking-wide">Tokens</span>
      {TOKEN_CATALOG.map((t) => (
        <button
          key={t.token}
          type="button"
          className="codice-token-chip"
          title={`${t.description} — e.g. ${t.example}`}
          aria-label={`Insert token ${t.token} (${t.description})`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insert(t.token)}
        >
          {t.token}
        </button>
      ))}
    </div>
  );
}

function PageLayoutSection({
  preset,
  metadata,
  patchPreset,
  patchMetadata,
}: {
  preset: DocumentPreset;
  metadata: DocumentMetadata;
  patchPreset: (p: Partial<DocumentPreset>) => void;
  patchMetadata: (p: Partial<DocumentMetadata>) => void;
}) {
  const p = preset.page;
  const d = preset.layout;
  const pb = preset.pageBreaks;
  const tp = preset.titlePage;
  const ps = preset.projectStructure;
  const fh = preset.fileHeaders;
  const ph = preset.projectHeaders;
  const misc = preset.misc;

  const patchPage = (patch: Partial<PageStyle>) =>
    patchPreset({ page: { ...p, ...patch } });
  const patchLayout = (patch: Partial<LayoutDensity>) =>
    patchPreset({ layout: { ...d, ...patch } });
  const patchPageBreaks = (patch: Partial<PageBreakBehavior>) =>
    patchPreset({ pageBreaks: { ...pb, ...patch } });
  const patchTitlePage = (patch: Partial<TitlePageStyle>) =>
    patchPreset({ titlePage: { ...tp, ...patch } });
  const patchProjectStructure = (patch: Partial<ProjectStructureStyle>) =>
    patchPreset({ projectStructure: { ...ps, ...patch } });
  const patchFileHeaders = (patch: Partial<FileHeaderStyle>) =>
    patchPreset({ fileHeaders: { ...fh, ...patch } });
  const patchProjectHeaders = (patch: Partial<ProjectHeaderStyle>) =>
    patchPreset({ projectHeaders: { ...ph, ...patch } });
  const patchMisc = (patch: Partial<MiscDocumentOptions>) =>
    patchPreset({ misc: { ...misc, ...patch } });

  /** Last-focused header/footer input — the token-chip insert target. */
  const tokenTargetRef = useRef<TokenTarget | null>(null);
  const registerTokenTarget = (t: TokenTarget | null) => {
    tokenTargetRef.current = t;
  };

  const layoutSummary = [
    pb.afterTitlePage && 'title',
    pb.beforeProject && 'project',
    pb.beforeFile && 'file',
    pb.beforeH1 && 'H1',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <>
      {/* ------------------------------ Page ------------------------------ */}
      <SubGroup label="Page">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Page size">
            <select
              className="select"
              value={p.size}
              onChange={(e) => patchPage({ size: e.target.value as any })}
            >
              <option value="A4">A4</option>
              <option value="Letter">Letter</option>
              <option value="Legal">Legal</option>
              <option value="A3">A3</option>
            </select>
          </Field>
          <Field label="Orientation">
            <select
              className="select"
              value={p.landscape ? 'landscape' : 'portrait'}
              onChange={(e) => patchPage({ landscape: e.target.value === 'landscape' })}
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Field label="Top (mm)"><NumberInput value={p.marginTopMm} min={0} onChange={(v) => patchPage({ marginTopMm: v })} /></Field>
          <Field label="Right (mm)"><NumberInput value={p.marginRightMm} min={0} onChange={(v) => patchPage({ marginRightMm: v })} /></Field>
          <Field label="Bottom (mm)"><NumberInput value={p.marginBottomMm} min={0} onChange={(v) => patchPage({ marginBottomMm: v })} /></Field>
          <Field label="Left (mm)"><NumberInput value={p.marginLeftMm} min={0} onChange={(v) => patchPage({ marginLeftMm: v })} /></Field>
        </div>

        <AdvancedSection>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Header spacing (mm)"><NumberInput value={p.headerSpacingMm} min={0} onChange={(v) => patchPage({ headerSpacingMm: v })} /></Field>
            <Field label="Footer spacing (mm)"><NumberInput value={p.footerSpacingMm} min={0} onChange={(v) => patchPage({ footerSpacingMm: v })} /></Field>
          </div>

          {/* Page header layout + content */}
          <Toggle
            label="Show page header"
            checked={p.pageHeaderShow}
            onChange={(v) => patchPage({ pageHeaderShow: v })}
          />
          <DependentSettings enabled={p.pageHeaderShow}>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Header layout">
                <select
                  className="select"
                  value={p.pageHeaderLayout}
                  onChange={(e) => patchPage({ pageHeaderLayout: e.target.value as HeaderFooterLayout })}
                >
                  <option value="single">Single</option>
                  <option value="dual">Dual</option>
                  <option value="triple">Triple</option>
                </select>
              </Field>
              {p.pageHeaderLayout === 'single' && (
                <Field label="Header alignment">
                  <AlignmentSelect
                    value={p.pageHeaderAlign}
                    label="Header alignment"
                    onChange={(v) => patchPage({ pageHeaderAlign: v })}
                  />
                </Field>
              )}
            </div>
            {p.pageHeaderLayout === 'single' ? (
              <Field label="Header text">
                <TokenInput
                  value={p.pageHeaderCenter ?? ''}
                  placeholder="(none)"
                  ariaLabel="Header text"
                  onChange={(e) => patchPage({ pageHeaderCenter: e || null })}
                  onRegister={registerTokenTarget}
                />
              </Field>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {p.pageHeaderLayout === 'triple' && (
                  <Field label="Header center">
                    <TokenInput
                      value={p.pageHeaderCenter ?? ''}
                      ariaLabel="Header center"
                      onChange={(e) => patchPage({ pageHeaderCenter: e || null })}
                      onRegister={registerTokenTarget}
                    />
                  </Field>
                )}
                <Field label="Header left">
                  <TokenInput
                    value={p.pageHeaderLeft ?? ''}
                    ariaLabel="Header left"
                    onChange={(e) => patchPage({ pageHeaderLeft: e || null })}
                    onRegister={registerTokenTarget}
                  />
                </Field>
                <Field label="Header right">
                  <TokenInput
                    value={p.pageHeaderRight ?? ''}
                    ariaLabel="Header right"
                    onChange={(e) => patchPage({ pageHeaderRight: e || null })}
                    onRegister={registerTokenTarget}
                  />
                </Field>
              </div>
            )}
            <TokenInsertChips targetRef={tokenTargetRef} />
          </DependentSettings>

          {/* Page footer layout + content options */}
          <Toggle
            label="Show page footer"
            checked={p.pageFooterShow}
            onChange={(v) => patchPage({ pageFooterShow: v })}
          />
          <DependentSettings enabled={p.pageFooterShow}>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Footer layout">
                <select
                  className="select"
                  value={p.pageFooterLayout}
                  onChange={(e) => patchPage({ pageFooterLayout: e.target.value as HeaderFooterLayout })}
                >
                  <option value="single">Single</option>
                  <option value="dual">Dual</option>
                  <option value="triple">Triple</option>
                </select>
              </Field>
              {p.pageFooterLayout === 'single' && (
                <Field label="Footer alignment">
                  <AlignmentSelect
                    value={p.pageFooterAlign}
                    label="Footer alignment"
                    onChange={(v) => patchPage({ pageFooterAlign: v })}
                  />
                </Field>
              )}
            </div>
            {p.pageFooterLayout === 'single' ? (
              <Field label="Footer content">
                <FooterSlotSelect
                  value={p.pageFooterCenter}
                  onValue={(v) => patchPage({ pageFooterCenter: v })}
                />
              </Field>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Footer left">
                    <FooterSlotSelect
                      value={p.pageFooterLeft}
                      onValue={(v) => patchPage({ pageFooterLeft: v })}
                    />
                  </Field>
                  {p.pageFooterLayout === 'triple' && (
                    <Field label="Footer center">
                      <FooterSlotSelect
                        value={p.pageFooterCenter}
                          onValue={(v) => patchPage({ pageFooterCenter: v })}
                        />
                    </Field>
                  )}
                  <Field label="Footer right">
                    <FooterSlotSelect
                      value={p.pageFooterRight}
                      onValue={(v) => patchPage({ pageFooterRight: v })}
                    />
                  </Field>
                </div>
              </>
            )}
            <Field label="Footer custom text">
              <TokenInput
                value={p.pageFooterText ?? ''}
                placeholder="Page {page} of {pages}"
                ariaLabel="Footer custom text"
                onChange={(e) => patchPage({ pageFooterText: e })}
                onRegister={registerTokenTarget}
              />
            </Field>
            <TokenInsertChips targetRef={tokenTargetRef} />
          </DependentSettings>
        </AdvancedSection>
      </SubGroup>

      {/* --------------------------- Title Page --------------------------- */}
      <SubGroup label="Title Page">
        <Toggle
          label="Include title page"
          checked={tp.enabled}
          onChange={(v) => patchTitlePage({ enabled: v })}
        />
        <DependentSettings enabled={tp.enabled}>
          <AdvancedSection>
            <MetadataFieldRow
              label="Title"
              showChecked={tp.showTitle}
              onShow={(v) => patchTitlePage({ showTitle: v })}
              value={metadata.title ?? ''}
              placeholder="Project Report"
              onChange={(v) => patchMetadata({ title: v })}
            />
            <MetadataFieldRow
              label="Subtitle"
              showChecked={tp.showSubtitle}
              onShow={(v) => patchTitlePage({ showSubtitle: v })}
              value={metadata.subtitle ?? ''}
              placeholder="A Practical Guide…"
              onChange={(v) => patchMetadata({ subtitle: v })}
            />
            <MetadataFieldRow
              label="Author"
              showChecked={tp.showAuthor}
              onShow={(v) => patchTitlePage({ showAuthor: v })}
              value={metadata.author ?? ''}
              placeholder="Jane Doe"
              onChange={(v) => patchMetadata({ author: v })}
            />
            <MetadataFieldRow
              label="Course"
              showChecked={tp.showCourse}
              onShow={(v) => patchTitlePage({ showCourse: v })}
              value={metadata.course ?? ''}
              placeholder="CS 402"
              onChange={(v) => patchMetadata({ course: v })}
            />
            <MetadataFieldRow
              label="University"
              showChecked={tp.showUniversity}
              onShow={(v) => patchTitlePage({ showUniversity: v })}
              value={metadata.university ?? ''}
              placeholder="State University"
              onChange={(v) => patchMetadata({ university: v })}
            />
            <MetadataFieldRow
              label="Date"
              showChecked={tp.showDate}
              onShow={(v) => patchTitlePage({ showDate: v })}
              value={metadata.date ?? ''}
              placeholder="(today)"
              onChange={(v) => patchMetadata({ date: v })}
            />
            <MetadataFieldRow
              label="Version"
              showChecked={tp.showVersion}
              onShow={(v) => patchTitlePage({ showVersion: v })}
              value={metadata.version ?? ''}
              placeholder="v1.0.0"
              onChange={(v) => patchMetadata({ version: v })}
            />
            <MetadataFieldRow
              label="Description"
              showChecked={tp.showDescription}
              onShow={(v) => patchTitlePage({ showDescription: v })}
              value={metadata.description ?? ''}
              placeholder="Short description…"
              onChange={(v) => patchMetadata({ description: v })}
            />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Alignment">
                <AlignmentSelect
                  value={tp.alignment}
                  label="Title page alignment"
                  onChange={(v) => patchTitlePage({ alignment: v })}
                />
              </Field>
              <Field label="Vertical alignment">
                <select
                  className="select"
                  value={tp.verticalAlignment}
                  onChange={(e) => patchTitlePage({ verticalAlignment: e.target.value as VerticalAlignment })}
                >
                  <option value="top">Top</option>
                  <option value="center">Center</option>
                  <option value="bottom">Bottom</option>
                </select>
              </Field>
            </div>
            <Field label="Vertical offset (pt)">
              <NumberInput value={tp.verticalOffsetPt} min={0} onChange={(v) => patchTitlePage({ verticalOffsetPt: v })} />
            </Field>
          </AdvancedSection>
        </DependentSettings>
      </SubGroup>

      {/* ------------------------ Project Structure ------------------------ */}
      <SubGroup label="Project Structure">
        <Toggle
          label="Include project structure"
          checked={ps.enabled}
          onChange={(v) => patchProjectStructure({ enabled: v })}
        />
        <DependentSettings enabled={ps.enabled}>
          <AdvancedSection>
            <Toggle label="Show file sizes" checked={ps.showFileSizes} onChange={(v) => patchProjectStructure({ showFileSizes: v })} />
            <Toggle label="Directories first" checked={ps.dirsFirst} onChange={(v) => patchProjectStructure({ dirsFirst: v })} />
          </AdvancedSection>
        </DependentSettings>
      </SubGroup>

      {/* -------------------------- File Headers -------------------------- */}
      <SubGroup label="File Headers">
        <Toggle
          label="Show file headers"
          checked={fh.show}
          onChange={(v) => patchFileHeaders({ show: v })}
        />
        <DependentSettings enabled={fh.show}>
          <AdvancedSection summary={fh.showFileName || fh.showRelativePath ? '' : 'all off'}>
            <div className="grid grid-cols-2 gap-2">
              <Toggle label="File name" checked={fh.showFileName} onChange={(v) => patchFileHeaders({ showFileName: v })} />
              <Toggle label="Relative path" checked={fh.showRelativePath} onChange={(v) => patchFileHeaders({ showRelativePath: v })} />
              <Toggle label="Language label" checked={fh.showLanguageLabel} onChange={(v) => patchFileHeaders({ showLanguageLabel: v })} />
              <Toggle label="File size" checked={fh.showFileSize} onChange={(v) => patchFileHeaders({ showFileSize: v })} />
              <Toggle label="Line count" checked={fh.showLineCount} onChange={(v) => patchFileHeaders({ showLineCount: v })} />
              <Toggle label="Bold" checked={fh.bold} onChange={(v) => patchFileHeaders({ bold: v })} />
            </div>
          </AdvancedSection>
        </DependentSettings>
      </SubGroup>

      {/* ------------------------- Project Headers ------------------------- */}
      <SubGroup label="Project Headers">
        <Toggle
          label="Show project title"
          checked={ph.showTitle}
          onChange={(v) => patchProjectHeaders({ showTitle: v })}
        />
        <DependentSettings enabled={ph.showTitle}>
          <AdvancedSection>
            <Toggle label="Show project path" checked={ph.showPath} onChange={(v) => patchProjectHeaders({ showPath: v })} />
            <Toggle label="Show metadata" checked={ph.showMetadata} onChange={(v) => patchProjectHeaders({ showMetadata: v })} />
          </AdvancedSection>
        </DependentSettings>
      </SubGroup>

      {/* ------------------------ Table of Contents ------------------------ */}
      <SubGroup label="Table of Contents">
        <Toggle
          label="Include table of contents"
          checked={misc.includeToc}
          onChange={(v) => patchMisc({ includeToc: v })}
        />
        <DependentSettings enabled={misc.includeToc}>
          <AdvancedSection>
            <Toggle label="Number headings" checked={misc.numberHeadings} onChange={(v) => patchMisc({ numberHeadings: v })} />
            <Toggle label="Show file metadata" checked={misc.showFileMetadata} onChange={(v) => patchMisc({ showFileMetadata: v })} />
          </AdvancedSection>
        </DependentSettings>
      </SubGroup>

      {/* -------------------------- Code Behavior -------------------------- */}
      <SubGroup label="Code Behavior">
        <Toggle
          label="Show line numbers"
          checked={preset.code.showLineNumbers}
          onChange={(v) => patchPreset({ code: { ...preset.code, showLineNumbers: v } })}
        />
        <Toggle
          label="Wrap long lines"
          checked={preset.code.wrapLongLines}
          onChange={(v) => patchPreset({ code: { ...preset.code, wrapLongLines: v } })}
        />
      </SubGroup>

      {/* ------------------------ Document Density ------------------------- */}
      <SubGroup label="Document Density">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Body line spacing">
            <NumberInput value={preset.typography.lineSpacing} step={0.05} onChange={(v) => patchPreset({ typography: { ...preset.typography, lineSpacing: v } })} />
          </Field>
          <Field label="Paragraph spacing (pt)">
            <NumberInput value={preset.typography.paragraphSpacingPt} onChange={(v) => patchPreset({ typography: { ...preset.typography, paragraphSpacingPt: v } })} />
          </Field>
          <Field label="Section spacing (pt)"><NumberInput value={d.sectionSpacingPt} onChange={(v) => patchLayout({ sectionSpacingPt: v })} /></Field>
          <Field label="Code spacing before (pt)">
            <NumberInput value={preset.code.blockSpacingBeforePt} onChange={(v) => patchPreset({ code: { ...preset.code, blockSpacingBeforePt: v } })} />
          </Field>
          <Field label="Code spacing after (pt)">
            <NumberInput value={preset.code.blockSpacingAfterPt} onChange={(v) => patchPreset({ code: { ...preset.code, blockSpacingAfterPt: v } })} />
          </Field>
          <Field label="Heading spacing before (pt)">
            <NumberInput
              value={d.headingSpacingBeforePt}
              onChange={(v) =>
                patchPreset({
                  headings: applyToAllHeadings(preset.headings, { spaceBeforePt: v }),
                  layout: { ...d, headingSpacingBeforePt: v },
                })
              }
            />
          </Field>
          <Field label="Heading spacing after (pt)">
            <NumberInput
              value={d.headingSpacingAfterPt}
              onChange={(v) =>
                patchPreset({
                  headings: applyToAllHeadings(preset.headings, { spaceAfterPt: v }),
                  layout: { ...d, headingSpacingAfterPt: v },
                })
              }
            />
          </Field>
          <Field label="Title page offset (pt)">
            <NumberInput value={tp.verticalOffsetPt} min={0} onChange={(v) => patchTitlePage({ verticalOffsetPt: v })} />
          </Field>
          <Field label="File header spacing (pt)">
            <NumberInput value={fh.spacingAfterPt} onChange={(v) => patchFileHeaders({ spacingAfterPt: v })} />
          </Field>
          <Field label="Project header spacing (pt)">
            <NumberInput value={ph.spaceBeforePt} onChange={(v) => patchProjectHeaders({ spaceBeforePt: v })} />
          </Field>
        </div>
      </SubGroup>

      {/* --------------------------- Page Breaks --------------------------- */}
      <SubGroup label="Page Breaks">
        <AdvancedSection summary={layoutSummary ? `${layoutSummary}` : 'none'}>
          <Toggle label="Page break after title page" checked={pb.afterTitlePage} onChange={(v) => patchPageBreaks({ afterTitlePage: v })} />
          <Toggle label="Page break before each project" checked={pb.beforeProject} onChange={(v) => patchPageBreaks({ beforeProject: v })} />
          <Toggle label="Page break before each file" checked={pb.beforeFile} onChange={(v) => patchPageBreaks({ beforeFile: v })} />
          <Toggle label="Page break before H1" checked={pb.beforeH1} onChange={(v) => patchPageBreaks({ beforeH1: v })} />
        </AdvancedSection>
      </SubGroup>
    </>
  );
}

/** Apply a spacing patch to every heading level (Document Density behavior). */
function applyToAllHeadings(
  headings: HeadingStyles,
  patch: Partial<HeadingStyle>,
): HeadingStyles {
  const apply = (h: HeadingStyle): HeadingStyle => ({ ...h, ...patch });
  return {
    title: apply(headings.title),
    h1: apply(headings.h1),
    h2: apply(headings.h2),
    h3: apply(headings.h3),
    h4: apply(headings.h4),
  };
}

/** Show-toggle + value input row for title-page metadata fields. */
function MetadataFieldRow({
  label,
  showChecked,
  onShow,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  showChecked: boolean;
  onShow: (v: boolean) => void;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-end gap-2">
      <div className="pb-1.5">
        <Toggle label={label} checked={showChecked} onChange={onShow} />
      </div>
      <input
        type="text"
        className="input flex-1"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} text`}
      />
    </div>
  );
}

/** Footer slot selector — what to render in this footer region. */
function FooterSlotSelect({
  value,
  onValue,
}: {
  value: FooterSlotType;
  onValue: (v: FooterSlotType) => void;
}) {
  return (
    <select
      className="select"
      value={value}
      onChange={(e) => onValue(e.target.value as FooterSlotType)}
    >
      {FOOTER_SLOT_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/* --------------------------- Fonts Settings --------------------------- */

function FontsSection({
  preset,
  patchPreset,
}: {
  preset: DocumentPreset;
  patchPreset: (p: Partial<DocumentPreset>) => void;
}) {
  const t = preset.typography;
  const c = preset.code;
  const ps = preset.projectStructure;
  const patchTypography = (p: Partial<TypographyStyle>) =>
    patchPreset({ typography: { ...t, ...p } });
  const patchCode = (p: Partial<CodeBlockStyle>) =>
    patchPreset({ code: { ...c, ...p } });
  const patchProjectStructure = (p: Partial<ProjectStructureStyle>) =>
    patchPreset({ projectStructure: { ...ps, ...p } });

  return (
    <>
      <SubGroup label="Body">
        <Field label="Body font">
          <FontSelector value={t.bodyFont} onChange={(v) => patchTypography({ bodyFont: v })} category="body" />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Size (pt)"><NumberInput value={t.bodyFontSizePt} step={0.5} onChange={(v) => patchTypography({ bodyFontSizePt: v })} /></Field>
          <Field label="Weight"><WeightSelect value={t.bodyWeight} onChange={(v) => patchTypography({ bodyWeight: v })} /></Field>
          <Field label="Line spacing"><NumberInput value={t.lineSpacing} step={0.05} onChange={(v) => patchTypography({ lineSpacing: v })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Body text color">
            <ColorInput value={t.bodyColor} onChange={(v) => patchTypography({ bodyColor: v })} />
          </Field>
          <Field label="Paragraph spacing (pt)">
            <NumberInput value={t.paragraphSpacingPt} onChange={(v) => patchTypography({ paragraphSpacingPt: v })} />
          </Field>
        </div>
      </SubGroup>

      <SubGroup label="Headings">
        <HeadingEditor preset={preset} patchPreset={patchPreset} />
      </SubGroup>

      <SubGroup label="Code">
        <Field label="Code font">
          <FontSelector value={c.font} onChange={(v) => patchCode({ font: v })} category="code" />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Size (pt)"><NumberInput value={c.fontSizePt} step={0.5} onChange={(v) => patchCode({ fontSizePt: v })} /></Field>
          <Field label="Weight"><WeightSelect value={c.fontWeight} onChange={(v) => patchCode({ fontWeight: v })} /></Field>
          <Field label="Line height"><NumberInput value={c.lineHeight} step={0.05} onChange={(v) => patchCode({ lineHeight: v })} /></Field>
        </div>
      </SubGroup>

      {/* Project structure typography moved here from Page & Layout (spec §7). */}
      <SubGroup label="Project Structure">
        <Field label="Font">
          <FontSelector value={ps.font} onChange={(v) => patchProjectStructure({ font: v })} category="code" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Size (pt)">
            <NumberInput value={ps.fontSizePt} step={0.5} onChange={(v) => patchProjectStructure({ fontSizePt: v })} />
          </Field>
          <Field label="Line height">
            <NumberInput value={ps.lineHeight} step={0.05} onChange={(v) => patchProjectStructure({ lineHeight: v })} />
          </Field>
        </div>
        <div className="text-[10px] text-muted">
          Color lives under Theme Settings → Document Colors.
        </div>
      </SubGroup>
    </>
  );
}

/** Heading tabbed editor — Title | H1 | H2 | H3 | H4. */
function HeadingEditor({
  preset,
  patchPreset,
}: {
  preset: DocumentPreset;
  patchPreset: (p: Partial<DocumentPreset>) => void;
}) {
  const levels: Array<{ key: keyof HeadingStyles; label: string }> = [
    { key: 'title', label: 'Title' },
    { key: 'h1', label: 'H1' },
    { key: 'h2', label: 'H2' },
    { key: 'h3', label: 'H3' },
    { key: 'h4', label: 'H4' },
  ];
  const [selectedLevel, setSelectedLevel] = useState<keyof HeadingStyles>('h1');

  const h = preset.headings[selectedLevel];
  const patchHeading = (patch: Partial<HeadingStyle>) =>
    patchPreset({
      headings: {
        ...preset.headings,
        [selectedLevel]: { ...h, ...patch },
      },
    });

  return (
    <>
      <Field label="Heading level">
        <div className="flex gap-1" role="tablist" aria-label="Heading level">
          {levels.map((lvl) => (
            <button
              key={lvl.key}
              role="tab"
              aria-selected={selectedLevel === lvl.key}
              onClick={() => setSelectedLevel(lvl.key)}
              className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedLevel === lvl.key
                  ? 'border-[var(--color-accent)] text-accent'
                  : 'border-app text-secondary hover:text-primary hover-surface'
              }`}
            >
              {lvl.label}
            </button>
          ))}
        </div>
      </Field>

      <div className="panel p-3 space-y-2">
        <div className="text-xs font-semibold text-primary">
          {levels.find((l) => l.key === selectedLevel)?.label} settings
        </div>
        <Field label="Font">
          <FontSelector value={h.font} onChange={(v) => patchHeading({ font: v })} category="body" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Size (pt)"><NumberInput value={h.sizePt} step={0.5} onChange={(v) => patchHeading({ sizePt: v })} /></Field>
          <Field label="Weight"><WeightSelect value={h.weight} onChange={(v) => patchHeading({ weight: v })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Alignment">
            <AlignmentSelect value={h.alignment} label="Heading alignment" onChange={(v) => patchHeading({ alignment: v })} />
          </Field>
          <Field label="Color"><ColorInput value={h.color} onChange={(v) => patchHeading({ color: v })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Space before (pt)"><NumberInput value={h.spaceBeforePt} onChange={(v) => patchHeading({ spaceBeforePt: v })} /></Field>
          <Field label="Space after (pt)"><NumberInput value={h.spaceAfterPt} onChange={(v) => patchHeading({ spaceAfterPt: v })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Line height"><NumberInput value={h.lineHeight} step={0.05} onChange={(v) => patchHeading({ lineHeight: v })} /></Field>
          <Field label="Indent (pt)"><NumberInput value={h.indentPt} onChange={(v) => patchHeading({ indentPt: v })} /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Toggle label="Italic" checked={h.italic} onChange={(v) => patchHeading({ italic: v })} />
          {selectedLevel !== 'title' && (
            <Toggle label="Numbered" checked={h.numbered} onChange={(v) => patchHeading({ numbered: v })} />
          )}
          <Toggle label="Keep with next" checked={h.keepWithNext} onChange={(v) => patchHeading({ keepWithNext: v })} />
          <Toggle label="Page break before" checked={h.pageBreakBefore} onChange={(v) => patchHeading({ pageBreakBefore: v })} />
        </div>
      </div>
    </>
  );
}

/* --------------------------- Theme Settings --------------------------- */

function ThemeSection({
  preset,
  patchPreset,
}: {
  preset: DocumentPreset;
  patchPreset: (p: Partial<DocumentPreset>) => void;
}) {
  const grouped = getGroupedSyntaxThemes();
  const c = preset.code;
  const patchCode = (p: Partial<CodeBlockStyle>) =>
    patchPreset({ code: { ...c, ...p } });
  const patchColors = (p: Partial<DocumentColors>) =>
    patchPreset({ colors: { ...preset.colors, ...p } });
  const borderEnabled = c.borderStyle !== 'none';

  return (
    <>
      <SubGroup label="Syntax Theme">
        <Field label="Shiki syntax theme">
          <select
            className="select"
            value={preset.syntaxTheme}
            onChange={(e) => patchPreset({ syntaxTheme: e.target.value })}
          >
            <optgroup label="Light">
              {grouped.light.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </optgroup>
            <optgroup label="Dark">
              {grouped.dark.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </optgroup>
            {grouped.neutral.length > 0 && (
              <optgroup label="Neutral / Special">
                {grouped.neutral.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </optgroup>
            )}
          </select>
          <div className="mt-1 text-[10px] text-muted">
            {grouped.light.length + grouped.dark.length + grouped.neutral.length} themes synced with the installed Shiki version
          </div>
        </Field>
      </SubGroup>

      <SubGroup label="Document Colors">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Background"><ColorInput value={preset.colors.background} onChange={(v) => patchColors({ background: v })} /></Field>
          <Field label="Surface"><ColorInput value={preset.colors.surface} onChange={(v) => patchColors({ surface: v })} /></Field>
          <Field label="Primary text"><ColorInput value={preset.colors.primaryText} onChange={(v) => patchColors({ primaryText: v })} /></Field>
          <Field label="Secondary text"><ColorInput value={preset.colors.secondaryText} onChange={(v) => patchColors({ secondaryText: v })} /></Field>
          <Field label="Muted text"><ColorInput value={preset.colors.mutedText} onChange={(v) => patchColors({ mutedText: v })} /></Field>
          <Field label="Accent"><ColorInput value={preset.colors.accent} onChange={(v) => patchColors({ accent: v })} /></Field>
          <Field label="Headings"><ColorInput value={preset.colors.headings} onChange={(v) => patchColors({ headings: v })} /></Field>
          <Field label="Borders"><ColorInput value={preset.colors.borders} onChange={(v) => patchColors({ borders: v })} /></Field>
          <Field label="Links"><ColorInput value={preset.colors.links} onChange={(v) => patchColors({ links: v })} /></Field>
          <Field label="Success"><ColorInput value={preset.colors.success} onChange={(v) => patchColors({ success: v })} /></Field>
          <Field label="Warning"><ColorInput value={preset.colors.warning} onChange={(v) => patchColors({ warning: v })} /></Field>
          <Field label="Error"><ColorInput value={preset.colors.error} onChange={(v) => patchColors({ error: v })} /></Field>
          {/* Project structure color moved here from Page & Layout (spec §7). */}
          <Field label="Project structure">
            <ColorInput
              value={preset.projectStructure.color}
              onChange={(v) => patchPreset({ projectStructure: { ...preset.projectStructure, color: v } })}
            />
          </Field>
        </div>
      </SubGroup>

      <SubGroup label="Code Theme / Colors">
        <Toggle
          label="Use syntax theme background"
          checked={c.useSyntaxThemeBackground}
          onChange={(v) => patchCode({ useSyntaxThemeBackground: v })}
        />
        {!c.useSyntaxThemeBackground && (
          <Field label="Code background">
            <ColorInput value={c.backgroundColor} onChange={(v) => patchCode({ backgroundColor: v })} />
          </Field>
        )}
        <Field label="Code text fallback (for tokens without Shiki color)">
          <ColorInput value={c.textColor} onChange={(v) => patchCode({ textColor: v })} />
        </Field>
        <Field label="Code header color">
          <ColorInput value={preset.colors.codeHeader} onChange={(v) => patchColors({ codeHeader: v })} />
        </Field>

        {/* Code border: enable checkbox + style (no 'None' option). */}
        <Toggle
          label="Enable border"
          checked={borderEnabled}
          onChange={(v) => patchCode({ borderStyle: v ? 'solid' : 'none' })}
        />
        {borderEnabled && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Border style">
              <select
                className="select"
                aria-label="Border style"
                value={c.borderStyle === 'none' ? 'solid' : c.borderStyle}
                onChange={(e) => patchCode({ borderStyle: e.target.value as 'solid' | 'dotted' | 'dashed' })}
              >
                <option value="solid">Solid</option>
                <option value="dotted">Dotted</option>
                <option value="dashed">Dashed</option>
              </select>
            </Field>
            <Field label="Border width (pt)">
              <NumberInput value={c.borderWidthPt} step={0.5} min={0.5} onChange={(v) => patchCode({ borderWidthPt: v })} />
            </Field>
            <Field label="Border color">
              <ColorInput value={c.borderColor ?? '#d0d7de'} onChange={(v) => patchCode({ borderColor: v || null })} />
            </Field>
          </div>
        )}

        <Field label="Line number color">
          <ColorInput value={c.lineNumberColor} onChange={(v) => patchCode({ lineNumberColor: v })} />
        </Field>
      </SubGroup>
    </>
  );
}

/* --------------------------- Save Preset --------------------------- */

function PresetSection({
  preset,
  onSave,
  onRename,
}: {
  preset: DocumentPreset;
  onSave: (name: string) => void;
  onRename: (name: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <>
      <div className="text-xs text-secondary">
        {preset.builtIn
          ? 'This is a built-in preset. Editing it creates a working copy in your custom presets. Save your changes with a new name.'
          : 'Save changes to this custom preset, or rename it.'}
      </div>
      <Field label={preset.builtIn ? 'Save as new preset' : 'Rename / save copy'}>
        <div className="flex gap-2">
          <input
            type="text"
            className="input"
            placeholder="Preset name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {preset.builtIn ? (
            <button className="btn-primary whitespace-nowrap" onClick={() => { if (name.trim()) { onSave(name.trim()); setName(''); } }} disabled={!name.trim()}>
              <Save size={14} /> Save
            </button>
          ) : (
            <>
              <button className="btn-secondary whitespace-nowrap" onClick={() => { if (name.trim()) { onRename(name.trim()); setName(''); } }} disabled={!name.trim()}>
                Rename
              </button>
              <button className="btn-primary whitespace-nowrap" onClick={() => { if (name.trim()) { onSave(name.trim()); setName(''); } }} disabled={!name.trim()}>
                <Save size={14} /> Copy
              </button>
            </>
          )}
        </div>
      </Field>
    </>
  );
}

/* --------------------------- Helpers --------------------------- */

function exportPresetJsonLocal(preset: DocumentPreset): string {
  const exported = {
    version: 2,
    exportedAt: new Date().toISOString(),
    name: preset.name,
    description: preset.description,
    syntaxTheme: preset.syntaxTheme,
    page: preset.page,
    layout: preset.layout,
    pageBreaks: preset.pageBreaks,
    typography: preset.typography,
    headings: preset.headings,
    code: preset.code,
    fileHeaders: preset.fileHeaders,
    projectHeaders: preset.projectHeaders,
    projectStructure: preset.projectStructure,
    titlePage: preset.titlePage,
    colors: preset.colors,
    misc: preset.misc,
    metadata: preset.metadata,
  };
  return JSON.stringify(exported, null, 2);
}
