/**
 * Application state — a single React context that holds projects, selection,
 * document preset, metadata, UI theme, output mode, and filter config.
 *
 * The new model replaces the legacy `DocumentOptions` with a richer
 * `DocumentPreset` (template). A backward-compatible `options` getter is
 * still derived from the preset so the existing exporters can keep working
 * while they are migrated to read the preset directly.
 *
 * State is persisted to localStorage so users can reload the page without
 * losing their configuration. Uploaded file content is never persisted —
 * only metadata and selection state.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import type {
  DocumentMetadata,
  DocumentOptions,
  ProjectEntry,
} from '@/types';
import { defaultFilterConfig, type FilterConfig } from '@/lib/defaultExclusions';
import {
  BUILT_IN_DOCUMENT_PRESETS,
  DEFAULT_DOCUMENT_PRESET_ID,
  getBuiltInPreset,
} from '@/lib/presets/builtInPresets';
import {
  findPreset,
  loadCustomPresets,
  saveCustomPreset,
  updateCustomPreset,
  deleteCustomPreset,
  duplicatePreset,
  renameCustomPreset,
  exportPreset as exportPresetJson,
  importPreset as importPresetJson,
} from '@/lib/presets/customPresets';
import type { DocumentPreset } from '@/lib/presets/documentPreset';
import { presetToOptions } from '@/lib/presets/presetToOptions';
import {
  applyUITheme,
  getInitialUITheme,
  persistUITheme,
  type UIThemeMode,
} from '@/lib/themes/uiTheme';

export type OutputMode = 'combined' | 'separate';

export interface AppState {
  projects: ProjectEntry[];
  /** Per-project set of selected file ids (or null = use defaults). */
  selection: Record<string, Set<string> | null>;
  /** Per-project explicitly-excluded file ids (override defaults). */
  exclusions: Record<string, Set<string>>;
  /** Per-project explicitly-included file ids (override defaults). */
  inclusions: Record<string, Set<string>>;
  /** Active document preset (the template). */
  preset: DocumentPreset;
  /** All known custom presets (built-ins are constants). */
  customPresets: DocumentPreset[];
  /** Document metadata for the title page. */
  metadata: DocumentMetadata;
  /** Filter rules for file discovery. */
  filter: FilterConfig;
  /** UI theme mode. */
  uiTheme: UIThemeMode;
  /** Output format. */
  outputFormat: 'docx' | 'pdf' | 'odt';
  /** Multi-project output mode. */
  outputMode: OutputMode;
  /** Output filename (combined mode). */
  outputFilename: string;
}

