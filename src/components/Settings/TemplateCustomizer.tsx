/**
 * Template Customizer panel.
 *
 * Replaces the previous "arbitrary template upload" idea with a built-in
 * style builder. Users can configure page, typography, headings, code,
 * file headers, project headers, title page, and colors — all with a live
 * preview that updates immediately.
 *
 * Custom presets can be saved, duplicated, renamed, deleted, and
 * imported/exported as JSON.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useToast } from '@/components/common/Toast';
import {
  BUILT_IN_DOCUMENT_PRESETS,
} from '@/lib/presets/builtInPresets';
import type {
  DocumentPreset,
  HeadingStyle,
  PageStyle,
  TypographyStyle,
  CodeBlockStyle,
  FileHeaderStyle,
  ProjectHeaderStyle,
  TitlePageStyle,
  DocumentColors,
} from '@/lib/presets/documentPreset';
import { SYNTAX_THEMES } from '@/lib/themes/syntaxThemes';
import { FontSelector } from '@/components/common/FontSelector';
import {
  X,
  Save,
  Copy,
  Trash,
  Download,
  Upload,
  Palette,
  Code as CodeIcon,
  FileText,
  FolderCog,
  Sparkles,
  Type,
  Layout,
} from '@/components/common/Icons';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab =
  | 'page'
  | 'typography'
  | 'headings'
  | 'code'
  | 'fileHeaders'
  | 'projectHeaders'
  | 'titlePage'
  | 'colors';

const TABS: Array<{ id: Tab; label: string; icon: any }> = [
  { id: 'page', label: 'Page', icon: Layout },
  { id: 'typography', label: 'Typography', icon: Type },
  { id: 'headings', label: 'Headings', icon: FileText },
  { id: 'code', label: 'Code', icon: CodeIcon },
  { id: 'fileHeaders', label: 'File Headers', icon: FileText },
  { id: 'projectHeaders', label: 'Project', icon: FolderCog },
  { id: 'titlePage', label: 'Title Page', icon: Sparkles },
  { id: 'colors', label: 'Colors', icon: Palette },
];

export function TemplateCustomizer({ open, onClose }: Props) {
  const { state, dispatch, allPresets } = useAppState();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('page');
  const [previewKey, setPreviewKey] = useState(0); // force preview refresh
  const [newName, setNewName] = useState('');

  const preset = state.preset;

  // Bump preview whenever the preset changes.
  useEffect(() => {
    setPreviewKey((k) => k + 1);
  }, [preset]);

  if (!open) return null;

  const patchPreset = (patch: Partial<DocumentPreset>) => {
    dispatch({ type: 'UPDATE_PRESET', patch });
  };

  const patchPage = (patch: Partial<PageStyle>) => {
    patchPreset({ page: { ...preset.page, ...patch } });
  };
  const patchTypography = (patch: Partial<TypographyStyle>) => {
    patchPreset({ typography: { ...preset.typography, ...patch } });
  };
  const patchCode = (patch: Partial<CodeBlockStyle>) => {
    patchPreset({ code: { ...preset.code, ...patch } });
  };
  const patchFileHeaders = (patch: Partial<FileHeaderStyle>) => {
    patchPreset({ fileHeaders: { ...preset.fileHeaders, ...patch } });
  };
  const patchProjectHeaders = (patch: Partial<ProjectHeaderStyle>) => {
    patchPreset({ projectHeaders: { ...preset.projectHeaders, ...patch } });
  };
  const patchTitlePage = (patch: Partial<TitlePageStyle>) => {
    patchPreset({ titlePage: { ...preset.titlePage, ...patch } });
  };
  const patchColors = (patch: Partial<DocumentColors>) => {
    patchPreset({ colors: { ...preset.colors, ...patch } });
  };
  const patchHeading = (
    key: keyof DocumentPreset['headings'],
    patch: Partial<HeadingStyle>,
  ) => {
    patchPreset({
      headings: { ...preset.headings, [key]: { ...preset.headings[key], ...patch } },
    });
  };

  const handleSave = () => {
    const name = newName.trim() || `${preset.name} (custom)`;
    dispatch({
      type: 'SAVE_CUSTOM_PRESET',
      preset: { ...preset, name, builtIn: false },
    });
    setNewName('');
    toast.push({
      kind: 'success',
      title: 'Preset saved',
      message: `"${name}" is now available in your custom presets.`,
    });
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

  const handleRename = () => {
    if (!preset.builtIn && newName.trim()) {
      dispatch({
        type: 'RENAME_CUSTOM_PRESET',
        id: preset.id,
        name: newName.trim(),
      });
      setNewName('');
      toast.push({ kind: 'success', title: 'Preset renamed' });
    }
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
        dispatch({ type: 'IMPORT_CUSTOM_PRESET', json: text, fallbackName: file.name.replace(/\.json$/i, '') });
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
            <h2 className="text-sm font-semibold text-primary">Template Customizer</h2>
            <select
              className="select w-64"
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
              <span className="badge">Built-in · read-only</span>
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

        {/* Body: split into customizer + preview */}
        <div className="flex flex-1 overflow-hidden">
          {/* Customizer pane */}
          <div className="flex w-1/2 flex-col border-r border-app">
            <div className="flex overflow-x-auto border-b border-app">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 whitespace-nowrap px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                    tab === t.id
                      ? 'border-[var(--color-accent)] text-accent'
                      : 'border-transparent text-secondary hover:text-primary'
                  }`}
                >
                  <t.icon size={14} />
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-4">
              {tab === 'page' && <PageTab preset={preset} patch={patchPage} patchPreset={patchPreset} />}
              {tab === 'typography' && <TypographyTab preset={preset} patch={patchTypography} />}
              {tab === 'headings' && <HeadingsTab preset={preset} patchHeading={patchHeading} />}
              {tab === 'code' && <CodeTab preset={preset} patch={patchCode} />}
              {tab === 'fileHeaders' && <FileHeadersTab preset={preset} patch={patchFileHeaders} />}
              {tab === 'projectHeaders' && <ProjectHeadersTab preset={preset} patch={patchProjectHeaders} />}
              {tab === 'titlePage' && <TitlePageTab preset={preset} patch={patchTitlePage} />}
              {tab === 'colors' && <ColorsTab preset={preset} patch={patchColors} />}
            </div>

            {/* Save / rename bar */}
            <div className="border-t border-app p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="input"
                  placeholder={preset.builtIn ? 'Save as new preset…' : 'Rename preset…'}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                {preset.builtIn ? (
                  <button
                    className="btn-primary whitespace-nowrap"
                    onClick={handleSave}
                    disabled={!newName.trim()}
                  >
                    <Save size={14} /> Save as
                  </button>
                ) : (
                  <>
                    <button
                      className="btn-secondary whitespace-nowrap"
                      onClick={handleRename}
                      disabled={!newName.trim()}
                    >
                      Rename
                    </button>
                    <button
                      className="btn-primary whitespace-nowrap"
                      onClick={handleSave}
                      disabled={!newName.trim()}
                    >
                      <Save size={14} /> Save copy
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Preview pane */}
          <div className="flex-1 overflow-auto p-4">
            <TemplatePreview key={previewKey} preset={preset} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Local helper to avoid name clash with the action type. */
function exportPresetJsonLocal(preset: DocumentPreset): string {
  // We can't import the helper directly because of the action re-export
  // shadowing — but the helper is module-scoped, so just call it via
  // dynamic import path.
  // Instead we inline the export shape:
  const exported = {
    name: preset.name,
    description: preset.description,
    syntaxTheme: preset.syntaxTheme,
    page: preset.page,
    typography: preset.typography,
    headings: preset.headings,
    code: preset.code,
    fileHeaders: preset.fileHeaders,
    projectHeaders: preset.projectHeaders,
    titlePage: preset.titlePage,
    colors: preset.colors,
    metadata: preset.metadata,
    includeToc: preset.includeToc,
    includeProjectStructure: preset.includeProjectStructure,
    pageBreakBetweenFiles: preset.pageBreakBetweenFiles,
    version: 1,
    exportedAt: new Date().toISOString(),
  };
  return JSON.stringify(exported, null, 2);
}

/* ----------------------------- Tabs ----------------------------- */

function PageTab({
  preset,
  patch,
  patchPreset,
}: {
  preset: DocumentPreset;
  patch: (p: Partial<PageStyle>) => void;
  patchPreset: (p: Partial<DocumentPreset>) => void;
}) {
  const p = preset.page;
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Page size">
          <select
            className="select"
            value={p.size}
            onChange={(e) => patch({ size: e.target.value as any })}
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
            onChange={(e) => patch({ landscape: e.target.value === 'landscape' })}
          >
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Field label="Margin T (mm)">
          <NumberInput value={p.marginTopMm} onChange={(v) => patch({ marginTopMm: v })} />
        </Field>
        <Field label="R (mm)">
          <NumberInput value={p.marginRightMm} onChange={(v) => patch({ marginRightMm: v })} />
        </Field>
        <Field label="B (mm)">
          <NumberInput value={p.marginBottomMm} onChange={(v) => patch({ marginBottomMm: v })} />
        </Field>
        <Field label="L (mm)">
          <NumberInput value={p.marginLeftMm} onChange={(v) => patch({ marginLeftMm: v })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Header spacing (mm)">
          <NumberInput value={p.headerSpacingMm} onChange={(v) => patch({ headerSpacingMm: v })} />
        </Field>
        <Field label="Footer spacing (mm)">
          <NumberInput value={p.footerSpacingMm} onChange={(v) => patch({ footerSpacingMm: v })} />
        </Field>
      </div>
      <Field label="Page header text">
        <input
          type="text"
          className="input"
          placeholder="(none)"
          value={p.pageHeader ?? ''}
          onChange={(e) => patch({ pageHeader: e.target.value || null })}
        />
      </Field>
      <Field label="Page footer text">
        <input
          type="text"
          className="input"
          placeholder="Page {page} of {pages}"
          value={p.pageFooter ?? ''}
          onChange={(e) => patch({ pageFooter: e.target.value || null })}
        />
      </Field>
      <Toggle
        label="Include table of contents"
        checked={preset.includeToc}
        onChange={(v) => patchPreset({ includeToc: v })}
      />
      <Toggle
        label="Include project structure tree"
        checked={preset.includeProjectStructure}
        onChange={(v) => patchPreset({ includeProjectStructure: v })}
      />
      <Toggle
        label="Page break between files"
        checked={preset.pageBreakBetweenFiles}
        onChange={(v) => patchPreset({ pageBreakBetweenFiles: v })}
      />
      <Field label="Syntax theme">
        <div className="grid grid-cols-2 gap-2">
          {SYNTAX_THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => patchPreset({ syntaxTheme: t.id })}
              className={`rounded-md border p-2 text-left transition-colors ${
                preset.syntaxTheme === t.id
                  ? 'border-[var(--color-accent)]'
                  : 'border-app hover:border-muted'
              }`}
              style={{ background: 'var(--color-surface)' }}
            >
              <div
                className="mb-1 h-8 rounded text-[10px] px-1.5 py-1"
                style={{
                  background: t.background,
                  color: t.foreground,
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                const x = 42;
              </div>
              <div className="text-[11px] font-medium text-primary">{t.label}</div>
            </button>
          ))}
        </div>
      </Field>
    </>
  );
}

function TypographyTab({
  preset,
  patch,
}: {
  preset: DocumentPreset;
  patch: (p: Partial<TypographyStyle>) => void;
}) {
  const t = preset.typography;
  return (
    <>
      <Field label="Body font">
        <FontSelector
          value={t.bodyFont}
          onChange={(v) => patch({ bodyFont: v })}
          category="body"
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Body font size (pt)">
          <NumberInput value={t.bodyFontSizePt} step={0.5} onChange={(v) => patch({ bodyFontSizePt: v })} />
        </Field>
        <Field label="Line spacing">
          <NumberInput value={t.lineSpacing} step={0.05} onChange={(v) => patch({ lineSpacing: v })} />
        </Field>
      </div>
      <Field label="Body text color">
        <ColorInput value={t.bodyColor} onChange={(v) => patch({ bodyColor: v })} />
      </Field>
      <Field label="Paragraph spacing (pt)">
        <NumberInput value={t.paragraphSpacingPt} onChange={(v) => patch({ paragraphSpacingPt: v })} />
      </Field>
    </>
  );
}

function HeadingsTab({
  preset,
  patchHeading,
}: {
  preset: DocumentPreset;
  patchHeading: (key: keyof DocumentPreset['headings'], patch: Partial<HeadingStyle>) => void;
}) {
  const levels: Array<{ key: keyof DocumentPreset['headings']; label: string }> = [
    { key: 'title', label: 'Title' },
    { key: 'h1', label: 'Heading 1' },
    { key: 'h2', label: 'Heading 2' },
    { key: 'h3', label: 'Heading 3' },
    { key: 'h4', label: 'Heading 4' },
  ];
  return (
    <div className="space-y-4">
      {levels.map(({ key, label }) => {
        const h = preset.headings[key];
        return (
          <div key={key} className="panel p-3 space-y-2">
            <div className="text-xs font-semibold text-primary">{label}</div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Font">
                <FontSelector
                  value={h.font}
                  onChange={(v) => patchHeading(key, { font: v })}
                  category="body"
                />
              </Field>
              <Field label="Size (pt)">
                <NumberInput value={h.sizePt} step={0.5} onChange={(v) => patchHeading(key, { sizePt: v })} />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Weight">
                <select
                  className="select"
                  value={h.weight}
                  onChange={(e) => patchHeading(key, { weight: e.target.value as any })}
                >
                  <option value="normal">Normal</option>
                  <option value="medium">Medium</option>
                  <option value="semibold">Semibold</option>
                  <option value="bold">Bold</option>
                </select>
              </Field>
              <Field label="Alignment">
                <select
                  className="select"
                  value={h.alignment}
                  onChange={(e) => patchHeading(key, { alignment: e.target.value as any })}
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </Field>
              <Field label="Color">
                <ColorInput value={h.color} onChange={(v) => patchHeading(key, { color: v })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Space before (pt)">
                <NumberInput value={h.spaceBeforePt} onChange={(v) => patchHeading(key, { spaceBeforePt: v })} />
              </Field>
              <Field label="Space after (pt)">
                <NumberInput value={h.spaceAfterPt} onChange={(v) => patchHeading(key, { spaceAfterPt: v })} />
              </Field>
            </div>
            <div className="flex items-center gap-4">
              <Toggle label="Italic" checked={h.italic} onChange={(v) => patchHeading(key, { italic: v })} />
              {key !== 'title' && (
                <Toggle label="Numbered" checked={h.numbered} onChange={(v) => patchHeading(key, { numbered: v })} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CodeTab({
  preset,
  patch,
}: {
  preset: DocumentPreset;
  patch: (p: Partial<CodeBlockStyle>) => void;
}) {
  const c = preset.code;
  return (
    <>
      <Field label="Code font">
        <FontSelector value={c.font} onChange={(v) => patch({ font: v })} category="code" />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Font size (pt)">
          <NumberInput value={c.fontSizePt} step={0.5} onChange={(v) => patch({ fontSizePt: v })} />
        </Field>
        <Field label="Line height">
          <NumberInput value={c.lineHeight} step={0.05} onChange={(v) => patch({ lineHeight: v })} />
        </Field>
        <Field label="Padding (pt)">
          <NumberInput value={c.paddingPt} onChange={(v) => patch({ paddingPt: v })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Text color">
          <ColorInput value={c.textColor} onChange={(v) => patch({ textColor: v })} />
        </Field>
        <Field label="Background color">
          <ColorInput value={c.backgroundColor} onChange={(v) => patch({ backgroundColor: v })} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Border color">
          <ColorInput value={c.borderColor ?? ''} onChange={(v) => patch({ borderColor: v || null })} allowEmpty />
        </Field>
        <Field label="Border width (pt)">
          <NumberInput value={c.borderWidthPt} step={0.5} onChange={(v) => patch({ borderWidthPt: v })} />
        </Field>
        <Field label="Border radius (pt)">
          <NumberInput value={c.borderRadiusPt} step={0.5} onChange={(v) => patch({ borderRadiusPt: v })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Line number color">
          <ColorInput value={c.lineNumberColor} onChange={(v) => patch({ lineNumberColor: v })} />
        </Field>
        <Field label="Line number background">
          <ColorInput value={c.lineNumberBackground ?? ''} onChange={(v) => patch({ lineNumberBackground: v || null })} allowEmpty />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Block spacing before (pt)">
          <NumberInput value={c.blockSpacingBeforePt} onChange={(v) => patch({ blockSpacingBeforePt: v })} />
        </Field>
        <Field label="Block spacing after (pt)">
          <NumberInput value={c.blockSpacingAfterPt} onChange={(v) => patch({ blockSpacingAfterPt: v })} />
        </Field>
      </div>
      <Toggle label="Show line numbers" checked={c.showLineNumbers} onChange={(v) => patch({ showLineNumbers: v })} />
      <Toggle label="Wrap long lines" checked={c.wrapLongLines} onChange={(v) => patch({ wrapLongLines: v })} />
    </>
  );
}

function FileHeadersTab({
  preset,
  patch,
}: {
  preset: DocumentPreset;
  patch: (p: Partial<FileHeaderStyle>) => void;
}) {
  const h = preset.fileHeaders;
  return (
    <>
      <Toggle label="Show file headers" checked={h.show} onChange={(v) => patch({ show: v })} />
      <div className="grid grid-cols-2 gap-2">
        <Toggle label="File name" checked={h.showFileName} onChange={(v) => patch({ showFileName: v })} />
        <Toggle label="Relative path" checked={h.showRelativePath} onChange={(v) => patch({ showRelativePath: v })} />
        <Toggle label="Language label" checked={h.showLanguageLabel} onChange={(v) => patch({ showLanguageLabel: v })} />
        <Toggle label="File size" checked={h.showFileSize} onChange={(v) => patch({ showFileSize: v })} />
        <Toggle label="Line count" checked={h.showLineCount} onChange={(v) => patch({ showLineCount: v })} />
        <Toggle label="Bold" checked={h.bold} onChange={(v) => patch({ bold: v })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Background">
          <ColorInput value={h.background === 'transparent' ? '' : h.background} onChange={(v) => patch({ background: v || 'transparent' })} allowEmpty />
        </Field>
        <Field label="Text color">
          <ColorInput value={h.textColor} onChange={(v) => patch({ textColor: v })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Border color">
          <ColorInput value={h.borderColor} onChange={(v) => patch({ borderColor: v })} />
        </Field>
        <Field label="Font size (pt)">
          <NumberInput value={h.fontSizePt} step={0.5} onChange={(v) => patch({ fontSizePt: v })} />
        </Field>
      </div>
      <Field label="Font">
        <FontSelector value={h.font} onChange={(v) => patch({ font: v })} category="code" />
      </Field>
      <Toggle label="Bottom border" checked={h.borderBottom} onChange={(v) => patch({ borderBottom: v })} />
    </>
  );
}

function ProjectHeadersTab({
  preset,
  patch,
}: {
  preset: DocumentPreset;
  patch: (p: Partial<ProjectHeaderStyle>) => void;
}) {
  const h = preset.projectHeaders;
  return (
    <>
      <Toggle label="Show project title" checked={h.showTitle} onChange={(v) => patch({ showTitle: v })} />
      <Toggle label="Show project path" checked={h.showPath} onChange={(v) => patch({ showPath: v })} />
      <Toggle label="Show metadata" checked={h.showMetadata} onChange={(v) => patch({ showMetadata: v })} />
      <Field label="Font">
        <FontSelector value={h.font} onChange={(v) => patch({ font: v })} category="body" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Size (pt)">
          <NumberInput value={h.sizePt} step={0.5} onChange={(v) => patch({ sizePt: v })} />
        </Field>
        <Field label="Color">
          <ColorInput value={h.color} onChange={(v) => patch({ color: v })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Weight">
          <select className="select" value={h.weight} onChange={(e) => patch({ weight: e.target.value as any })}>
            <option value="normal">Normal</option>
            <option value="medium">Medium</option>
            <option value="semibold">Semibold</option>
            <option value="bold">Bold</option>
          </select>
        </Field>
        <Toggle label="Uppercase" checked={h.uppercase} onChange={(v) => patch({ uppercase: v })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Space before (pt)">
          <NumberInput value={h.spaceBeforePt} onChange={(v) => patch({ spaceBeforePt: v })} />
        </Field>
        <Field label="Space after (pt)">
          <NumberInput value={h.spaceAfterPt} onChange={(v) => patch({ spaceAfterPt: v })} />
        </Field>
      </div>
    </>
  );
}

function TitlePageTab({
  preset,
  patch,
}: {
  preset: DocumentPreset;
  patch: (p: Partial<TitlePageStyle>) => void;
}) {
  const t = preset.titlePage;
  return (
    <>
      <Toggle label="Enable title page" checked={t.enabled} onChange={(v) => patch({ enabled: v })} />
      <div className="grid grid-cols-2 gap-2">
        <Toggle label="Title" checked={t.showTitle} onChange={(v) => patch({ showTitle: v })} />
        <Toggle label="Subtitle" checked={t.showSubtitle} onChange={(v) => patch({ showSubtitle: v })} />
        <Toggle label="Author" checked={t.showAuthor} onChange={(v) => patch({ showAuthor: v })} />
        <Toggle label="Course" checked={t.showCourse} onChange={(v) => patch({ showCourse: v })} />
        <Toggle label="University" checked={t.showUniversity} onChange={(v) => patch({ showUniversity: v })} />
        <Toggle label="Date" checked={t.showDate} onChange={(v) => patch({ showDate: v })} />
        <Toggle label="Version" checked={t.showVersion} onChange={(v) => patch({ showVersion: v })} />
        <Toggle label="Description" checked={t.showDescription} onChange={(v) => patch({ showDescription: v })} />
      </div>
    </>
  );
}

function ColorsTab({
  preset,
  patch,
}: {
  preset: DocumentPreset;
  patch: (p: Partial<DocumentColors>) => void;
}) {
  const c = preset.colors;
  const entries = Object.entries(c) as Array<[keyof DocumentColors, string]>;
  return (
    <div className="grid grid-cols-2 gap-2">
      {entries.map(([key, value]) => (
        <Field key={key} label={labelForKey(key)}>
          <ColorInput value={value} onChange={(v) => patch({ [key]: v } as any)} />
        </Field>
      ))}
    </div>
  );
}

function labelForKey(key: string): string {
  const labels: Record<string, string> = {
    background: 'Background',
    surface: 'Surface',
    primaryText: 'Primary text',
    secondaryText: 'Secondary text',
    mutedText: 'Muted text',
    accent: 'Accent',
    headings: 'Headings',
    borders: 'Borders',
    codeBackground: 'Code background',
    codeText: 'Code text',
    codeHeader: 'Code header',
    codeBorder: 'Code border',
    lineNumbers: 'Line numbers',
    links: 'Links',
    success: 'Success',
    warning: 'Warning',
    error: 'Error',
  };
  return labels[key] ?? key;
}

/* --------------------------- Live preview --------------------------- */

function TemplatePreview({ preset }: { preset: DocumentPreset }) {
  // Sample code for the preview — a small Kotlin snippet.
  interface PreviewToken {
    text: string;
    color: string;
    bold?: boolean;
    italic?: boolean;
  }
  interface PreviewLine {
    num: number;
    tokens: PreviewToken[];
  }
  const sampleLines: PreviewLine[] = [
    { num: 1, tokens: [{ text: 'fun ', color: '#ff7b72', bold: true }, { text: 'main', color: '#d2a8ff' }, { text: '() {', color: '#e6edf3' }] },
    { num: 2, tokens: [{ text: '    println', color: '#d2a8ff' }, { text: '(', color: '#e6edf3' }, { text: '"Hello, Codice!"', color: '#a5d6ff' }, { text: ')', color: '#e6edf3' }] },
    { num: 3, tokens: [{ text: '    val ', color: '#ff7b72', bold: true }, { text: 'numbers ', color: '#79c0ff' }, { text: '= ', color: '#e6edf3' }, { text: 'listOf', color: '#d2a8ff' }, { text: '(', color: '#e6edf3' }, { text: '1, 2, 3, 4, 5', color: '#79c0ff' }, { text: ')', color: '#e6edf3' }] },
    { num: 4, tokens: [{ text: '    val ', color: '#ff7b72', bold: true }, { text: 'sum ', color: '#79c0ff' }, { text: '= ', color: '#e6edf3' }, { text: 'numbers', color: '#e6edf3' }, { text: '.', color: '#e6edf3' }, { text: 'sum', color: '#d2a8ff' }, { text: '()', color: '#e6edf3' }] },
    { num: 5, tokens: [{ text: '    println', color: '#d2a8ff' }, { text: '(', color: '#e6edf3' }, { text: '"Sum: $sum"', color: '#a5d6ff' }, { text: ')', color: '#e6edf3' }] },
    { num: 6, tokens: [{ text: '}', color: '#e6edf3' }] },
    { num: 7, tokens: [] },
    { num: 8, tokens: [{ text: '// A very long line that demonstrates how the code block handles overflow when wrapping is disabled by the preset configuration.', color: '#8b949e', italic: true }] },
  ];

  return (
    <div
      className="mx-auto max-w-md rounded-lg shadow-xl"
      style={{
        background: preset.colors.background,
        color: preset.colors.primaryText,
        padding: `${preset.page.marginTopMm * 2}px ${preset.page.marginRightMm * 2}px ${preset.page.marginBottomMm * 2}px ${preset.page.marginLeftMm * 2}px`,
        fontFamily: preset.typography.bodyFont,
        fontSize: preset.typography.bodyFontSizePt,
      }}
    >
      {/* Title page preview */}
      {preset.titlePage.enabled && (
        <div className="text-center mb-6 pb-4 border-b" style={{ borderColor: preset.colors.borders }}>
          {preset.titlePage.showTitle && (
            <div
              style={{
                fontFamily: preset.headings.title.font,
                fontSize: preset.headings.title.sizePt,
                fontWeight: preset.headings.title.weight,
                fontStyle: preset.headings.title.italic ? 'italic' : 'normal',
                color: preset.headings.title.color,
                textAlign: preset.headings.title.alignment,
              }}
            >
              {preset.metadata?.title || 'Project Report'}
            </div>
          )}
          {preset.titlePage.showAuthor && (
            <div className="mt-2" style={{ color: preset.colors.secondaryText, fontSize: preset.typography.bodyFontSizePt - 1 }}>
              by {preset.metadata?.author || 'Author Name'}
            </div>
          )}
          {preset.titlePage.showCourse && (
            <div className="mt-1 text-xs" style={{ color: preset.colors.mutedText }}>
              {preset.metadata?.course || 'CS 101'}
            </div>
          )}
          {preset.titlePage.showDate && (
            <div className="mt-1 text-xs" style={{ color: preset.colors.mutedText }}>
              Generated: {new Date().toLocaleDateString()}
            </div>
          )}
        </div>
      )}

      {/* TOC preview */}
      {preset.includeToc && (
        <div className="mb-4">
          <div
            style={{
              fontFamily: preset.headings.h1.font,
              fontSize: preset.headings.h1.sizePt,
              fontWeight: preset.headings.h1.weight,
              color: preset.headings.h1.color,
            }}
          >
            Table of Contents
          </div>
          <div className="mt-1 text-xs" style={{ color: preset.colors.secondaryText }}>
            1.1  src/main/kotlin/Main.kt
          </div>
        </div>
      )}

      {/* Project header */}
      {preset.projectHeaders.showTitle && (
        <div
          style={{
            fontFamily: preset.projectHeaders.font,
            fontSize: preset.projectHeaders.sizePt,
            fontWeight: preset.projectHeaders.weight,
            color: preset.projectHeaders.color,
            textTransform: preset.projectHeaders.uppercase ? 'uppercase' : 'none',
            marginTop: preset.projectHeaders.spaceBeforePt,
            marginBottom: preset.projectHeaders.spaceAfterPt,
          }}
        >
          Sample Project
        </div>
      )}

      {/* H1 */}
      <div
        style={{
          fontFamily: preset.headings.h1.font,
          fontSize: preset.headings.h1.sizePt,
          fontWeight: preset.headings.h1.weight,
          color: preset.headings.h1.color,
          marginTop: preset.headings.h1.spaceBeforePt,
          marginBottom: preset.headings.h1.spaceAfterPt,
        }}
      >
        {preset.headings.h1.numbered ? '1. ' : ''}Source Files
      </div>

      {/* Body paragraph */}
      <p
        style={{
          color: preset.typography.bodyColor,
          fontSize: preset.typography.bodyFontSizePt,
          lineHeight: preset.typography.lineSpacing,
          margin: `0 0 ${preset.typography.paragraphSpacingPt}px 0`,
        }}
      >
        This is a sample paragraph showing body typography. It demonstrates how text
        flows with the configured line spacing and paragraph spacing.
      </p>

      {/* H2 */}
      <div
        style={{
          fontFamily: preset.headings.h2.font,
          fontSize: preset.headings.h2.sizePt,
          fontWeight: preset.headings.h2.weight,
          color: preset.headings.h2.color,
          marginTop: preset.headings.h2.spaceBeforePt,
          marginBottom: preset.headings.h2.spaceAfterPt,
        }}
      >
        {preset.headings.h2.numbered ? '1.1 ' : ''}Main Entry Point
      </div>

      {/* File header */}
      {preset.fileHeaders.show && (
        <div
          style={{
            fontFamily: preset.fileHeaders.font,
            fontSize: preset.fileHeaders.fontSizePt,
            fontWeight: preset.fileHeaders.bold ? 'bold' : 'normal',
            color: preset.fileHeaders.textColor,
            background: preset.fileHeaders.background === 'transparent' ? undefined : preset.fileHeaders.background,
            borderBottom: preset.fileHeaders.borderBottom ? `1px solid ${preset.fileHeaders.borderColor}` : undefined,
            padding: '4px 0',
            marginBottom: 6,
          }}
        >
          {[
            preset.fileHeaders.showRelativePath && 'src/main/kotlin/Main.kt',
            preset.fileHeaders.showLanguageLabel && 'Kotlin',
            preset.fileHeaders.showFileSize && '0.4 KB',
            preset.fileHeaders.showLineCount && '8 lines',
          ].filter(Boolean).join('    ·    ')}
        </div>
      )}

      {/* Code block */}
      <div
        style={{
          fontFamily: preset.code.font,
          fontSize: preset.code.fontSizePt,
          lineHeight: preset.code.lineHeight,
          color: preset.code.textColor,
          background: preset.code.backgroundColor,
          border: preset.code.borderColor ? `${preset.code.borderWidthPt}pt solid ${preset.code.borderColor}` : undefined,
          borderRadius: preset.code.borderRadiusPt,
          padding: preset.code.paddingPt,
          marginTop: preset.code.blockSpacingBeforePt,
          marginBottom: preset.code.blockSpacingAfterPt,
        }}
      >
        {sampleLines.map((line) => (
          <div key={line.num} style={{ display: 'flex' }}>
            {preset.code.showLineNumbers && (
              <span
                style={{
                  color: preset.code.lineNumberColor,
                  background: preset.code.lineNumberBackground ?? undefined,
                  width: '2.5ch',
                  marginRight: 8,
                  textAlign: 'right',
                  userSelect: 'none',
                  flexShrink: 0,
                }}
              >
                {line.num}
              </span>
            )}
            <span
              style={{
                whiteSpace: preset.code.wrapLongLines ? 'pre-wrap' : 'pre',
                wordBreak: preset.code.wrapLongLines ? 'break-word' : 'normal',
                overflow: preset.code.wrapLongLines ? 'hidden' : 'auto',
              }}
            >
              {line.tokens.length === 0 ? '\u00A0' : line.tokens.map((tok, i) => (
                <span
                  key={i}
                  style={{
                    color: tok.color,
                    fontWeight: tok.bold ? 'bold' : undefined,
                    fontStyle: tok.italic ? 'italic' : undefined,
                  }}
                >
                  {tok.text}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>

      {/* H3 */}
      <div
        style={{
          fontFamily: preset.headings.h3.font,
          fontSize: preset.headings.h3.sizePt,
          fontWeight: preset.headings.h3.weight,
          color: preset.headings.h3.color,
          marginTop: preset.headings.h3.spaceBeforePt,
          marginBottom: preset.headings.h3.spaceAfterPt,
        }}
      >
        {preset.headings.h3.numbered ? '1.1.1 ' : ''}Notes
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
    </div>
  );
}

/* ----------------------------- Helpers ----------------------------- */

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
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
        <button
          className="btn-ghost"
          onClick={() => onChange('')}
          aria-label="Clear color"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
