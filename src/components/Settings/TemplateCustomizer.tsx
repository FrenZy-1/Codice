/**
 * Codice Template Editor.
 *
 * Organized into exactly FIVE top-level sections:
 *
 *   ├── Page & Layout     — geometry, spacing, page behavior
 *   ├── Fonts Settings    — all document typography (body, headings, code)
 *   ├── Theme Settings    — syntax theme + document colors + code colors
 *   ├── Document & Misc   — title page, structure, file/project headers, misc
 *   └── Save Preset       — preset management
 *
 * The heading tabbed editor (Title | H1 | H2 | H3 | H4) lives inside
 * Fonts Settings → Headings.
 *
 * The right pane shows a live preview consuming the SAME `DocumentPreset`
 * state as the exporters. The preview uses real Shiki highlighting.
 */

import { useEffect, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/components/common/Toast';
import { BUILT_IN_DOCUMENT_PRESETS } from '@/lib/presets/builtInPresets';
import type {
  CodeBlockStyle,
  DocumentColors,
  DocumentPreset,
  FileHeaderStyle,
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
} from '@/lib/presets/documentPreset';
import {
  getGroupedSyntaxThemes,
  findSyntaxTheme,
  resolveSyntaxTheme,
} from '@/lib/themes/syntaxThemeRegistry';
import { FontSelector } from '@/components/common/FontSelector';
import {
  highlightFile,
  getThemeColors,
} from '@/lib/highlight/highlighter';
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
  FileText,
  FolderCog,
  Type,
  Layout,
  Settings as SettingsIcon,
} from '@/components/common/Icons';
import type { HighlightedFile } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Section = 'page' | 'fonts' | 'theme' | 'misc' | 'preset';

const SECTIONS: Array<{ id: Section; label: string; icon: any }> = [
  { id: 'page', label: 'Page & Layout', icon: Layout },
  { id: 'fonts', label: 'Fonts Settings', icon: Type },
  { id: 'theme', label: 'Theme Settings', icon: Palette },
  { id: 'misc', label: 'Document & Misc', icon: FolderCog },
  { id: 'preset', label: 'Save Preset', icon: SettingsIcon },
];

