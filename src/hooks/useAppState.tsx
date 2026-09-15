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
  ImageAsset,
  FileDetails,
  ProjectEntry,
  ExportGroup,
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
import { isRuleDeselected, isRuleSelected } from '@/lib/selectionRules';
import {
  type CustomLayoutTemplate,
} from '@/lib/customLayouts/model';
import {
  loadCustomLayouts,
  storeCustomLayout,
  updateCustomLayout as persistUpdateCustomLayout,
  deleteCustomLayout as persistDeleteCustomLayout,
  duplicateCustomLayout as persistDuplicateCustomLayout,
  renameCustomLayout as persistRenameCustomLayout,
  importLayoutJson,
} from '@/lib/customLayouts/storage';
import {
  applyUITheme,
  getInitialUITheme,
  persistUITheme,
  type UIThemeMode,
} from '@/lib/themes/uiTheme';

export type OutputMode = 'combined' | 'separate' | 'groups';

export interface AppState {
  projects: ProjectEntry[];
  /** Per-project set of selected file ids (or null = use defaults). */
  selection: Record<string, Set<string> | null>;
  /** Per-project explicitly-excluded file ids (override defaults). */
  exclusions: Record<string, Set<string>>;
  /** Per-project explicitly-included file ids (override defaults). */
  inclusions: Record<string, Set<string>>;
  /** Per-project selection rules — glob patterns that deselect matching files. */
  projectExcludeRules: Record<string, string[]>;
  /** Per-project include rules — globs that rescue files from exclude rules. */
  projectIncludeRules: Record<string, string[]>;
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
  // ---- Per-file user content (spec §6-§9) — session-scoped, like uploads ----
  /** User-defined per-file details (summary/description/note), keyed by fileId. */
  fileDetails: Record<string, FileDetails>;
  /** Custom-layout field values per file (fieldId → value; image fields hold asset ids). */
  fileFieldValues: Record<string, Record<string, string>>;
  /** Custom-layout field values per project. */
  projectFieldValues: Record<string, Record<string, string>>;
  /** Document-level custom-layout field values (repeat=once). */
  documentFieldValues: Record<string, string>;
  // ---- Images (spec §10-§12) — session-scoped ----
  /** Imported image assets (normalized, self-contained data URLs). */
  imageAssets: ImageAsset[];
  /** Image asset ids attached to each file, in attachment order. */
  fileImages: Record<string, string[]>;
  // ---- Document file order (spec §13-§15) ----
  /** Canonical presentation order of file ids within each project. */
  fileOrder: Record<string, string[]>;
  // ---- Custom layout templates (spec §16-§31) ----
  /** All stored custom layout templates. */
  customLayouts: CustomLayoutTemplate[];
  /** Id of the applied custom layout template (null = standard flow). */
  appliedLayoutId: string | null;
  /** Per-SECTION field values of the applied layout: sectionId → fieldId → value. */
  sectionFieldValues: Record<string, Record<string, string>>;
  /** File → block assignment of the applied layout: blockId → file ids (§3).
   * Session-scoped (file ids die with uploads) — one file lives in exactly
   * one block across the whole template. */
  layoutAssignments: Record<string, string[]>;
  // ---- Export groups (§11): arbitrary project combinations per export ----
  exportGroups: ExportGroup[];
  // ---- Project merge (§11): undoable merge bookkeeping ----
  /** mergedProjectId → original source projects (for unmerge). */
  mergeSources: Record<string, { sources: ProjectEntry[]; mergedAt: number }>;
}

