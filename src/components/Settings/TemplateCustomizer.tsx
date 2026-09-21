'use client';

/**
 * Codice Template Editor.
 *
 * §17 — the structural page/layout configuration now lives in the Layout
 * studio; this editor owns the STYLING/theme configuration only. Organized
 * into FOUR top-level sections:
 *
 *   ├── Typography & Density — document density (spacing rhythm)
 *   ├── Fonts Settings      — all document typography (body, headings, code,
 *   │                         project structure)
 *   ├── Theme Settings      — syntax theme + document colors + panels + code
 *   │                         colors (title-page typography/colors live in
 *   │                         Fonts → Headings → Title)
 *   └── Save Preset         — preset management
 *
 * Dependent settings are HIDDEN until their parent feature is enabled
 * (not merely disabled). Advanced controls collapse behind "Advanced ▼".
 *
 * The right pane shows a live multi-page preview consuming the SAME
 * `DocumentPreset` as the exporters AND the REAL user document (§15).
 * Changing a setting briefly highlights the affected preview region.
 */

import { useEffect, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/components/common/Toast';
import { BUILT_IN_DOCUMENT_PRESETS } from '@/lib/presets/builtInPresets';
import type {
  CodeBlockStyle,
  DocumentColors,
  DocumentPreset,
  HeadingStyle,
  HeadingStyles,
  LayoutDensity,
  ProjectStructureStyle,
  TypographyStyle,
} from '@/lib/presets/documentPreset';
import {
  getGroupedSyntaxThemes,
  ensureSyntaxThemeCatalog,
} from '@/lib/themes/syntaxThemeRegistry';
import { FontSelector } from '@/components/common/FontSelector';
import {
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
  computeHighlightIds,
} from './templateShared';
import { TemplatePreview, type HighlightSignal } from './TemplatePreview';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Section = 'density' | 'fonts' | 'theme' | 'preset';

const SECTIONS: Array<{ id: Section; label: string; icon: any }> = [
  { id: 'density', label: 'Typography & Density', icon: Layout },
  { id: 'fonts', label: 'Fonts Settings', icon: Type },
  { id: 'theme', label: 'Theme Settings', icon: Palette },
  { id: 'preset', label: 'Save Preset', icon: SettingsIcon },
];

export function TemplateCustomizer({ open, onClose }: Props) {
  const { state, dispatch, allPresets } = useAppState();
  const toast = useToast();
  const [expanded, setExpanded] = useState<Set<Section>>(
    new Set(['fonts']),
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
        {/* Header — wraps on narrow screens so the preset select + buttons
            never overflow (§62 responsive). */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-app px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-primary">Template Editor</h2>
            <select
              className="select w-40 sm:w-56"
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

        {/* Body: split into editor + preview. Stacks vertically below xl
            (§62 responsive) so the preview never squeezes the editor into
            an unusable column on small screens. */}
        <div className="flex flex-1 flex-col overflow-hidden xl:flex-row">
          {/* Editor pane — 4 accordion sections */}
          <div className="flex w-full flex-col border-b border-app xl:w-1/2 xl:border-b-0 xl:border-r">
            <div className="flex-1 overflow-auto">
              {SECTIONS.map((section) => (
                <AccordionSection
                  key={section.id}
                  label={section.label}
                  icon={section.icon}
                  expanded={expanded.has(section.id)}
                  onToggle={() => toggleSection(section.id)}
                >
                  {section.id === 'density' && (
                    <DensitySection preset={preset} patchPreset={patchPreset} />
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

          {/* Preview pane — TemplatePreview owns its toolbar + scroll area.
              min-w-0 is REQUIRED: without it the preview pane's automatic
              flex minimum is the zoomed page width, so zooming in squeezed
              this settings pane (spec §6). */}
          <div className="min-h-0 min-w-0 flex-1">
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

/* ----------------------- Typography & Density ----------------------- */

/**
 * §17 — the document-density controls (the LayoutDensity part of the
 * former Page & Layout section). The structural page/layout configuration
 * now lives in the Layout studio; the spacing RHYTHM stays with the
 * template's styling.
 */
function DensitySection({
  preset,
  patchPreset,
}: {
  preset: DocumentPreset;
  patchPreset: (p: Partial<DocumentPreset>) => void;
}) {
  const d = preset.layout;
  const patchLayout = (patch: Partial<LayoutDensity>) =>
    patchPreset({ layout: { ...d, ...patch } });

  return (
    <>
      <div className="text-xs text-secondary">
        Document density controls the vertical rhythm of the document. Page
        geometry, page breaks and document sections are configured in the
        Layout studio.
      </div>
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
            <NumberInput value={preset.titlePage.verticalOffsetPt} min={0} onChange={(v) => patchPreset({ titlePage: { ...preset.titlePage, verticalOffsetPt: v } })} />
          </Field>
          <Field label="File header spacing (pt)">
            <NumberInput value={preset.fileHeaders.spacingAfterPt} onChange={(v) => patchPreset({ fileHeaders: { ...preset.fileHeaders, spacingAfterPt: v } })} />
          </Field>
          <Field label="Project header spacing (pt)">
            <NumberInput value={preset.projectHeaders.spaceBeforePt} onChange={(v) => patchPreset({ projectHeaders: { ...preset.projectHeaders, spaceBeforePt: v } })} />
          </Field>
        </div>
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
          <Field label="Text color (primary)">
            <ColorInput
              value={preset.colors.primaryText}
              onChange={(v) =>
                // Primary text is the CANONICAL body color (spec §5) — this
                // picker and the Document Colors "Primary text" picker write
                // the same value so the two can never drift apart.
                patchPreset({
                  typography: { ...t, bodyColor: v },
                  colors: { ...preset.colors, primaryText: v },
                })
              }
            />
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
  const patchColors = (p: Partial<DocumentColors>) => {
    // spec §5 semantic wiring:
    //   - Primary text IS the body copy color — keep typography in lockstep.
    //   - The Headings document color broadcasts to EVERY heading level
    //     (Title + H1–H4) so changing it visibly recolors all headings.
    const extra: Partial<DocumentPreset> = {};
    if (p.primaryText !== undefined && p.primaryText !== preset.typography.bodyColor) {
      extra.typography = { ...preset.typography, bodyColor: p.primaryText };
    }
    if (p.headings !== undefined && p.headings !== preset.colors.headings) {
      extra.headings = applyToAllHeadings(preset.headings, { color: p.headings });
    }
    patchPreset({ ...extra, colors: { ...preset.colors, ...p } });
  };
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

        {/* §25 — panel theme colors: layout panels without their own style
            fall back to these defaults. */}
        <div className="mt-2 border-t border-app pt-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Panels (layout containers)
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Panel fill"><ColorInput value={preset.colors.panelFill} onChange={(v) => patchColors({ panelFill: v })} /></Field>
            <Field label="Panel border"><ColorInput value={preset.colors.panelBorder} onChange={(v) => patchColors({ panelBorder: v })} /></Field>
            <Field label="Panel text"><ColorInput value={preset.colors.panelText} onChange={(v) => patchColors({ panelText: v })} /></Field>
          </div>
          <PanelOverrides />
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


/**
 * §25 — per-panel style overrides. Lists every panel/columns node of the
 * APPLIED layout template (stable node id — never the visible label), so
 * two panels with identical text stay independently addressable. Edits
 * write the node's style back to the template.
 */
function PanelOverrides() {
  const { state, dispatch } = useAppState();
  const applied = state.customLayouts.find((t) => t.id === state.appliedLayoutId);
  const panels: Array<{
    nodeId: string;
    kind: 'panel' | 'columns';
    section: string;
    fillColor?: string | null;
    borderColor?: string | null;
    textColor?: string;
  }> = [];
  if (applied) {
    for (const rootChild of applied.rootChildren) {
      if (rootChild.kind !== 'section') continue;
      const section = rootChild.section;
      for (const child of section.children) {
        if (child.kind !== 'node') continue;
        if (child.node.type === 'panel' || child.node.type === 'columns') {
          panels.push({
            nodeId: child.node.id,
            kind: child.node.type,
            section: section.name,
            fillColor: child.node.style?.fillColor,
            borderColor: child.node.style?.borderColor,
            textColor: child.node.style?.textColor,
          });
        }
      }
    }
    for (const rootChild of applied.rootChildren) {
      if (rootChild.kind !== 'node') continue;
      if (rootChild.node.type === 'panel' || rootChild.node.type === 'columns') {
        panels.push({
          nodeId: rootChild.node.id,
          kind: rootChild.node.type,
          section: '(document content)',
          fillColor: rootChild.node.style?.fillColor,
          borderColor: rootChild.node.style?.borderColor,
          textColor: rootChild.node.style?.textColor,
        });
      }
    }
  }

  if (!applied || panels.length === 0) {
    return (
      <p className="mt-1 text-[10px] text-muted">
        Apply a layout that contains panels to style them individually here.
      </p>
    );
  }

  const patchNodeStyle = (nodeId: string, patch: { fillColor?: string; borderColor?: string; textColor?: string }) => {
    const next = JSON.parse(JSON.stringify(applied)) as typeof applied;
    const visit = (nodes: Array<{ id: string; type: string; style?: Record<string, unknown> }>) => {
      for (const node of nodes) {
        if (node.id === nodeId) {
          node.style = { ...(node.style ?? {}), ...patch };
        }
      }
    };
    const visitChildren = (children: Array<{ kind: 'node' | 'block'; node?: { id: string; type: string; style?: Record<string, unknown> } }>) => {
      for (const child of children) {
        if (child.kind === 'node' && child.node) {
          if (child.node.id === nodeId) {
            child.node.style = { ...(child.node.style ?? {}), ...patch };
          }
        }
      }
    };
    for (const rootChild of next.rootChildren) {
      if (rootChild.kind === 'section') {
        visitChildren(rootChild.section.children as never);
      } else if (rootChild.node.id === nodeId) {
        rootChild.node.style = { ...(rootChild.node.style ?? {}), ...patch };
      }
    }
    void visit;
    dispatch({ type: 'UPDATE_CUSTOM_LAYOUT', template: next });
  };

  return (
    <div className="mt-2 space-y-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
        Individual panels ({panels.length}) — identified by stable node id
      </div>
      {panels.map((panel, i) => (
        <div key={panel.nodeId} className="flex flex-wrap items-center gap-2 rounded border border-app px-2 py-1.5">
          <span className="min-w-0 flex-1 text-[11px] text-secondary">
            <span className="font-medium text-primary">{panel.kind === 'panel' ? 'Panel' : 'Columns'} {i + 1}</span>
            <span className="ml-1 text-muted">in {panel.section}</span>
            <span className="ml-1 font-mono text-[9px] text-muted" title={panel.nodeId}>{panel.nodeId.slice(0, 10)}…</span>
          </span>
          <label className="flex items-center gap-1 text-[10px] text-muted">
            fill
            <input
              type="color"
              className="h-6 w-8 cursor-pointer rounded border border-app bg-transparent p-0"
              value={panel.fillColor ?? '#f6f8fa'}
              aria-label={`Panel ${i + 1} fill color`}
              onChange={(e) => patchNodeStyle(panel.nodeId, { fillColor: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-muted">
            border
            <input
              type="color"
              className="h-6 w-8 cursor-pointer rounded border border-app bg-transparent p-0"
              value={panel.borderColor ?? '#d0d7de'}
              aria-label={`Panel ${i + 1} border color`}
              onChange={(e) => patchNodeStyle(panel.nodeId, { borderColor: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-muted">
            text
            <input
              type="color"
              className="h-6 w-8 cursor-pointer rounded border border-app bg-transparent p-0"
              value={panel.textColor ?? '#1f2328'}
              aria-label={`Panel ${i + 1} text color`}
              onChange={(e) => patchNodeStyle(panel.nodeId, { textColor: e.target.value })}
            />
          </label>
        </div>
      ))}
    </div>
  );
}