type Action =
  | { type: 'ADD_PROJECT'; project: ProjectEntry }
  | { type: 'REMOVE_PROJECT'; projectId: string }
  | { type: 'RENAME_PROJECT'; projectId: string; label: string }
  | { type: 'REORDER_PROJECTS'; from: number; to: number }
  | { type: 'SET_SELECTION'; projectId: string; selection: Set<string> | null }
  | {
      type: 'TOGGLE_FILE';
      projectId: string;
      fileId: string;
      selected: boolean;
    }
  | {
      type: 'TOGGLE_DIRECTORY';
      projectId: string;
      fileIds: string[];
      selected: boolean;
    }
  | { type: 'SET_PRESET'; preset: DocumentPreset }
  | { type: 'UPDATE_PRESET'; patch: Partial<DocumentPreset> }
  | { type: 'SAVE_CUSTOM_PRESET'; preset: DocumentPreset }
  | { type: 'UPDATE_CUSTOM_PRESET'; preset: DocumentPreset }
  | { type: 'DELETE_CUSTOM_PRESET'; id: string }
  | { type: 'DUPLICATE_PRESET'; preset: DocumentPreset; newName?: string }
  | { type: 'RENAME_CUSTOM_PRESET'; id: string; name: string }
  | { type: 'IMPORT_CUSTOM_PRESET'; json: string; fallbackName?: string }
  | { type: 'SET_METADATA'; metadata: Partial<DocumentMetadata> }
  | { type: 'SET_FILTER'; filter: Partial<FilterConfig> }
  | { type: 'SET_UI_THEME'; mode: UIThemeMode }
  | { type: 'SET_OUTPUT_FORMAT'; format: 'docx' | 'pdf' | 'odt' }
  | { type: 'SET_OUTPUT_MODE'; mode: OutputMode }
  | { type: 'SET_OUTPUT_FILENAME'; filename: string }
  | { type: 'CLEAR_PROJECTS' }
  | { type: 'LOAD_STATE'; state: Partial<AppState> };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_PROJECT':
      return { ...state, projects: [...state.projects, action.project] };
    case 'REMOVE_PROJECT': {
      const projects = state.projects.filter((p) => p.id !== action.projectId);
      const selection = { ...state.selection };
      delete selection[action.projectId];
      const exclusions = { ...state.exclusions };
      delete exclusions[action.projectId];
      const inclusions = { ...state.inclusions };
      delete inclusions[action.projectId];
      return { ...state, projects, selection, exclusions, inclusions };
    }
    case 'RENAME_PROJECT':
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.projectId ? { ...p, label: action.label } : p,
        ),
      };
    case 'REORDER_PROJECTS': {
      const projects = [...state.projects];
      const [moved] = projects.splice(action.from, 1);
      projects.splice(action.to, 0, moved);
      return { ...state, projects };
    }
    case 'SET_SELECTION':
      return {
        ...state,
        selection: {
          ...state.selection,
          [action.projectId]: action.selection,
        },
      };
    case 'TOGGLE_FILE': {
      const current = state.exclusions[action.projectId] ?? new Set();
      const included = state.inclusions[action.projectId] ?? new Set();
      const newExcl = new Set(current);
      const newIncl = new Set(included);
      if (action.selected) {
        newExcl.delete(action.fileId);
        newIncl.add(action.fileId);
      } else {
        newExcl.add(action.fileId);
        newIncl.delete(action.fileId);
      }
      return {
        ...state,
        exclusions: { ...state.exclusions, [action.projectId]: newExcl },
        inclusions: { ...state.inclusions, [action.projectId]: newIncl },
      };
    }
    case 'TOGGLE_DIRECTORY': {
      const current = state.exclusions[action.projectId] ?? new Set();
      const included = state.inclusions[action.projectId] ?? new Set();
      const newExcl = new Set(current);
      const newIncl = new Set(included);
      for (const fileId of action.fileIds) {
        if (action.selected) {
          newExcl.delete(fileId);
          newIncl.add(fileId);
        } else {
          newExcl.add(fileId);
          newIncl.delete(fileId);
        }
      }
      return {
        ...state,
        exclusions: { ...state.exclusions, [action.projectId]: newExcl },
        inclusions: { ...state.inclusions, [action.projectId]: newIncl },
      };
    }
    case 'SET_PRESET':
      return { ...state, preset: action.preset };
    case 'UPDATE_PRESET':
      return { ...state, preset: { ...state.preset, ...action.patch } };
    case 'SAVE_CUSTOM_PRESET': {
      const saved = saveCustomPreset(action.preset);
      return {
        ...state,
        customPresets: loadCustomPresets(),
        preset: saved,
      };
    }
    case 'UPDATE_CUSTOM_PRESET': {
      const updated = updateCustomPreset(action.preset);
      return {
        ...state,
        customPresets: loadCustomPresets(),
        preset: updated,
      };
    }
    case 'DELETE_CUSTOM_PRESET': {
      deleteCustomPreset(action.id);
      const customPresets = loadCustomPresets();
      // If we deleted the active preset, fall back to the default built-in.
      const preset =
        state.preset.id === action.id
          ? (getBuiltInPreset(DEFAULT_DOCUMENT_PRESET_ID) ?? BUILT_IN_DOCUMENT_PRESETS[0])
          : state.preset;
      return { ...state, customPresets, preset };
    }
    case 'DUPLICATE_PRESET': {
      const dup = duplicatePreset(action.preset, action.newName);
      return {
        ...state,
        customPresets: loadCustomPresets(),
        preset: dup,
      };
    }
    case 'RENAME_CUSTOM_PRESET': {
      renameCustomPreset(action.id, action.name);
      const customPresets = loadCustomPresets();
      const preset =
        state.preset.id === action.id
          ? { ...state.preset, name: action.name }
          : state.preset;
      return { ...state, customPresets, preset };
    }
    case 'IMPORT_CUSTOM_PRESET': {
      const imported = importPresetJson(action.json, action.fallbackName);
      return {
        ...state,
        customPresets: loadCustomPresets(),
        preset: imported,
      };
    }
    case 'SET_METADATA':
      return { ...state, metadata: { ...state.metadata, ...action.metadata } };
    case 'SET_FILTER':
      return { ...state, filter: { ...state.filter, ...action.filter } };
    case 'SET_UI_THEME':
      persistUITheme(action.mode);
      applyUITheme(action.mode);
      return { ...state, uiTheme: action.mode };
    case 'SET_OUTPUT_FORMAT':
      return { ...state, outputFormat: action.format };
    case 'SET_OUTPUT_MODE':
      return { ...state, outputMode: action.mode };
    case 'SET_OUTPUT_FILENAME':
      return { ...state, outputFilename: action.filename };
    case 'CLEAR_PROJECTS':
      return {
        ...state,
        projects: [],
        selection: {},
        exclusions: {},
        inclusions: {},
      };
    case 'LOAD_STATE':
      return { ...state, ...action.state };
    default:
      return state;
  }
}