type Action =
  | { type: 'ADD_PROJECT'; project: ProjectEntry }
  | { type: 'ADD_STANDALONE_FILES'; project: ProjectEntry; files: ProjectEntry['files'] }
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
  | { type: 'SET_PROJECT_RULES'; projectId: string; rules: string[] }
  | { type: 'SET_PROJECT_INCLUDE_RULES'; projectId: string; rules: string[] }
  | { type: 'SET_UI_THEME'; mode: UIThemeMode }
  | { type: 'SET_OUTPUT_FORMAT'; format: 'docx' | 'pdf' | 'odt' }
  | { type: 'SET_OUTPUT_MODE'; mode: OutputMode }
  | { type: 'SET_OUTPUT_FILENAME'; filename: string }
  | { type: 'CLEAR_PROJECTS' }
  | { type: 'LOAD_STATE'; state: Partial<AppState> }
  // ---- File details / images / ordering / custom layouts ----
  | { type: 'SET_FILE_DETAILS'; fileId: string; details: FileDetails }
  | { type: 'SET_FILE_ORDER'; projectId: string; order: string[] }
  | { type: 'RESET_FILE_ORDER'; projectId: string }
  | { type: 'ADD_IMAGE_ASSETS'; assets: ImageAsset[] }
  | { type: 'REMOVE_IMAGE_ASSET'; id: string }
  | { type: 'UPDATE_IMAGE_ASSET'; id: string; caption?: string; name?: string }
  | { type: 'SET_FILE_IMAGES'; fileId: string; imageIds: string[] }
  | { type: 'SET_FILE_FIELD_VALUES'; fileId: string; values: Record<string, string> }
  | { type: 'SET_PROJECT_FIELD_VALUES'; projectId: string; values: Record<string, string> }
  | { type: 'SET_DOCUMENT_FIELD_VALUES'; values: Record<string, string> }
  | { type: 'SAVE_CUSTOM_LAYOUT'; template: CustomLayoutTemplate }
  | { type: 'UPDATE_CUSTOM_LAYOUT'; template: CustomLayoutTemplate }
  | { type: 'DELETE_CUSTOM_LAYOUT'; id: string }
  | { type: 'DUPLICATE_CUSTOM_LAYOUT'; template: CustomLayoutTemplate; newName?: string }
  | { type: 'RENAME_CUSTOM_LAYOUT'; id: string; name: string }
  | { type: 'IMPORT_CUSTOM_LAYOUT'; json: string; fallbackName?: string }
  | { type: 'SYNC_CUSTOM_LAYOUTS'; templates: CustomLayoutTemplate[] }
  | { type: 'SET_APPLIED_LAYOUT'; layoutId: string | null }
  // ---- v2 layout content + assignment (§3/§4/§8) ----
  | { type: 'SET_SECTION_FIELD_VALUES'; sectionId: string; values: Record<string, string> }
  | { type: 'CLEAR_LAYOUT_CONTENT' }
  /** Assign a file to a block — atomically MOVES it out of any other block
   * of the applied template (one-file-one-section rule, §3). */
  | { type: 'ASSIGN_FILE_TO_BLOCK'; blockId: string; fileId: string; position?: number }
  | { type: 'UNASSIGN_FILE'; fileId: string; blockId?: string }
  | { type: 'CLEAR_BLOCK_ASSIGNMENTS'; blockId: string }
  | { type: 'REORDER_ASSIGNED_FILE'; blockId: string; from: number; to: number }
  // ---- Export groups (§11) ----
  | { type: 'ADD_EXPORT_GROUP'; group: ExportGroup }
  | { type: 'UPDATE_EXPORT_GROUP'; group: ExportGroup }
  | { type: 'DELETE_EXPORT_GROUP'; id: string }
  // ---- Project merge / unmerge (§11) ----
  | { type: 'MERGE_PROJECTS'; sourceIds: string[]; label?: string; mergedId: string }
  | { type: 'UNMERGE_PROJECTS'; mergedId: string };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_PROJECT':
      return { ...state, projects: [...state.projects, action.project] };
    case 'ADD_STANDALONE_FILES': {
      // Standalone files merge into the PERSISTENT standalone project
      // (spec §4): first addition adds the project, later additions append
      // their files (fresh ids → duplicate names stay independent).
      const existing = state.projects.find((p) => p.id === action.project.id);
      if (!existing) {
        return { ...state, projects: [...state.projects, action.project] };
      }
      return {
        ...state,
        projects: state.projects.map((p) => {
          if (p.id !== action.project.id) return p;
          const files = [...p.files, ...action.files];
          const selected = files.filter((f) => !f.excluded);
          return {
            ...p,
            files,
            selectedCount: selected.length,
            selectedSize: selected.reduce((s, f) => s + f.size, 0),
            warnings: [...p.warnings, ...action.project.warnings].slice(-12),
          };
        }),
      };
    }
    case 'REMOVE_PROJECT': {
      const projects = state.projects.filter((p) => p.id !== action.projectId);
      const selection = { ...state.selection };
      delete selection[action.projectId];
      const exclusions = { ...state.exclusions };
      delete exclusions[action.projectId];
      const inclusions = { ...state.inclusions };
      delete inclusions[action.projectId];
      const projectExcludeRules = { ...state.projectExcludeRules };
      delete projectExcludeRules[action.projectId];
      const projectIncludeRules = { ...state.projectIncludeRules };
      delete projectIncludeRules[action.projectId];
      const fileOrder = { ...state.fileOrder };
      delete fileOrder[action.projectId];
      const projectFieldValues = { ...state.projectFieldValues };
      delete projectFieldValues[action.projectId];
      // Merged projects vanish entirely — drop their undo record + scrub
      // them from export groups.
      const mergeSources = { ...state.mergeSources };
      if (action.projectId in mergeSources) delete mergeSources[action.projectId];
      const exportGroups = state.exportGroups
        .map((g) => ({
          ...g,
          projectIds: g.projectIds.filter((id) => id !== action.projectId),
        }))
        .filter((g) => g.projectIds.length > 0);
      return {
        ...state,
        projects,
        selection,
        exclusions,
        inclusions,
        projectExcludeRules,
        projectIncludeRules,
        fileOrder,
        projectFieldValues,
        mergeSources,
        exportGroups,
      };
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
    case 'SET_PROJECT_RULES': {
      const rules = { ...state.projectExcludeRules };
      if (action.rules.length > 0) rules[action.projectId] = action.rules;
      else delete rules[action.projectId];
      return { ...state, projectExcludeRules: rules };
    }
    case 'SET_PROJECT_INCLUDE_RULES': {
      const rules = { ...state.projectIncludeRules };
      if (action.rules.length > 0) rules[action.projectId] = action.rules;
      else delete rules[action.projectId];
      return { ...state, projectIncludeRules: rules };
    }
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
        projectExcludeRules: {},
        projectIncludeRules: {},
        fileOrder: {},
        projectFieldValues: {},
        fileDetails: {},
        fileFieldValues: {},
        fileImages: {},
      };
    case 'SET_FILE_DETAILS':
      return {
        ...state,
        fileDetails: { ...state.fileDetails, [action.fileId]: action.details },
      };
    case 'SET_FILE_ORDER':
      return {
        ...state,
        fileOrder: { ...state.fileOrder, [action.projectId]: action.order },
      };
    case 'RESET_FILE_ORDER': {
      const fileOrder = { ...state.fileOrder };
      delete fileOrder[action.projectId];
      return { ...state, fileOrder };
    }
    case 'ADD_IMAGE_ASSETS':
      return {
        ...state,
        imageAssets: [...state.imageAssets, ...action.assets],
      };
    case 'REMOVE_IMAGE_ASSET':
      return {
        ...state,
        imageAssets: state.imageAssets.filter((a) => a.id !== action.id),
        // Drop dangling attachments.
        fileImages: Object.fromEntries(
          Object.entries(state.fileImages).map(([k, ids]) => [
            k,
            ids.filter((id) => id !== action.id),
          ]),
        ),
      };
    case 'UPDATE_IMAGE_ASSET':
      return {
        ...state,
        imageAssets: state.imageAssets.map((a) =>
          a.id === action.id
            ? {
                ...a,
                caption: action.caption !== undefined ? action.caption : a.caption,
                name: action.name !== undefined ? action.name : a.name,
              }
            : a,
        ),
      };
    case 'SET_FILE_IMAGES':
      return {
        ...state,
        fileImages: { ...state.fileImages, [action.fileId]: action.imageIds },
      };
    case 'SET_FILE_FIELD_VALUES':
      return {
        ...state,
        fileFieldValues: {
          ...state.fileFieldValues,
          [action.fileId]: action.values,
        },
      };
    case 'SET_PROJECT_FIELD_VALUES':
      return {
        ...state,
        projectFieldValues: {
          ...state.projectFieldValues,
          [action.projectId]: action.values,
        },
      };
    case 'SET_DOCUMENT_FIELD_VALUES':
      return { ...state, documentFieldValues: action.values };
    case 'SAVE_CUSTOM_LAYOUT': {
      const customLayouts = storeCustomLayout(action.template);
      return { ...state, customLayouts, appliedLayoutId: action.template.id };
    }
    case 'UPDATE_CUSTOM_LAYOUT': {
      const customLayouts = persistUpdateCustomLayout(action.template);
      return { ...state, customLayouts };
    }
    case 'DELETE_CUSTOM_LAYOUT': {
      const customLayouts = persistDeleteCustomLayout(action.id);
      const appliedLayoutId =
        state.appliedLayoutId === action.id ? null : state.appliedLayoutId;
      return { ...state, customLayouts, appliedLayoutId };
    }
    case 'DUPLICATE_CUSTOM_LAYOUT': {
      const { templates } = persistDuplicateCustomLayout(
        action.template,
        action.newName,
      );
      return { ...state, customLayouts: templates };
    }
    case 'RENAME_CUSTOM_LAYOUT': {
      const customLayouts = persistRenameCustomLayout(action.id, action.name);
      return { ...state, customLayouts };
    }
    case 'IMPORT_CUSTOM_LAYOUT': {
      importLayoutJson(action.json, action.fallbackName);
      return { ...state, customLayouts: loadCustomLayouts() };
    }
    case 'SYNC_CUSTOM_LAYOUTS':
      return { ...state, customLayouts: action.templates };
    case 'SET_APPLIED_LAYOUT':
      return { ...state, appliedLayoutId: action.layoutId };
    case 'SET_SECTION_FIELD_VALUES':
      return {
        ...state,
        sectionFieldValues: {
          ...state.sectionFieldValues,
          [action.sectionId]: action.values,
        },
      };
    case 'CLEAR_LAYOUT_CONTENT':
      return { ...state, sectionFieldValues: {}, fileFieldValues: {} };
    case 'ASSIGN_FILE_TO_BLOCK': {
      // One-file-one-section (§3): assigning a file to a block atomically
      // removes it from every other block of the assignment map.
      const next: Record<string, string[]> = {};
      for (const [blockId, ids] of Object.entries(state.layoutAssignments)) {
        next[blockId] = ids.filter((id) => id !== action.fileId);
      }
      const target = [...(next[action.blockId] ?? [])];
      const pos = action.position ?? target.length;
      target.splice(Math.max(0, Math.min(pos, target.length)), 0, action.fileId);
      next[action.blockId] = target;
      return { ...state, layoutAssignments: next };
    }
    case 'UNASSIGN_FILE': {
      const next: Record<string, string[]> = {};
      for (const [blockId, ids] of Object.entries(state.layoutAssignments)) {
        if (action.blockId && blockId !== action.blockId) {
          next[blockId] = ids;
          continue;
        }
        next[blockId] = ids.filter((id) => id !== action.fileId);
      }
      return { ...state, layoutAssignments: next };
    }
    case 'CLEAR_BLOCK_ASSIGNMENTS': {
      const next = { ...state.layoutAssignments };
      delete next[action.blockId];
      return { ...state, layoutAssignments: next };
    }
    case 'REORDER_ASSIGNED_FILE': {
      const ids = [...(state.layoutAssignments[action.blockId] ?? [])];
      const to = Math.max(0, Math.min(action.to, ids.length - 1));
      if (action.from < 0 || action.from >= ids.length) return state;
      const [moved] = ids.splice(action.from, 1);
      ids.splice(to, 0, moved);
      return {
        ...state,
        layoutAssignments: { ...state.layoutAssignments, [action.blockId]: ids },
      };
    }
    case 'ADD_EXPORT_GROUP':
      return { ...state, exportGroups: [...state.exportGroups, action.group] };
    case 'UPDATE_EXPORT_GROUP':
      return {
        ...state,
        exportGroups: state.exportGroups.map((g) =>
          g.id === action.group.id ? action.group : g,
        ),
      };
    case 'DELETE_EXPORT_GROUP':
      return {
        ...state,
        exportGroups: state.exportGroups.filter((g) => g.id !== action.id),
      };
    case 'MERGE_PROJECTS': {
      // §11 — merge N projects into one unified project. File ids, relative
      // paths and handles are PRESERVED (duplicates from different sources
      // stay independently addressable). Fully undoable via mergeSources.
      const sources = state.projects.filter((p) => action.sourceIds.includes(p.id));
      if (sources.length < 2) return state;
      const files = sources.flatMap((p) => p.files);
      const warnings = sources.flatMap((p) => p.warnings).slice(-12);
      const selected = files.filter((f) => !f.excluded);
      const merged: ProjectEntry = {
        id: action.mergedId,
        label: action.label ?? sources.map((p) => p.label).join(' + '),
        folderName: sources.map((p) => p.folderName).join('+'),
        files,
        selectedCount: selected.length,
        selectedSize: selected.reduce((s, f) => s + f.size, 0),
        warnings,
        addedAt: Date.now(),
      };
      // Insert the merged project at the position of the first source.
      const insertAt = state.projects.findIndex((p) => p.id === sources[0].id);
      const projects = state.projects.filter((p) => !action.sourceIds.includes(p.id));
      projects.splice(Math.max(0, insertAt), 0, merged);
      // §11 — export groups referencing any source project now reference
      // the merged project (order preserved, duplicates collapsed); undo
      // swaps them back via UNMERGE_PROJECTS.
      const exportGroups = state.exportGroups.map((g) => {
        if (!g.projectIds.some((id) => action.sourceIds.includes(id))) return g;
        const ids: string[] = [];
        for (const id of g.projectIds) {
          if (action.sourceIds.includes(id)) {
            if (!ids.includes(action.mergedId)) ids.push(action.mergedId);
          } else {
            ids.push(id);
          }
        }
        return { ...g, projectIds: ids };
      });
      return {
        ...state,
        projects,
        mergeSources: {
          ...state.mergeSources,
          [action.mergedId]: { sources, mergedAt: Date.now() },
        },
        exportGroups,
      };
    }
    case 'UNMERGE_PROJECTS': {
      // §11 — split a previously merged project back into its sources:
      // original names, files, handles and (via file ids) section/block
      // assignments are restored. Export groups referencing the merged id
      // get the source ids back (best effort, order preserved).
      const record = state.mergeSources[action.mergedId];
      if (!record) return state;
      const mergedIndex = state.projects.findIndex((p) => p.id === action.mergedId);
      const projects = state.projects.filter((p) => p.id !== action.mergedId);
      projects.splice(Math.max(0, mergedIndex), 0, ...record.sources);
      const mergeSources = { ...state.mergeSources };
      delete mergeSources[action.mergedId];
      const exportGroups = state.exportGroups.map((g) => {
        if (!g.projectIds.includes(action.mergedId)) return g;
        const idx = g.projectIds.indexOf(action.mergedId);
        const ids = [...g.projectIds];
        ids.splice(idx, 1, ...record.sources.map((s) => s.id));
        return { ...g, projectIds: ids };
      });
      return { ...state, projects, mergeSources, exportGroups };
    }
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
    projectExcludeRules: {},
    projectIncludeRules: {},
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
    fileDetails: {},
    fileFieldValues: {},
    projectFieldValues: {},
    documentFieldValues: {},
    imageAssets: [],
    fileImages: {},
    fileOrder: {},
    customLayouts: loadCustomLayouts(),
    appliedLayoutId: null,
    sectionFieldValues: {},
    layoutAssignments: {},
    exportGroups: [],
    mergeSources: {},
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
    if (typeof parsed.appliedLayoutId === 'string' || parsed.appliedLayoutId === null) {
      result.appliedLayoutId = parsed.appliedLayoutId;
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
    if (
      parsed.projectExcludeRules &&
      typeof parsed.projectExcludeRules === 'object'
    ) {
      const rules: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(parsed.projectExcludeRules)) {
        if (Array.isArray(v)) rules[k] = v.filter((x) => typeof x === 'string');
      }
      if (Object.keys(rules).length) result.projectExcludeRules = rules;
    }
    if (
      parsed.projectIncludeRules &&
      typeof parsed.projectIncludeRules === 'object'
    ) {
      const rules: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(parsed.projectIncludeRules)) {
        if (Array.isArray(v)) rules[k] = v.filter((x) => typeof x === 'string');
      }
      if (Object.keys(rules).length) result.projectIncludeRules = rules;
    }
    // Export groups persist (structure only — project ids are pruned of
    // stale references when projects rehydrate; a group left empty is
    // dropped entirely).
    if (Array.isArray(parsed.exportGroups)) {
      const groups = (parsed.exportGroups as Array<{ id?: unknown; name?: unknown; projectIds?: unknown }>)
        .filter(
          (g): g is { id: string; name: string; projectIds: string[] } =>
            typeof g.id === 'string' &&
            typeof g.name === 'string' &&
            Array.isArray(g.projectIds) &&
            g.projectIds.every((x) => typeof x === 'string'),
        )
        .map((g) => ({ id: g.id, name: g.name, projectIds: [...new Set(g.projectIds)] }));
      if (groups.length) result.exportGroups = groups;
    }
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
      appliedLayoutId: state.appliedLayoutId,
      exclusions: Object.fromEntries(
        Object.entries(state.exclusions).map(([k, v]) => [k, Array.from(v)]),
      ),
      inclusions: Object.fromEntries(
        Object.entries(state.inclusions).map(([k, v]) => [k, Array.from(v)]),
      ),
      projectExcludeRules: state.projectExcludeRules,
      projectIncludeRules: state.projectIncludeRules,
      exportGroups: state.exportGroups.map((g) => ({
        id: g.id,
        name: g.name,
        // Only persist ids of projects that still exist; drop empty groups.
        projectIds: g.projectIds.filter((id) =>
          state.projects.some((p) => p.id === id),
        ),
      })).filter((g) => g.projectIds.length > 0),
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
      const rules = state.projectExcludeRules[projectId] ?? [];
      const includeRules = state.projectIncludeRules[projectId] ?? [];
      const result = new Set<string>();
      for (const file of project.files) {
        if (file.excluded && !incl.has(file.id)) continue;
        // An explicit user exclusion (checkbox unchecked) always wins —
        // even over include rules.
        if (excl.has(file.id)) continue;
        // Selection rules deselect matching files unless the user
        // explicitly re-included them OR an include rule rescues them.
        if (
          !incl.has(file.id) &&
          isRuleDeselected(file, rules) &&
          !isRuleSelected(file, includeRules)
        ) {
          continue;
        }
        result.add(file.id);
      }
      return result;
    },
    [
      state.projects,
      state.exclusions,
      state.inclusions,
      state.projectExcludeRules,
      state.projectIncludeRules,
    ],
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
