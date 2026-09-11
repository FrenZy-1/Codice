/**
 * Application state — a single React context that holds projects, selection,
 * document options, metadata, and the syntax theme.
 *
 * Components consume the state via `useAppState()` and dispatch actions via
 * the returned helpers. State is persisted to localStorage so users can
 * reload the page without losing their configuration (uploaded file content
 * is not persisted — only metadata and selection state).
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
import { defaultDocumentOptions } from '@/lib/defaultOptions';
import { defaultFilterConfig, type FilterConfig } from '@/lib/defaultExclusions';

export interface AppState {
  projects: ProjectEntry[];
  /** Per-project set of selected file ids (or null = use defaults). */
  selection: Record<string, Set<string> | null>;
  /** Per-project explicitly-excluded file ids (override defaults). */
  exclusions: Record<string, Set<string>>;
  /** Per-project explicitly-included file ids (override defaults). */
  inclusions: Record<string, Set<string>>;
  options: DocumentOptions;
  metadata: DocumentMetadata;
  filter: FilterConfig;
  presetId: string;
  outputFormat: 'docx' | 'pdf' | 'odt';
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
  | { type: 'SET_OPTIONS'; options: Partial<DocumentOptions> }
  | { type: 'SET_METADATA'; metadata: Partial<DocumentMetadata> }
  | { type: 'SET_FILTER'; filter: Partial<FilterConfig> }
  | { type: 'SET_PRESET'; presetId: string; options: DocumentOptions }
  | { type: 'SET_OUTPUT_FORMAT'; format: 'docx' | 'pdf' | 'odt' }
  | { type: 'SET_OUTPUT_FILENAME'; filename: string }
  | { type: 'CLEAR_PROJECTS' }
  | { type: 'LOAD_STATE'; state: AppState };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_PROJECT':
      return {
        ...state,
        projects: [...state.projects, action.project],
      };
    case 'REMOVE_PROJECT': {
      const projects = state.projects.filter(
        (p) => p.id !== action.projectId,
      );
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
          p.id === action.projectId
            ? { ...p, label: action.label }
            : p,
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
    case 'SET_OPTIONS':
      return { ...state, options: { ...state.options, ...action.options } };
    case 'SET_METADATA':
      return { ...state, metadata: { ...state.metadata, ...action.metadata } };
    case 'SET_FILTER':
      return { ...state, filter: { ...state.filter, ...action.filter } };
    case 'SET_PRESET':
      return {
        ...state,
        presetId: action.presetId,
        options: action.options,
      };
    case 'SET_OUTPUT_FORMAT':
      return { ...state, outputFormat: action.format };
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
      return action.state;
    default:
      return state;
  }
}

const initialState: AppState = {
  projects: [],
  selection: {},
  exclusions: {},
  inclusions: {},
  options: defaultDocumentOptions(),
  metadata: {
    title: 'Project Report',
    author: '',
    course: '',
    university: '',
    description: '',
    version: '',
  },
  filter: defaultFilterConfig(),
  presetId: 'university',
  outputFormat: 'docx',
  outputFilename: 'codedoc-document',
};

interface AppStateContext {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  /** Effective selection: explicit overrides + filter defaults. */
  getSelectedFiles: (projectId: string) => Set<string>;
}

const Ctx = createContext<AppStateContext | null>(null);

const STORAGE_KEY = 'codedoc-generator-state-v1';

function loadPersistedState(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Rehydrate Sets in selection/exclusions/inclusions
    const selection: Record<string, Set<string> | null> = {};
    for (const [k, v] of Object.entries(parsed.selection ?? {})) {
      selection[k] = v ? new Set(v as any) : null;
    }
    const exclusions: Record<string, Set<string>> = {};
    for (const [k, v] of Object.entries(parsed.exclusions ?? {})) {
      exclusions[k] = new Set(v as any);
    }
    const inclusions: Record<string, Set<string>> = {};
    for (const [k, v] of Object.entries(parsed.inclusions ?? {})) {
      inclusions[k] = new Set(v as any);
    }
    // Don't restore projects — file handles can't be persisted.
    return {
      ...initialState,
      ...parsed,
      projects: [],
      selection: {},
      exclusions,
      inclusions,
      filter: { ...defaultFilterConfig(), ...(parsed.filter ?? {}) },
    } as AppState;
  } catch {
    return null;
  }
}

function persistState(state: AppState) {
  try {
    // Strip file handles — can't serialize.
    const serializable = {
      ...state,
      projects: state.projects.map((p) => ({
        ...p,
        files: p.files.map((f) => ({ ...f, fileHandle: undefined })),
      })),
      selection: Object.fromEntries(
        Object.entries(state.selection).map(([k, v]) => [
          k,
          v ? Array.from(v) : null,
        ]),
      ),
      exclusions: Object.fromEntries(
        Object.entries(state.exclusions).map(([k, v]) => [
          k,
          Array.from(v),
        ]),
      ),
      inclusions: Object.fromEntries(
        Object.entries(state.inclusions).map(([k, v]) => [
          k,
          Array.from(v),
        ]),
      ),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // ignore quota errors
  }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, null, () => {
    const persisted = loadPersistedState();
    return persisted ?? initialState;
  });

  // Persist on changes (debounced).
  const persistTimer = useRef<number | null>(null);
  useEffect(() => {
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
    }
    persistTimer.current = window.setTimeout(() => {
      persistState(state);
    }, 500);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [state]);

  /** Returns the effective set of selected file ids for a project. */
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

  const value = useMemo(
    () => ({ state, dispatch, getSelectedFiles }),
    [state, getSelectedFiles],
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