export function TemplateCustomizer({ open, onClose }: Props) {
  const { state, dispatch, allPresets } = useAppState();
  const toast = useToast();
  const [expanded, setExpanded] = useState<Set<Section>>(
    new Set(['page', 'fonts']),
  );

  const preset = state.preset;

  if (!open) return null;

  const toggleSection = (id: Section) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const patchPreset = (patch: Partial<DocumentPreset>) => {
    dispatch({ type: 'UPDATE_PRESET', patch });
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
    <div className="fixed inset-0 z-50 flex">
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
          {/* Editor pane — 5 accordion sections */}
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
                    <PageLayoutSection preset={preset} patchPreset={patchPreset} />
                  )}
                  {section.id === 'fonts' && (
                    <FontsSection preset={preset} patchPreset={patchPreset} />
                  )}
                  {section.id === 'theme' && (
                    <ThemeSection preset={preset} patchPreset={patchPreset} />
                  )}
                  {section.id === 'misc' && (
                    <MiscSection preset={preset} patchPreset={patchPreset} />
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

          {/* Preview pane */}
          <div className="flex-1 overflow-auto p-4">
            <TemplatePreview preset={preset} />
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
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-primary hover-surface"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown size={14} className="text-secondary" />
        ) : (
          <ChevronRight size={14} className="text-secondary" />
        )}
        <Icon size={14} className="text-secondary" />
        {label}
      </button>
      {expanded && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

/* --------------------------- Page & Layout --------------------------- */

function PageLayoutSection({
  preset,
  patchPreset,
}: {
  preset: DocumentPreset;
  patchPreset: (p: Partial<DocumentPreset>) => void;
}) {
  const p = preset.page;
  const d = preset.layout;
  const pb = preset.pageBreaks;
  const patchPage = (patch: Partial<PageStyle>) =>
    patchPreset({ page: { ...p, ...patch } });
  const patchLayout = (patch: Partial<LayoutDensity>) =>
    patchPreset({ layout: { ...d, ...patch } });
  const patchPageBreaks = (patch: Partial<PageBreakBehavior>) =>
    patchPreset({ pageBreaks: { ...pb, ...patch } });

  return (
    <>
      <SubGroup label="Page">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Page size">
            <select className="select" value={p.size} onChange={(e) => patchPage({ size: e.target.value as any })}>
              <option value="A4">A4</option>
              <option value="Letter">Letter</option>
              <option value="Legal">Legal</option>
              <option value="A3">A3</option>
            </select>
          </Field>
          <Field label="Orientation">
            <select className="select" value={p.landscape ? 'landscape' : 'portrait'} onChange={(e) => patchPage({ landscape: e.target.value === 'landscape' })}>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Field label="Top (mm)"><NumberInput value={p.marginTopMm} onChange={(v) => patchPage({ marginTopMm: v })} /></Field>
          <Field label="Right (mm)"><NumberInput value={p.marginRightMm} onChange={(v) => patchPage({ marginRightMm: v })} /></Field>
          <Field label="Bottom (mm)"><NumberInput value={p.marginBottomMm} onChange={(v) => patchPage({ marginBottomMm: v })} /></Field>
          <Field label="Left (mm)"><NumberInput value={p.marginLeftMm} onChange={(v) => patchPage({ marginLeftMm: v })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Header spacing (mm)"><NumberInput value={p.headerSpacingMm} onChange={(v) => patchPage({ headerSpacingMm: v })} /></Field>
          <Field label="Footer spacing (mm)"><NumberInput value={p.footerSpacingMm} onChange={(v) => patchPage({ footerSpacingMm: v })} /></Field>
        </div>
        <Field label="Page header text">
          <input type="text" className="input" placeholder="(none)" value={p.pageHeader ?? ''} onChange={(e) => patchPage({ pageHeader: e.target.value || null })} />
        </Field>
        <Field label="Page footer text">
          <input type="text" className="input" placeholder="Page {page} of {pages}" value={p.pageFooter ?? ''} onChange={(e) => patchPage({ pageFooter: e.target.value || null })} />
        </Field>
      </SubGroup>

      <SubGroup label="Document Density">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Body line spacing"><NumberInput value={d.bodyLineSpacing} step={0.05} onChange={(v) => patchLayout({ bodyLineSpacing: v })} /></Field>
          <Field label="Paragraph spacing (pt)"><NumberInput value={d.bodyParagraphSpacingPt} onChange={(v) => patchLayout({ bodyParagraphSpacingPt: v })} /></Field>
          <Field label="Section spacing (pt)"><NumberInput value={d.sectionSpacingPt} onChange={(v) => patchLayout({ sectionSpacingPt: v })} /></Field>
          <Field label="Code spacing before (pt)"><NumberInput value={d.codeBlockSpacingBeforePt} onChange={(v) => patchLayout({ codeBlockSpacingBeforePt: v })} /></Field>
          <Field label="Code spacing after (pt)"><NumberInput value={d.codeBlockSpacingAfterPt} onChange={(v) => patchLayout({ codeBlockSpacingAfterPt: v })} /></Field>
          <Field label="Heading spacing before (pt)"><NumberInput value={d.headingSpacingBeforePt} onChange={(v) => patchLayout({ headingSpacingBeforePt: v })} /></Field>
          <Field label="Heading spacing after (pt)"><NumberInput value={d.headingSpacingAfterPt} onChange={(v) => patchLayout({ headingSpacingAfterPt: v })} /></Field>
          <Field label="Title page offset (pt)"><NumberInput value={d.titlePageVerticalOffsetPt} onChange={(v) => patchLayout({ titlePageVerticalOffsetPt: v })} /></Field>
          <Field label="File header spacing (pt)"><NumberInput value={d.fileHeaderSpacingPt} onChange={(v) => patchLayout({ fileHeaderSpacingPt: v })} /></Field>
          <Field label="Project header before (pt)"><NumberInput value={d.projectHeaderSpacingBeforePt} onChange={(v) => patchLayout({ projectHeaderSpacingBeforePt: v })} /></Field>
        </div>
      </SubGroup>

      <SubGroup label="Page Breaks">
        <Toggle label="Page break after title page" checked={pb.afterTitlePage} onChange={(v) => patchPageBreaks({ afterTitlePage: v })} />
        <Toggle label="Page break before each project" checked={pb.beforeProject} onChange={(v) => patchPageBreaks({ beforeProject: v })} />
        <Toggle label="Page break before each file" checked={pb.beforeFile} onChange={(v) => patchPageBreaks({ beforeFile: v })} />
        <Toggle label="Page break before H1" checked={pb.beforeH1} onChange={(v) => patchPageBreaks({ beforeH1: v })} />
      </SubGroup>
    </>
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
  const patchTypography = (p: Partial<TypographyStyle>) =>
    patchPreset({ typography: { ...t, ...p } });
  const patchCode = (p: Partial<CodeBlockStyle>) =>
    patchPreset({ code: { ...c, ...p } });

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
        <Field label="Body text color">
          <ColorInput value={t.bodyColor} onChange={(v) => patchTypography({ bodyColor: v })} />
        </Field>
        <Field label="Paragraph spacing (pt)">
          <NumberInput value={t.paragraphSpacingPt} onChange={(v) => patchTypography({ paragraphSpacingPt: v })} />
        </Field>
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
            <select className="select" value={h.alignment} onChange={(e) => patchHeading({ alignment: e.target.value as Alignment })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
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
            {grouped.light.length + grouped.dark.length + grouped.neutral.length} themes from Shiki
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
        <Field label="Code border">
          <div className="flex items-center gap-2">
            <select
              className="select flex-shrink-0 w-32"
              value={c.borderStyle}
              onChange={(e) => patchCode({ borderStyle: e.target.value as 'none' | 'solid' })}
            >
              <option value="none">None</option>
              <option value="solid">Solid</option>
            </select>
            {c.borderStyle === 'solid' && (
              <>
                <ColorInput value={c.borderColor ?? ''} onChange={(v) => patchCode({ borderColor: v || null })} allowEmpty />
                <NumberInput value={c.borderWidthPt} step={0.5} onChange={(v) => patchCode({ borderWidthPt: v })} />
              </>
            )}
          </div>
        </Field>
        <Field label="Line number color">
          <ColorInput value={c.lineNumberColor} onChange={(v) => patchCode({ lineNumberColor: v })} />
        </Field>
      </SubGroup>
    </>
  );
}

/* --------------------------- Document & Misc --------------------------- */

function MiscSection({
  preset,
  patchPreset,
}: {
  preset: DocumentPreset;
  patchPreset: (p: Partial<DocumentPreset>) => void;
}) {
  const tp = preset.titlePage;
  const fh = preset.fileHeaders;
  const ph = preset.projectHeaders;
  const ps = preset.projectStructure;
  const misc = preset.misc;

  const patchTitlePage = (patch: Partial<TitlePageStyle>) =>
    patchPreset({ titlePage: { ...tp, ...patch } });
  const patchFileHeaders = (patch: Partial<FileHeaderStyle>) =>
    patchPreset({ fileHeaders: { ...fh, ...patch } });
  const patchProjectHeaders = (patch: Partial<ProjectHeaderStyle>) =>
    patchPreset({ projectHeaders: { ...ph, ...patch } });
  const patchProjectStructure = (patch: Partial<ProjectStructureStyle>) =>
    patchPreset({ projectStructure: { ...ps, ...patch } });
  const patchMisc = (patch: Partial<MiscDocumentOptions>) =>
    patchPreset({ misc: { ...misc, ...patch } });

  return (
    <>
      <SubGroup label="Title Page">
        <Toggle label="Enable title page" checked={tp.enabled} onChange={(v) => patchTitlePage({ enabled: v })} />
        <div className="grid grid-cols-2 gap-2">
          <Toggle label="Title" checked={tp.showTitle} onChange={(v) => patchTitlePage({ showTitle: v })} />
          <Toggle label="Subtitle" checked={tp.showSubtitle} onChange={(v) => patchTitlePage({ showSubtitle: v })} />
          <Toggle label="Author" checked={tp.showAuthor} onChange={(v) => patchTitlePage({ showAuthor: v })} />
          <Toggle label="Course" checked={tp.showCourse} onChange={(v) => patchTitlePage({ showCourse: v })} />
          <Toggle label="University" checked={tp.showUniversity} onChange={(v) => patchTitlePage({ showUniversity: v })} />
          <Toggle label="Date" checked={tp.showDate} onChange={(v) => patchTitlePage({ showDate: v })} />
          <Toggle label="Version" checked={tp.showVersion} onChange={(v) => patchTitlePage({ showVersion: v })} />
          <Toggle label="Description" checked={tp.showDescription} onChange={(v) => patchTitlePage({ showDescription: v })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Alignment">
            <select className="select" value={tp.alignment} onChange={(e) => patchTitlePage({ alignment: e.target.value as Alignment })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </Field>
          <Field label="Vertical offset (pt)">
            <NumberInput value={tp.verticalOffsetPt} onChange={(v) => patchTitlePage({ verticalOffsetPt: v })} />
          </Field>
        </div>
      </SubGroup>

      <SubGroup label="Project Structure">
        <Toggle label="Include project structure tree" checked={ps.enabled} onChange={(v) => patchProjectStructure({ enabled: v })} />
        <Toggle label="Show file sizes" checked={ps.showFileSizes} onChange={(v) => patchProjectStructure({ showFileSizes: v })} />
        <Toggle label="Directories first" checked={ps.dirsFirst} onChange={(v) => patchProjectStructure({ dirsFirst: v })} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Font">
            <FontSelector value={ps.font} onChange={(v) => patchProjectStructure({ font: v })} category="code" />
          </Field>
          <Field label="Size (pt)">
            <NumberInput value={ps.fontSizePt} step={0.5} onChange={(v) => patchProjectStructure({ fontSizePt: v })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Color"><ColorInput value={ps.color} onChange={(v) => patchProjectStructure({ color: v })} /></Field>
          <Field label="Line height"><NumberInput value={ps.lineHeight} step={0.05} onChange={(v) => patchProjectStructure({ lineHeight: v })} /></Field>
        </div>
      </SubGroup>

      <SubGroup label="File Headers">
        <Toggle label="Show file headers" checked={fh.show} onChange={(v) => patchFileHeaders({ show: v })} />
        <div className="grid grid-cols-2 gap-2">
          <Toggle label="File name" checked={fh.showFileName} onChange={(v) => patchFileHeaders({ showFileName: v })} />
          <Toggle label="Relative path" checked={fh.showRelativePath} onChange={(v) => patchFileHeaders({ showRelativePath: v })} />
          <Toggle label="Language label" checked={fh.showLanguageLabel} onChange={(v) => patchFileHeaders({ showLanguageLabel: v })} />
          <Toggle label="File size" checked={fh.showFileSize} onChange={(v) => patchFileHeaders({ showFileSize: v })} />
          <Toggle label="Line count" checked={fh.showLineCount} onChange={(v) => patchFileHeaders({ showLineCount: v })} />
          <Toggle label="Bold" checked={fh.bold} onChange={(v) => patchFileHeaders({ bold: v })} />
        </div>
      </SubGroup>

      <SubGroup label="Project Headers">
        <Toggle label="Show project title" checked={ph.showTitle} onChange={(v) => patchProjectHeaders({ showTitle: v })} />
        <Toggle label="Show project path" checked={ph.showPath} onChange={(v) => patchProjectHeaders({ showPath: v })} />
        <Toggle label="Show metadata" checked={ph.showMetadata} onChange={(v) => patchProjectHeaders({ showMetadata: v })} />
      </SubGroup>

      <SubGroup label="Misc">
        <Toggle label="Include table of contents" checked={misc.includeToc} onChange={(v) => patchMisc({ includeToc: v })} />
        <Toggle label="Number headings" checked={misc.numberHeadings} onChange={(v) => patchMisc({ numberHeadings: v })} />
        <Toggle label="Show file metadata" checked={misc.showFileMetadata} onChange={(v) => patchMisc({ showFileMetadata: v })} />
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

/* --------------------------- Live Preview --------------------------- */

function TemplatePreview({ preset }: { preset: DocumentPreset }) {
  const resolvedTheme = resolveSyntaxTheme(preset.syntaxTheme);
  const [highlighted, setHighlighted] = useState<HighlightedFile | null>(null);
  const [themeColors, setThemeColors] = useState({
    background: '#0d1117',
    foreground: '#e6edf3',
  });

  const sampleSource = `fun main() {
    println("Hello, Codice!")
    val numbers = listOf(1, 2, 3, 4, 5)
    val sum = numbers.sum()
    println("Sum: $sum")
}

// A very long line that demonstrates how the code block handles overflow when wrapping is disabled by the preset configuration.
data class User(val name: String, val age: Int)`;

  useEffect(() => {
    let cancelled = false;
    getThemeColors(resolvedTheme).then((c) => {
      if (!cancelled) setThemeColors(c);
    });
    highlightFile(
      'preview-sample',
      'Main.kt',
      'kotlin',
      sampleSource,
      resolvedTheme,
    ).then((h) => {
      if (!cancelled) setHighlighted(h);
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedTheme]);

  const effectiveBg = preset.code.useSyntaxThemeBackground
    ? themeColors.background
    : preset.code.backgroundColor;
  const fallbackFg = preset.code.useSyntaxThemeBackground
    ? themeColors.foreground
    : preset.code.textColor;

  const lineNumberWidth =
    preset.code.lineNumberWidthChars > 0
      ? preset.code.lineNumberWidthChars
      : highlighted
        ? String(highlighted.lines.length).length
        : 2;

  // Compute the border style — 'none' truly disables it.
  const codeBorderStyle =
    preset.code.borderStyle === 'none' || !preset.code.borderColor
      ? 'none'
      : `${preset.code.borderWidthPt}px solid ${preset.code.borderColor}`;

  // Page break markers for the preview.
  const pageBreakMarkers: Array<{ label: string; key: string }> = [];
  if (preset.pageBreaks.afterTitlePage && preset.titlePage.enabled) {
    pageBreakMarkers.push({ label: 'PAGE BREAK — after title page', key: 'after-title' });
  }

  return (
    <div
      className="mx-auto rounded-lg shadow-xl"
      style={{
        background: preset.colors.background,
        color: preset.colors.primaryText,
        padding: `${preset.page.marginTopMm * 2}px ${preset.page.marginRightMm * 2}px ${preset.page.marginBottomMm * 2}px ${preset.page.marginLeftMm * 2}px`,
        fontFamily: fontStack(preset.typography.bodyFont),
        fontSize: preset.typography.bodyFontSizePt,
        fontWeight: WEIGHT_MAP[preset.typography.bodyWeight],
        maxWidth: 500,
      }}
    >
      {/* Page header — rendered at the top of the page */}
      {preset.page.pageHeader && (
        <div
          style={{
            color: preset.colors.mutedText,
            fontSize: 10,
            textAlign: 'right',
            marginBottom: preset.page.headerSpacingMm * 2,
            borderBottom: `0.5px solid ${preset.colors.borders}`,
            paddingBottom: 4,
          }}
        >
          {preset.page.pageHeader}
        </div>
      )}

      {/* Title page preview */}
      {preset.titlePage.enabled && (
        <div
          style={{
            textAlign: preset.titlePage.alignment,
            marginTop: preset.titlePage.verticalOffsetPt,
            marginBottom: preset.layout.sectionSpacingPt,
            paddingBottom: 16,
            borderBottom: `1px solid ${preset.colors.borders}`,
          }}
        >
          {preset.titlePage.showTitle && (
            <div
              style={{
                fontFamily: fontStack(preset.headings.title.font),
                fontSize: preset.headings.title.sizePt,
                fontWeight: WEIGHT_MAP[preset.headings.title.weight],
                fontStyle: preset.headings.title.italic ? 'italic' : 'normal',
                color: preset.headings.title.color,
                textAlign: preset.headings.title.alignment,
                lineHeight: preset.headings.title.lineHeight,
              }}
            >
              {preset.metadata?.title || 'Project Report'}
            </div>
          )}
          {preset.titlePage.showSubtitle && (preset.metadata?.description || preset.metadata?.course) && (
            <div style={{ color: preset.colors.secondaryText, fontSize: preset.typography.bodyFontSizePt + 1, marginTop: 8 }}>
              {preset.metadata?.course || 'A subtitle goes here'}
            </div>
          )}
          {preset.titlePage.showAuthor && preset.metadata?.author && (
            <div style={{ color: preset.colors.secondaryText, fontSize: preset.typography.bodyFontSizePt, marginTop: 12 }}>
              by {preset.metadata.author}
            </div>
          )}
          {preset.titlePage.showCourse && preset.metadata?.course && (
            <div style={{ color: preset.colors.mutedText, fontSize: 12, marginTop: 6 }}>
              {preset.metadata.course}
            </div>
          )}
          {preset.titlePage.showUniversity && preset.metadata?.university && (
            <div style={{ color: preset.colors.mutedText, fontSize: 12, marginTop: 4 }}>
              {preset.metadata.university}
            </div>
          )}
          {preset.titlePage.showDate && (
            <div style={{ color: preset.colors.mutedText, fontSize: 11, marginTop: 24 }}>
              {preset.metadata?.date || `Generated: ${new Date().toLocaleDateString()}`}
            </div>
          )}
          {preset.titlePage.showVersion && preset.metadata?.version && (
            <div style={{ color: preset.colors.mutedText, fontSize: 11, marginTop: 4 }}>
              Version: {preset.metadata.version}
            </div>
          )}
          {preset.titlePage.showDescription && preset.metadata?.description && (
            <div style={{ color: preset.colors.secondaryText, fontSize: 12, maxWidth: 400, margin: '24px auto 0' }}>
              {preset.metadata.description}
            </div>
          )}
        </div>
      )}

      {/* Page break marker */}
      {pageBreakMarkers.map((m) => (
        <PageBreakMarker key={m.key} label={m.label} color={preset.colors.borders} />
      ))}

      {/* TOC preview */}
      {preset.misc.includeToc && (
        <div style={{ marginBottom: preset.layout.sectionSpacingPt }}>
          <div
            style={{
              fontFamily: fontStack(preset.headings.h1.font),
              fontSize: preset.headings.h1.sizePt,
              fontWeight: WEIGHT_MAP[preset.headings.h1.weight],
              fontStyle: preset.headings.h1.italic ? 'italic' : 'normal',
              color: preset.headings.h1.color,
              marginBottom: 8,
            }}
          >
            Table of Contents
          </div>
          <div style={{ fontSize: 11, color: preset.colors.secondaryText, marginLeft: 16 }}>
            1.1  src/Main.kt
          </div>
        </div>
      )}

      {/* Project header */}
      {preset.projectHeaders.showTitle && (
        <div
          style={{
            fontFamily: fontStack(preset.projectHeaders.font),
            fontSize: preset.projectHeaders.sizePt,
            fontWeight: WEIGHT_MAP[preset.projectHeaders.weight],
            color: preset.projectHeaders.color,
            textTransform: preset.projectHeaders.uppercase ? 'uppercase' : 'none',
            textAlign: preset.projectHeaders.alignment,
            marginTop: preset.projectHeaders.spaceBeforePt,
            marginBottom: preset.projectHeaders.spaceAfterPt,
          }}
        >
          1. Sample Project
        </div>
      )}
      {preset.projectHeaders.showPath && (
        <div style={{ fontSize: 10, color: preset.colors.mutedText, marginBottom: 4 }}>
          Path: /sample-project
        </div>
      )}
      {preset.projectHeaders.showMetadata && (
        <div style={{ fontSize: 10, color: preset.colors.mutedText, marginBottom: preset.layout.projectHeaderSpacingAfterPt }}>
          Files: 1 · Size: 0.4 KB
        </div>
      )}

      {/* Project structure */}
      {preset.projectStructure.enabled && (
        <div style={{ marginBottom: preset.layout.sectionSpacingPt }}>
          <div
            style={{
              fontFamily: fontStack(preset.headings.h2.font),
              fontSize: preset.headings.h2.sizePt,
              fontWeight: WEIGHT_MAP[preset.headings.h2.weight],
              fontStyle: preset.headings.h2.italic ? 'italic' : 'normal',
              color: preset.headings.h2.color,
              marginBottom: 8,
            }}
          >
            {preset.misc.numberHeadings && preset.headings.h2.numbered ? '1.1 ' : ''}Project Structure
          </div>
          <div
            style={{
              fontFamily: fontStack(preset.projectStructure.font),
              fontSize: preset.projectStructure.fontSizePt,
              color: preset.projectStructure.color,
              whiteSpace: 'pre',
              lineHeight: preset.projectStructure.lineHeight,
            }}
          >
{`└── src/
    └── Main.kt`}
          </div>
        </div>
      )}

      {/* H1 — Source Files */}
      <div
        style={{
          fontFamily: fontStack(preset.headings.h1.font),
          fontSize: preset.headings.h1.sizePt,
          fontWeight: WEIGHT_MAP[preset.headings.h1.weight],
          fontStyle: preset.headings.h1.italic ? 'italic' : 'normal',
          color: preset.headings.h1.color,
          textAlign: preset.headings.h1.alignment,
          marginTop: preset.headings.h1.spaceBeforePt,
          marginBottom: preset.headings.h1.spaceAfterPt,
          lineHeight: preset.headings.h1.lineHeight,
          textIndent: preset.headings.h1.indentPt,
        }}
      >
        {preset.misc.numberHeadings && preset.headings.h1.numbered ? '1. ' : ''}Source Files
      </div>

      {/* Body paragraph */}
      <p
        style={{
          color: preset.typography.bodyColor,
          fontSize: preset.typography.bodyFontSizePt,
          fontWeight: WEIGHT_MAP[preset.typography.bodyWeight],
          lineHeight: preset.typography.lineSpacing,
          margin: `0 0 ${preset.typography.paragraphSpacingPt}px 0`,
        }}
      >
        This is a sample paragraph showing body typography. It demonstrates how
        text flows with the configured line spacing and paragraph spacing.
      </p>

      {/* H2 */}
      <div
        style={{
          fontFamily: fontStack(preset.headings.h2.font),
          fontSize: preset.headings.h2.sizePt,
          fontWeight: WEIGHT_MAP[preset.headings.h2.weight],
          fontStyle: preset.headings.h2.italic ? 'italic' : 'normal',
          color: preset.headings.h2.color,
          textAlign: preset.headings.h2.alignment,
          marginTop: preset.headings.h2.spaceBeforePt,
          marginBottom: preset.headings.h2.spaceAfterPt,
          lineHeight: preset.headings.h2.lineHeight,
          textIndent: preset.headings.h2.indentPt,
        }}
      >
        {preset.misc.numberHeadings && preset.headings.h2.numbered ? '1.1 ' : ''}Main Entry Point
      </div>

      {/* File header — fileName and relativePath are independent */}
      {preset.fileHeaders.show && (
        <div
          style={{
            fontFamily: fontStack(preset.fileHeaders.font),
            fontSize: preset.fileHeaders.fontSizePt,
            fontWeight: preset.fileHeaders.bold ? 'bold' : 'normal',
            color: preset.fileHeaders.textColor,
            background: preset.fileHeaders.background === 'transparent' ? undefined : preset.fileHeaders.background,
            borderBottom: preset.fileHeaders.borderBottom ? `1px solid ${preset.fileHeaders.borderColor}` : undefined,
            padding: '4px 0',
            marginBottom: preset.fileHeaders.spacingAfterPt,
          }}
        >
          {preset.fileHeaders.showFileName && (
            <div style={{ fontWeight: preset.fileHeaders.bold ? 'bold' : 'normal' }}>
              Main.kt
            </div>
          )}
          {preset.fileHeaders.showRelativePath && (
            <div style={{ fontSize: preset.fileHeaders.fontSizePt - 1, opacity: 0.8 }}>
              src/main/kotlin/Main.kt
            </div>
          )}
          {/* Metadata line — language, size, line count — only when individually enabled */}
          {(preset.fileHeaders.showLanguageLabel || preset.fileHeaders.showFileSize || (preset.fileHeaders.showLineCount && highlighted)) && (
            <div style={{ fontSize: preset.fileHeaders.fontSizePt - 1, color: preset.colors.mutedText, marginTop: 2 }}>
              {[
                preset.fileHeaders.showLanguageLabel && 'Kotlin',
                preset.fileHeaders.showFileSize && '0.4 KB',
                preset.fileHeaders.showLineCount && highlighted && `${highlighted.lines.length} lines`,
              ].filter(Boolean).join('  ·  ')}
            </div>
          )}
        </div>
      )}

      {/* Code block — real Shiki highlighting */}
      <div
        style={{
          background: effectiveBg,
          fontFamily: fontStack(preset.code.font),
          fontSize: preset.code.fontSizePt,
          fontWeight: WEIGHT_MAP[preset.code.fontWeight],
          lineHeight: preset.code.lineHeight,
          padding: preset.code.paddingPt,
          borderRadius: preset.code.borderRadiusPt,
          border: codeBorderStyle,
          overflow: 'hidden',
          marginTop: preset.code.blockSpacingBeforePt,
          marginBottom: preset.code.blockSpacingAfterPt,
        }}
      >
        {highlighted ? (
          highlighted.lines.map((line) => (
            <div key={line.lineNumber} style={{ display: 'flex' }}>
              {preset.code.showLineNumbers && (
                <span
                  style={{
                    color: preset.code.lineNumberColor,
                    background: preset.code.lineNumberBackground ?? undefined,
                    width: `${lineNumberWidth + 1}ch`,
                    marginRight: 8,
                    textAlign: 'right',
                    userSelect: 'none',
                    flexShrink: 0,
                  }}
                >
                  {line.lineNumber}
                </span>
              )}
              <span
                style={{
                  whiteSpace: preset.code.wrapLongLines ? 'pre-wrap' : 'pre',
                  wordBreak: preset.code.wrapLongLines ? 'break-word' : 'normal',
                  overflow: preset.code.wrapLongLines ? 'hidden' : 'auto',
                  color: fallbackFg,
                }}
              >
                {line.tokens.length === 0 ? (
                  '\u00A0'
                ) : (
                  line.tokens.map((tok, i) => {
                    const text = line.text.slice(tok.start, tok.start + tok.length);
                    return (
                      <span
                        key={i}
                        style={{
                          color: tok.color ?? undefined,
                          fontWeight: tok.bold ? 'bold' : undefined,
                          fontStyle: tok.italic ? 'italic' : undefined,
                        }}
                      >
                        {text}
                      </span>
                    );
                  })
                )}
              </span>
            </div>
          ))
        ) : (
          <div style={{ opacity: 0.5, color: fallbackFg }}>Loading preview…</div>
        )}
      </div>

      {/* H3 */}
      <div
        style={{
          fontFamily: fontStack(preset.headings.h3.font),
          fontSize: preset.headings.h3.sizePt,
          fontWeight: WEIGHT_MAP[preset.headings.h3.weight],
          fontStyle: preset.headings.h3.italic ? 'italic' : 'normal',
          color: preset.headings.h3.color,
          textAlign: preset.headings.h3.alignment,
          marginTop: preset.headings.h3.spaceBeforePt,
          marginBottom: preset.headings.h3.spaceAfterPt,
          lineHeight: preset.headings.h3.lineHeight,
          textIndent: preset.headings.h3.indentPt,
        }}
      >
        {preset.misc.numberHeadings && preset.headings.h3.numbered ? '1.1.1 ' : ''}Notes
      </div>

      <p
        style={{
          color: preset.typography.bodyColor,
          fontSize: preset.typography.bodyFontSizePt,
          lineHeight: preset.typography.lineSpacing,
        }}
      >
        Adjust the controls on the left and watch this preview update instantly.
      </p>

      {/* Page footer — rendered at the bottom of the page */}
      {preset.page.pageFooter && (
        <div
          style={{
            color: preset.colors.mutedText,
            fontSize: 10,
            textAlign: 'center',
            marginTop: preset.page.footerSpacingMm * 2 + 24,
            borderTop: `0.5px solid ${preset.colors.borders}`,
            paddingTop: 4,
          }}
        >
          {preset.page.pageFooter
            .replace('{page}', '1')
            .replace('{pages}', '1')}
        </div>
      )}
    </div>
  );
}

/** Visual page-break marker for the preview. */
function PageBreakMarker({ label, color }: { label: string; color: string }) {
  return (
    <div
      style={{
        margin: '12px 0',
        padding: '4px 8px',
        textAlign: 'center',
        fontSize: 9,
        fontWeight: 'bold',
        color: color,
        borderTop: `1px dashed ${color}`,
        borderBottom: `1px dashed ${color}`,
        textTransform: 'uppercase',
        letterSpacing: 1,
      }}
    >
      {label}
    </div>
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

/** Sub-group inside an accordion section. */
function SubGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-secondary uppercase tracking-wide">
        {label}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="label block">{label}</label>
      {children}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <input
      type="number"
      className="input"
      value={value}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

/** Map FontWeight to numeric CSS font-weight. */
const WEIGHT_MAP: Record<FontWeight, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

function WeightSelect({
  value,
  onChange,
}: {
  value: FontWeight;
  onChange: (v: FontWeight) => void;
}) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as FontWeight)}>
      <option value="normal">Normal (400)</option>
      <option value="medium">Medium (500)</option>
      <option value="semibold">Semibold (600)</option>
      <option value="bold">Bold (700)</option>
    </select>
  );
}

/** Export the weight map for use by the preview/exporters. */
export { WEIGHT_MAP };

function Toggle({
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
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
      <span className="text-sm text-primary">{label}</span>
    </label>
  );
}

function ColorInput({
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