function buildInitialState(): AppState {
  const initialPreset =
    getBuiltInPreset(DEFAULT_DOCUMENT_PRESET_ID) ?? BUILT_IN_DOCUMENT_PRESETS[0];
  return {
    projects: [],
    selection: {},
    exclusions: {},
    inclusions: {},
    preset: initialPreset,
    customPresets: loadCustomPresets(),
    metadata: {
      title: 'Project Report',
      author: '',
      course: '',
      university: '',
      description: '',
      version: '',
    },
    filter: defaultFilterConfig(),
    uiTheme: getInitialUITheme(),
    outputFormat: 'docx',
    outputMode: 'combined',
    outputFilename: 'Codice_Output',
  };
}

interface AppStateContext {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  /** Effective selection: explicit overrides + filter defaults. */
  getSelectedFiles: (projectId: string) => Set<string>;
  /** Derive legacy DocumentOptions from the active preset. */
  getDocumentOptions: () => DocumentOptions;
  /** All presets (built-in + custom) for the selector. */
  allPresets: DocumentPreset[];
}

const Ctx = createContext<AppStateContext | null>(null);

const STORAGE_KEY = 'codice-app-state-v2';

function loadPersistedState(): Partial<AppState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const result: Partial<AppState> = {};
    if (parsed.metadata) result.metadata = parsed.metadata;
    if (parsed.filter) {
      result.filter = { ...defaultFilterConfig(), ...parsed.filter };
    }
    if (parsed.outputFormat) result.outputFormat = parsed.outputFormat;
    if (parsed.outputMode) result.outputMode = parsed.outputMode;
    if (parsed.outputFilename) result.outputFilename = parsed.outputFilename;
    if (parsed.uiTheme) result.uiTheme = parsed.uiTheme;
    if (parsed.presetId) {
      const preset = findPreset(parsed.presetId);
      if (preset) result.preset = preset;
    }
    // Rehydrate Sets.
    const exclusions: Record<string, Set<string>> = {};
    for (const [k, v] of Object.entries(parsed.exclusions ?? {})) {
      exclusions[k] = new Set(v as any);
    }
    if (Object.keys(exclusions).length) result.exclusions = exclusions;
    const inclusions: Record<string, Set<string>> = {};
    for (const [k, v] of Object.entries(parsed.inclusions ?? {})) {
      inclusions[k] = new Set(v as any);
    }
    if (Object.keys(inclusions).length) result.inclusions = inclusions;
    return result;
  } catch {
    return null;
  }
}

function persistState(state: AppState) {
  try {
    const serializable = {
      metadata: state.metadata,
      filter: state.filter,
      outputFormat: state.outputFormat,
      outputMode: state.outputMode,
      outputFilename: state.outputFilename,
      uiTheme: state.uiTheme,
      presetId: state.preset.id,
      exclusions: Object.fromEntries(
        Object.entries(state.exclusions).map(([k, v]) => [k, Array.from(v)]),
      ),
      inclusions: Object.fromEntries(
        Object.entries(state.inclusions).map(([k, v]) => [k, Array.from(v)]),
      ),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // ignore quota errors
  }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, null, () => {
    const initial = buildInitialState();
    const persisted = loadPersistedState();
    return persisted ? { ...initial, ...persisted } : initial;
  });

  // Apply the UI theme on mount and whenever it changes.
  useEffect(() => {
    applyUITheme(state.uiTheme);
  }, [state.uiTheme]);

  // Persist on changes (debounced).
  const persistTimer = useRef<number | null>(null);
  useEffect(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => persistState(state), 500);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [state]);

  const getSelectedFiles = useCallback(
    (projectId: string): Set<string> => {
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) return new Set();
      const excl = state.exclusions[projectId] ?? new Set();
      const incl = state.inclusions[projectId] ?? new Set();
      const result = new Set<string>();
      for (const file of project.files) {
        if (file.excluded && !incl.has(file.id)) continue;
        if (excl.has(file.id)) continue;
        result.add(file.id);
      }
      return result;
    },
    [state.projects, state.exclusions, state.inclusions],
  );

  const getDocumentOptions = useCallback(
    (): DocumentOptions => presetToOptions(state.preset),
    [state.preset],
  );

  const allPresets = useMemo(
    () => [...BUILT_IN_DOCUMENT_PRESETS, ...state.customPresets],
    [state.customPresets],
  );

  const value = useMemo(
    () => ({
      state,
      dispatch,
      getSelectedFiles,
      getDocumentOptions,
      allPresets,
    }),
    [state, getSelectedFiles, getDocumentOptions, allPresets],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppStateContext {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return ctx;
}

// Re-export preset JSON helpers for convenience.
export {
  exportPresetJson as exportPreset,
  importPresetJson as importPreset,
};
