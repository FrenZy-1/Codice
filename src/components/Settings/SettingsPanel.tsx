/**
 * Settings panel — controls document options, metadata, theme, and filter.
 */

import { useAppState } from '@/hooks/useAppState';
import { BUILT_IN_PRESETS, getPreset } from '@/lib/presets/presets';
import { SYNTAX_THEMES, getTheme } from '@/lib/themes/syntaxThemes';
import { defaultDocumentOptions } from '@/lib/defaultOptions';
import type { DocumentOptions, PageSize } from '@/types';
import { X, Settings, Palette, FileText, FolderCog, Sparkles } from '@/components/common/Icons';
import { useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = 'document' | 'code' | 'theme' | 'metadata' | 'filter';

export function SettingsPanel({ open, onClose }: Props) {
  const { state, dispatch } = useAppState();
  const [tab, setTab] = useState<Tab>('document');

  if (!open) return null;

  const updateOption = (patch: Partial<DocumentOptions>) => {
    dispatch({ type: 'SET_OPTIONS', options: patch });
  };

  const applyPreset = (presetId: string) => {
    const preset = getPreset(presetId);
    if (!preset) return;
    const opts = { ...defaultDocumentOptions(), ...preset.options };
    dispatch({
      type: 'SET_PRESET',
      presetId,
      options: opts,
    });
    if (preset.metadata) {
      dispatch({ type: 'SET_METADATA', metadata: preset.metadata });
    }
  };

  const tabs: Array<{ id: Tab; label: string; icon: any }> = [
    { id: 'document', label: 'Document', icon: FileText },
    { id: 'code', label: 'Code', icon: Settings },
    { id: 'theme', label: 'Theme', icon: Palette },
    { id: 'metadata', label: 'Metadata', icon: Sparkles },
    { id: 'filter', label: 'Filters', icon: FolderCog },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative ml-auto flex h-full w-full max-w-2xl flex-col border-l border-[#30363d] bg-[#0d1117] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#30363d] px-4 py-3">
          <h2 className="text-sm font-semibold text-[#e6edf3]">Settings</h2>
          <button onClick={onClose} className="btn-ghost" aria-label="Close settings">
            <X size={16} />
          </button>
        </div>

        <div className="flex border-b border-[#30363d]">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-[#7d8590] hover:text-[#e6edf3]'
              }`}
            >
              <t.icon size={14} />
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {tab === 'document' && (
            <>
              <Field label="Preset">
                <select
                  className="select"
                  value={state.presetId}
                  onChange={(e) => applyPreset(e.target.value)}
                >
                  {BUILT_IN_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Page size">
                <select
                  className="select"
                  value={state.options.pageSize}
                  onChange={(e) =>
                    updateOption({ pageSize: e.target.value as PageSize })
                  }
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
                  value={state.options.landscape ? 'landscape' : 'portrait'}
                  onChange={(e) =>
                    updateOption({ landscape: e.target.value === 'landscape' })
                  }
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </Field>
              <div className="grid grid-cols-4 gap-2">
                <Field label="Margin T (mm)">
                  <input
                    type="number"
                    className="input"
                    value={state.options.margins.top}
                    onChange={(e) =>
                      updateOption({
                        margins: {
                          ...state.options.margins,
                          top: Number(e.target.value),
                        },
                      })
                    }
                  />
                </Field>
                <Field label="R (mm)">
                  <input
                    type="number"
                    className="input"
                    value={state.options.margins.right}
                    onChange={(e) =>
                      updateOption({
                        margins: {
                          ...state.options.margins,
                          right: Number(e.target.value),
                        },
                      })
                    }
                  />
                </Field>
                <Field label="B (mm)">
                  <input
                    type="number"
                    className="input"
                    value={state.options.margins.bottom}
                    onChange={(e) =>
                      updateOption({
                        margins: {
                          ...state.options.margins,
                          bottom: Number(e.target.value),
                        },
                      })
                    }
                  />
                </Field>
                <Field label="L (mm)">
                  <input
                    type="number"
                    className="input"
                    value={state.options.margins.left}
                    onChange={(e) =>
                      updateOption({
                        margins: {
                          ...state.options.margins,
                          left: Number(e.target.value),
                        },
                      })
                    }
                  />
                </Field>
              </div>
              <Toggle
                label="Include front matter (title page)"
                checked={state.options.includeFrontMatter}
                onChange={(v) => updateOption({ includeFrontMatter: v })}
              />
              <Toggle
                label="Include table of contents"
                checked={state.options.includeToc}
                onChange={(v) => updateOption({ includeToc: v })}
              />
              <Toggle
                label="Include project structure tree"
                checked={state.options.includeProjectStructure}
                onChange={(v) => updateOption({ includeProjectStructure: v })}
              />
              <Toggle
                label="Page break between files"
                checked={state.options.pageBreakBetweenFiles}
                onChange={(v) => updateOption({ pageBreakBetweenFiles: v })}
              />
              <Toggle
                label="Show file headers (path · language · size)"
                checked={state.options.showFileHeaders}
                onChange={(v) => updateOption({ showFileHeaders: v })}
              />
              <Field label="Page header text">
                <input
                  type="text"
                  className="input"
                  placeholder="(none)"
                  value={state.options.pageHeader ?? ''}
                  onChange={(e) =>
                    updateOption({
                      pageHeader: e.target.value || null,
                    })
                  }
                />
              </Field>
              <Field label="Page footer text">
                <input
                  type="text"
                  className="input"
                  placeholder="Page {page} of {pages}"
                  value={state.options.pageFooter ?? ''}
                  onChange={(e) =>
                    updateOption({
                      pageFooter: e.target.value || null,
                    })
                  }
                />
              </Field>
            </>
          )}

          {tab === 'code' && (
            <>
              <Field label="Code font family">
                <input
                  type="text"
                  className="input"
                  value={state.options.codeFont}
                  onChange={(e) => updateOption({ codeFont: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Code font size (pt)">
                  <input
                    type="number"
                    step="0.5"
                    className="input"
                    value={state.options.codeFontSize}
                    onChange={(e) =>
                      updateOption({ codeFontSize: Number(e.target.value) })
                    }
                  />
                </Field>
                <Field label="Line height">
                  <input
                    type="number"
                    step="0.05"
                    className="input"
                    value={state.options.codeLineHeight}
                    onChange={(e) =>
                      updateOption({
                        codeLineHeight: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Padding (pt)">
                  <input
                    type="number"
                    className="input"
                    value={state.options.codePadding}
                    onChange={(e) =>
                      updateOption({ codePadding: Number(e.target.value) })
                    }
                  />
                </Field>
                <Field label="Border width (pt)">
                  <input
                    type="number"
                    step="0.5"
                    className="input"
                    value={state.options.codeBorderWidth}
                    onChange={(e) =>
                      updateOption({
                        codeBorderWidth: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              <Field label="Background color">
                <ColorInput
                  value={state.options.codeBackground}
                  onChange={(v) => updateOption({ codeBackground: v })}
                />
              </Field>
              <Field label="Border color">
                <ColorInput
                  value={state.options.codeBorderColor ?? ''}
                  onChange={(v) =>
                    updateOption({ codeBorderColor: v || null })
                  }
                  allowEmpty
                />
              </Field>
              <Field label="Heading font">
                <input
                  type="text"
                  className="input"
                  value={state.options.headingFont}
                  onChange={(e) => updateOption({ headingFont: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Body font">
                  <input
                    type="text"
                    className="input"
                    value={state.options.bodyFont}
                    onChange={(e) => updateOption({ bodyFont: e.target.value })}
                  />
                </Field>
                <Field label="Body font size (pt)">
                  <input
                    type="number"
                    className="input"
                    value={state.options.bodyFontSize}
                    onChange={(e) =>
                      updateOption({ bodyFontSize: Number(e.target.value) })
                    }
                  />
                </Field>
              </div>
              <Toggle
                label="Show line numbers"
                checked={state.options.showLineNumbers}
                onChange={(v) => updateOption({ showLineNumbers: v })}
              />
              <Toggle
                label="Wrap long lines"
                checked={state.options.wrapLongLines}
                onChange={(v) => updateOption({ wrapLongLines: v })}
              />
            </>
          )}

          {tab === 'theme' && (
            <>
              <Field label="Syntax theme">
                <div className="grid grid-cols-2 gap-2">
                  {SYNTAX_THEMES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => updateOption({ syntaxTheme: t.id })}
                      className={`rounded-md border p-3 text-left transition-colors ${
                        state.options.syntaxTheme === t.id
                          ? 'border-brand-500 bg-brand-500/10'
                          : 'border-[#30363d] hover:border-[#484f58]'
                      }`}
                    >
                      <div
                        className="mb-2 h-12 rounded"
                        style={{
                          background: t.background,
                          color: t.foreground,
                          fontFamily: 'JetBrains Mono, monospace',
                          fontSize: 10,
                          padding: 6,
                          overflow: 'hidden',
                        }}
                      >
                        <div>const x = 42;</div>
                        <div style={{ color: '#79c0ff' }}>let s = "hi";</div>
                      </div>
                      <div className="text-xs font-medium text-[#e6edf3]">
                        {t.label}
                      </div>
                    </button>
                  ))}
                </div>
              </Field>
            </>
          )}

          {tab === 'metadata' && (
            <>
              <Field label="Title">
                <input
                  type="text"
                  className="input"
                  value={state.metadata.title ?? ''}
                  onChange={(e) =>
                    dispatch({
                      type: 'SET_METADATA',
                      metadata: { title: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Author">
                <input
                  type="text"
                  className="input"
                  value={state.metadata.author ?? ''}
                  onChange={(e) =>
                    dispatch({
                      type: 'SET_METADATA',
                      metadata: { author: e.target.value },
                    })
                  }
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Course">
                  <input
                    type="text"
                    className="input"
                    value={state.metadata.course ?? ''}
                    onChange={(e) =>
                      dispatch({
                        type: 'SET_METADATA',
                        metadata: { course: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="University">
                  <input
                    type="text"
                    className="input"
                    value={state.metadata.university ?? ''}
                    onChange={(e) =>
                      dispatch({
                        type: 'SET_METADATA',
                        metadata: { university: e.target.value },
                      })
                    }
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Version">
                  <input
                    type="text"
                    className="input"
                    value={state.metadata.version ?? ''}
                    onChange={(e) =>
                      dispatch({
                        type: 'SET_METADATA',
                        metadata: { version: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Date">
                  <input
                    type="text"
                    className="input"
                    placeholder="(auto)"
                    value={state.metadata.date ?? ''}
                    onChange={(e) =>
                      dispatch({
                        type: 'SET_METADATA',
                        metadata: { date: e.target.value },
                      })
                    }
                  />
                </Field>
              </div>
              <Field label="Description">
                <textarea
                  className="input"
                  rows={3}
                  value={state.metadata.description ?? ''}
                  onChange={(e) =>
                    dispatch({
                      type: 'SET_METADATA',
                      metadata: { description: e.target.value },
                    })
                  }
                />
              </Field>
            </>
          )}

          {tab === 'filter' && (
            <>
              <Toggle
                label="Include source files"
                checked={state.filter.includeSource}
                onChange={(v) =>
                  dispatch({ type: 'SET_FILTER', filter: { includeSource: v } })
                }
              />
              <Toggle
                label="Include config / project files"
                checked={state.filter.includeConfig}
                onChange={(v) =>
                  dispatch({ type: 'SET_FILTER', filter: { includeConfig: v } })
                }
              />
              <Toggle
                label="Include Markdown / README files"
                checked={state.filter.includeMarkdown}
                onChange={(v) =>
                  dispatch({
                    type: 'SET_FILTER',
                    filter: { includeMarkdown: v },
                  })
                }
              />
              <Field label="Excluded directories (comma-separated)">
                <input
                  type="text"
                  className="input"
                  value={state.filter.excludedDirs.join(', ')}
                  onChange={(e) =>
                    dispatch({
                      type: 'SET_FILTER',
                      filter: {
                        excludedDirs: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                />
              </Field>
              <Field label="Excluded extensions (comma-separated)">
                <input
                  type="text"
                  className="input"
                  value={state.filter.excludedExtensions.join(', ')}
                  onChange={(e) =>
                    dispatch({
                      type: 'SET_FILTER',
                      filter: {
                        excludedExtensions: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                />
              </Field>
              <Field label="Include glob patterns (one per line)">
                <textarea
                  className="input"
                  rows={3}
                  value={state.filter.includeGlobs.join('\n')}
                  onChange={(e) =>
                    dispatch({
                      type: 'SET_FILTER',
                      filter: {
                        includeGlobs: e.target.value
                          .split('\n')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                />
              </Field>
              <Field label="Exclude glob patterns (one per line)">
                <textarea
                  className="input"
                  rows={3}
                  value={state.filter.excludeGlobs.join('\n')}
                  onChange={(e) =>
                    dispatch({
                      type: 'SET_FILTER',
                      filter: {
                        excludeGlobs: e.target.value
                          .split('\n')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                />
              </Field>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

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
        className="h-4 w-4 accent-brand-500"
      />
      <span className="text-sm text-[#e6edf3]">{label}</span>
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
        className="h-8 w-12 rounded border border-[#30363d] bg-transparent"
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
