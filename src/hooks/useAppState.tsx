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
 * only metadata and selection state; imported cover-page assets are the
 * one exception: their binary media is too large for localStorage, so
 * they persist to IndexedDB instead (lib/coverStorage, WS-8a).
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
  CoverPageAsset,
} from '@/types';
import { defaultFilterConfig, type FilterConfig } from '@/lib/defaultExclusions';
import {
  applyPrefsToFilterConfig,
  loadDefaultSelectionPrefs,
  saveDefaultSelectionPrefs,
  type DefaultSelectionPrefs,
} from '@/lib/defaultSelectionPrefs';
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
  normalizeTemplate,
  pruneAssignments,
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
import {
  loadCoverAssets,
  saveCoverAssets,
} from '@/lib/coverStorage';
import {
  loadImageAssets,
  saveImageAssets,
} from '@/lib/imageStorage';
import { useToastOptional } from '@/components/common/Toast';
import { emitPersistSignal } from '@/lib/persistSignal';

export type OutputMode = 'combined' | 'separate' | 'groups';

export interface AppState {
  projects: ProjectEntry[];
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
  /** Document-level custom-layout field values (file-level bound nodes, §21). */
  documentFieldValues: Record<string, string>;
  // ---- Images (spec §10-§12) — session-scoped ----
  /** Imported image assets (normalized, self-contained data URLs). */
  imageAssets: ImageAsset[];
  /** Image asset ids attached to each file, in attachment order. */
  fileImages: Record<string, string[]>;
  // ---- Cover pages (§42-§44) — persisted to IndexedDB (WS-8a) ----
  /** Imported .docx cover pages (first page only, preserved as-is). */
  coverPages: CoverPageAsset[];
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
  // ---- Export groups (§11/§22-§29): per-export configuration ----
  exportGroups: ExportGroup[];
  /** §27 — when true every export uses the applied layout; when false each
   * export group may select its own layout template via `layoutId`. */
  sameLayoutForAllExports: boolean;
  // ---- Project merge (§11): undoable merge bookkeeping ----
  /** mergedProjectId → original source projects + per-project state to restore. */
  mergeSources: Record<
    string,
    {
      sources: ProjectEntry[];
      mergedAt: number;
      /** Per-project state captured at merge time for exact undo (§31). */
      fileOrder: Record<string, string[]>;
      exclusions: Record<string, Set<string>>;
      inclusions: Record<string, Set<string>>;
      /** §35 — per-project selection rules captured at merge time. */
      excludeRules: Record<string, string[]>;
      includeRules: Record<string, string[]>;
    }
  >;
}

type Action =
  | { type: 'ADD_PROJECT'; project: ProjectEntry }
  | { type: 'ADD_STANDALONE_FILES'; project: ProjectEntry; files: ProjectEntry['files'] }
  | { type: 'REMOVE_PROJECT'; projectId: string }
  | { type: 'RENAME_PROJECT'; projectId: string; label: string }
  | { type: 'REORDER_PROJECTS'; from: number; to: number }
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
  | { type: 'SAVE_DEFAULT_SELECTION_PREFS'; prefs: DefaultSelectionPrefs }
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
  | { type: 'SET_DOCUMENT_FIELD_VALUES'; values: Record<string, string> }
  // ---- Cover pages (§42) ----
  | { type: 'ADD_COVER_PAGE'; cover: CoverPageAsset }
  | { type: 'REMOVE_COVER_PAGE'; id: string }
  | { type: 'RENAME_COVER_PAGE'; id: string; name: string }
  /** WS-8a — hydrate the library from IndexedDB on mount. Only fills an
   * EMPTY list so an in-session import racing the async load is never
   * clobbered. */
  | { type: 'RESTORE_COVER_PAGES'; covers: CoverPageAsset[] }
  /** WS-9a — hydrate the image library from IndexedDB on mount. Only
   * fills an EMPTY list so an in-session import racing the async load
   * is never clobbered. */
  | { type: 'RESTORE_IMAGE_ASSETS'; assets: ImageAsset[] }
  | { type: 'SAVE_CUSTOM_LAYOUT'; template: CustomLayoutTemplate }
  | { type: 'UPDATE_CUSTOM_LAYOUT'; template: CustomLayoutTemplate }
  | { type: 'DELETE_CUSTOM_LAYOUT'; id: string }
  | { type: 'DUPLICATE_CUSTOM_LAYOUT'; template: CustomLayoutTemplate; newName?: string }
  | { type: 'RENAME_CUSTOM_LAYOUT'; id: string; name: string }
  | { type: 'IMPORT_CUSTOM_LAYOUT'; json: string; fallbackName?: string }
  | { type: 'SYNC_CUSTOM_LAYOUTS'; templates: CustomLayoutTemplate[] }
  | { type: 'SET_APPLIED_LAYOUT'; layoutId: string | null }
  // ---- v3 layout content + assignment (§3/§4/§8) ----
  | { type: 'SET_SECTION_FIELD_VALUES'; sectionId: string; values: Record<string, string> }
  /** Assign a file to a block — atomically MOVES it out of any other block
   * of the applied template (one-file-one-section rule, §5). */
  | { type: 'ASSIGN_FILE_TO_BLOCK'; blockId: string; fileId: string; position?: number }
  | { type: 'UNASSIGN_FILE'; fileId: string; blockId?: string }
  | { type: 'CLEAR_BLOCK_ASSIGNMENTS'; blockId: string }
  // ---- Export groups (§11/§22-§29) ----
  | { type: 'ADD_EXPORT_GROUP'; group: ExportGroup }
  | { type: 'UPDATE_EXPORT_GROUP'; group: ExportGroup }
  | { type: 'DELETE_EXPORT_GROUP'; id: string }
  /** R12 — grow/shrink the group list by a DELTA (the stepper −/+
   * buttons). Delta (not absolute target) because rapid clicks read a
   * stale `state` snapshot in the component — BUG-008: four fast +
   * clicks all computed "Export 1" from the same pre-render length. The
   * reducer resolves against FRESH state, so sequential dispatches
   * compose: +,+,+ → Export 1, Export 2, Export 3. Growth appends
   * empty scaffolds named "Export N"; shrink drops TRAILING groups
   * (their projects simply become unassigned, §23). */
  | { type: 'ADJUST_EXPORT_GROUP_COUNT'; delta: number }
  /** R11 — move a group from one index to another (drag handle or ↑/↓
   * keys). Order is user-facing: it drives the row list AND the persisted
   * scaffold order (persistState saves the array as-is). */
  | { type: 'REORDER_EXPORT_GROUPS'; from: number; to: number }
  /** R14 — move a project chip from one position to another WITHIN one
   * export group (drag a chip or use its ↑/↓ buttons). Chip order = the
   * document assembly order for that group's export (TEST-056), so this
   * is user-facing order, not cosmetics. Resolved against FRESH state
   * (BUG-008 lesson): the reducer re-finds the group and silently no-ops
   * on any inconsistency — a stale drag must never corrupt the order. */
  | { type: 'MOVE_EXPORT_GROUP_PROJECT'; groupId: string; from: number; to: number }
  /** R15 — duplicate an export group: a full scaffold copy (project ids,
   * filename override, layout / first-page / cover configuration) inserted
   * directly AFTER the source. The copy gets a FRESH id and the name
   * "name (copy)" — numbered "(copy 2)", "(copy 3)"… when that name is
   * already taken. Useful for per-client variants that share the same
   * assignment shape. Resolved against FRESH state; unknown id = no-op. */
  | {
      type: 'DUPLICATE_EXPORT_GROUP'; id: string;
      /** Optional pre-generated id for the copy — the panel generates it so
       * it can flash the fresh row. The reducer falls back to its own
       * generator when absent. */
      newId?: string;
    }
  /** R15 — move a project chip from one group to a DIFFERENT group (drag
   * a chip onto another group's row or one of its chips). Removes the id
   * from the source and APPENDS it to the target (order = arrival), so the
   * moved project is the last document section of its new export. Same
   * BUG-008 discipline as the other group actions: resolved against FRESH
   * state, silent no-op on any inconsistency (missing group, same group,
   * id not in source, already in target) so a stale drag can never
   * corrupt the assignment. */
  | {
      type: 'MOVE_PROJECT_BETWEEN_GROUPS';
      fromGroupId: string;
      toGroupId: string;
      projectId: string;
    }
  | { type: 'SET_SAME_LAYOUT_FOR_ALL'; value: boolean }
  // ---- Project merge / unmerge (§11) ----
  | { type: 'MERGE_PROJECTS'; sourceIds: string[]; label?: string; mergedId: string }
  | { type: 'UNMERGE_PROJECTS'; mergedId: string };

/** The app reducer — exported so tests can drive actions directly. */
export function reducer(state: AppState, action: Action): AppState {
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
        exclusions,
        inclusions,
        projectExcludeRules,
        projectIncludeRules,
        fileOrder,
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
    case 'SAVE_DEFAULT_SELECTION_PREFS':
      // §46 — persist the prefs AND re-derive the discovery filter so the
      // NEXT upload uses them. Already-loaded projects are never re-scanned
      // (changing defaults does not destructively affect them).
      saveDefaultSelectionPrefs(action.prefs);
      return {
        ...state,
        filter: applyPrefsToFilterConfig(action.prefs),
      };
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
        exclusions: {},
        inclusions: {},
        projectExcludeRules: {},
        projectIncludeRules: {},
        fileOrder: {},
        fileDetails: {},
        fileFieldValues: {},
        documentFieldValues: {},
        fileImages: {},
        layoutAssignments: {},
        sectionFieldValues: {},
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
    case 'SET_DOCUMENT_FIELD_VALUES':
      return { ...state, documentFieldValues: action.values };
    case 'ADD_COVER_PAGE':
      return { ...state, coverPages: [...state.coverPages, action.cover] };
    case 'REMOVE_COVER_PAGE':
      return { ...state, coverPages: state.coverPages.filter((c) => c.id !== action.id) };
    case 'RENAME_COVER_PAGE':
      return {
        ...state,
        coverPages: state.coverPages.map((c) =>
          c.id === action.id ? { ...c, name: action.name } : c,
        ),
      };
    case 'RESTORE_COVER_PAGES':
      // WS-8a — replace only an EMPTY list: an in-session import that
      // raced the async IndexedDB load always wins.
      if (state.coverPages.length > 0 || action.covers.length === 0) return state;
      return { ...state, coverPages: action.covers };
    case 'RESTORE_IMAGE_ASSETS':
      // WS-9a — same semantics as covers: replace only an EMPTY list.
      if (state.imageAssets.length > 0 || action.assets.length === 0) return state;
      return { ...state, imageAssets: action.assets };
    case 'SAVE_CUSTOM_LAYOUT': {
      // §10/§20 — normalize on write + prune assignments of deleted blocks.
      const template = normalizeTemplate(action.template);
      const customLayouts = storeCustomLayout(template);
      const layoutAssignments = pruneAssignments(template, state.layoutAssignments);
      return {
        ...state,
        customLayouts,
        appliedLayoutId: template.id,
        layoutAssignments,
      };
    }
    case 'UPDATE_CUSTOM_LAYOUT': {
      // §10/§20 — normalize on write + prune assignments of deleted blocks.
      const template = normalizeTemplate(action.template);
      const customLayouts = persistUpdateCustomLayout(template);
      const layoutAssignments = pruneAssignments(template, state.layoutAssignments);
      return { ...state, customLayouts, layoutAssignments };
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
    case 'SYNC_CUSTOM_LAYOUTS': {
      // §10/§20 — normalize + prune on sync too (PanelOverrides etc.).
      const templates = action.templates.map(normalizeTemplate);
      const applied = templates.find((t) => t.id === state.appliedLayoutId);
      const layoutAssignments = applied
        ? pruneAssignments(applied, state.layoutAssignments)
        : state.layoutAssignments;
      return { ...state, customLayouts: templates, layoutAssignments };
    }
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
    case 'ADJUST_EXPORT_GROUP_COUNT': {
      // §23 grow/shrink, resolved against CURRENT (fresh) state — see the
      // action's doc comment for why this must live in the reducer (BUG-008).
      const current = state.exportGroups.length;
      const next = Math.max(0, current + action.delta);
      if (next === current) return state;
      if (next < current) {
        return { ...state, exportGroups: state.exportGroups.slice(0, next) };
      }
      const appended: ExportGroup[] = [];
      for (let i = current; i < next; i++) {
        appended.push({
          id: `grp-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
          name: `Export ${i + 1}`,
          projectIds: [],
        });
      }
      return { ...state, exportGroups: [...state.exportGroups, ...appended] };
    }
    case 'REORDER_EXPORT_GROUPS': {
      // Same splice semantics as REORDER_PROJECTS: `to` is the target
      // index in the PRE-move array AFTER the `from < to → to -= 1`
      // adjustment the caller applies (drop-below hint). Out-of-range
      // indices are a silent no-op — a stale drag must never corrupt
      // the list.
      const { from, to } = action;
      if (
        from === to ||
        from < 0 ||
        from >= state.exportGroups.length ||
        to < 0 ||
        to >= state.exportGroups.length
      ) {
        return state;
      }
      const exportGroups = [...state.exportGroups];
      const [moved] = exportGroups.splice(from, 1);
      exportGroups.splice(to, 0, moved);
      return { ...state, exportGroups };
    }
    case 'MOVE_EXPORT_GROUP_PROJECT': {
      // R14 — chip reorder INSIDE one group, resolved against FRESH state
      // (the BUG-008 discipline): re-find the group by id, splice its
      // projectIds, and silently no-op on ANY inconsistency (missing
      // group, out-of-range indices, same index) so a stale drag can
      // never corrupt the assembly order.
      const { groupId, from, to } = action;
      const group = state.exportGroups.find((g) => g.id === groupId);
      if (!group) return state;
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= group.projectIds.length ||
        to >= group.projectIds.length
      ) {
        return state;
      }
      const projectIds = [...group.projectIds];
      const [movedProject] = projectIds.splice(from, 1);
      projectIds.splice(to, 0, movedProject);
      return {
        ...state,
        exportGroups: state.exportGroups.map((g) =>
          g.id === groupId ? { ...g, projectIds } : g,
        ),
      };
    }
    case 'DUPLICATE_EXPORT_GROUP': {
      // R15 — full scaffold copy inserted right after the source. Fresh id
      // (same generator as the stepper growth, BUG-008 discipline: resolved
      // against FRESH state) so drag / persistence identity stays unique.
      const at = state.exportGroups.findIndex((g) => g.id === action.id);
      if (at === -1) return state;
      const source = state.exportGroups[at];
      // "name (copy)" — number onward when taken ("A (copy)" exists →
      // "A (copy 2)"); case-insensitive so "a (copy)" blocks "A (copy)".
      const taken = new Set(
        state.exportGroups.map((g) => g.name.trim().toLowerCase()),
      );
      let name = `${source.name} (copy)`;
      let n = 2;
      while (taken.has(name.toLowerCase())) {
        name = `${source.name} (copy ${n})`;
        n += 1;
      }
      const copy: ExportGroup = {
        ...source,
        id: action.newId ?? `grp-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
        name,
        projectIds: [...source.projectIds],
      };
      const exportGroups = [...state.exportGroups];
      exportGroups.splice(at + 1, 0, copy);
      return { ...state, exportGroups };
    }
    case 'MOVE_PROJECT_BETWEEN_GROUPS': {
      // R15 — cross-group chip move. Guards: same group is a no-op (the
      // within-group reorder owns that gesture), both groups must exist,
      // the id must be in the source and must not already be in the target
      // (a project may belong to any number of groups, but not twice in
      // one group). The move APPENDS to the target (order = arrival).
      const { fromGroupId, toGroupId, projectId } = action;
      if (fromGroupId === toGroupId) return state;
      const from = state.exportGroups.find((g) => g.id === fromGroupId);
      const to = state.exportGroups.find((g) => g.id === toGroupId);
      if (!from || !to) return state;
      if (!from.projectIds.includes(projectId)) return state;
      if (to.projectIds.includes(projectId)) return state;
      return {
        ...state,
        exportGroups: state.exportGroups.map((g) => {
          if (g.id === fromGroupId) {
            return {
              ...g,
              projectIds: g.projectIds.filter((id) => id !== projectId),
            };
          }
          if (g.id === toGroupId) {
            return { ...g, projectIds: [...g.projectIds, projectId] };
          }
          return g;
        }),
      };
    }
    case 'SET_SAME_LAYOUT_FOR_ALL':
      return { ...state, sameLayoutForAllExports: action.value };
    case 'MERGE_PROJECTS': {
      // §11/§31 — merge N projects into one unified project. File ids,
      // relative paths and handles are PRESERVED (duplicate paths from
      // different sources stay independently addressable). Per-project
      // state (file order, explicit exclusions/inclusions) MIGRATES to the
      // merged id; the originals are captured for exact undo.
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
      // §31 — migrate per-project state keyed by projectId to the merged id.
      const fileIdSet = new Set(files.map((f) => f.id));
      const sourceOrders: Record<string, string[]> = {};
      const sourceExclusions: Record<string, Set<string>> = {};
      const sourceInclusions: Record<string, Set<string>> = {};
      const mergedOrder: string[] = [];
      const mergedExclusions = new Set<string>();
      const mergedInclusions = new Set<string>();
      for (const source of sources) {
        // Capture the originals for undo.
        sourceOrders[source.id] = [...(state.fileOrder[source.id] ?? [])];
        sourceExclusions[source.id] = new Set(state.exclusions[source.id] ?? []);
        sourceInclusions[source.id] = new Set(state.inclusions[source.id] ?? []);
        // Concatenate into the merged view (source order preserved).
        for (const id of state.fileOrder[source.id] ?? []) {
          if (fileIdSet.has(id)) mergedOrder.push(id);
        }
        for (const id of state.exclusions[source.id] ?? []) mergedExclusions.add(id);
        for (const id of state.inclusions[source.id] ?? []) mergedInclusions.add(id);
      }
      const fileOrder = { ...state.fileOrder };
      for (const source of sources) delete fileOrder[source.id];
      if (mergedOrder.length > 0) fileOrder[action.mergedId] = mergedOrder;
      const exclusions = { ...state.exclusions };
      const inclusions = { ...state.inclusions };
      for (const source of sources) {
        delete exclusions[source.id];
        delete inclusions[source.id];
      }
      if (mergedExclusions.size > 0) exclusions[action.mergedId] = mergedExclusions;
      if (mergedInclusions.size > 0) inclusions[action.mergedId] = mergedInclusions;
      // §35 — migrate per-project SELECTION RULES to the merged id
      // (deduped concatenation; source entries removed so no orphan rule
      // state lingers) and capture the originals for exact undo.
      const sourceExcludeRules: Record<string, string[]> = {};
      const sourceIncludeRules: Record<string, string[]> = {};
      const mergedExcludeRules: string[] = [];
      const mergedIncludeRules: string[] = [];
      for (const source of sources) {
        const ex = state.projectExcludeRules[source.id] ?? [];
        const inc = state.projectIncludeRules[source.id] ?? [];
        if (ex.length > 0) sourceExcludeRules[source.id] = [...ex];
        if (inc.length > 0) sourceIncludeRules[source.id] = [...inc];
        for (const rule of ex) if (!mergedExcludeRules.includes(rule)) mergedExcludeRules.push(rule);
        for (const rule of inc) if (!mergedIncludeRules.includes(rule)) mergedIncludeRules.push(rule);
      }
      const projectExcludeRules = { ...state.projectExcludeRules };
      const projectIncludeRules = { ...state.projectIncludeRules };
      for (const source of sources) {
        delete projectExcludeRules[source.id];
        delete projectIncludeRules[source.id];
      }
      if (mergedExcludeRules.length > 0) projectExcludeRules[action.mergedId] = mergedExcludeRules;
      if (mergedIncludeRules.length > 0) projectIncludeRules[action.mergedId] = mergedIncludeRules;
      return {
        ...state,
        projects,
        fileOrder,
        exclusions,
        inclusions,
        projectExcludeRules,
        projectIncludeRules,
        mergeSources: {
          ...state.mergeSources,
          [action.mergedId]: {
            sources,
            mergedAt: Date.now(),
            fileOrder: sourceOrders,
            exclusions: sourceExclusions,
            inclusions: sourceInclusions,
            excludeRules: sourceExcludeRules,
            includeRules: sourceIncludeRules,
          },
        },
        exportGroups,
      };
    }
    case 'UNMERGE_PROJECTS': {
      // §11/§31 — split a previously merged project back into its sources:
      // original names, files, handles, file order and explicit selections
      // are restored exactly (via file ids, section/block assignments never
      // broke). Export groups referencing the merged id get the source ids
      // back (best effort, order preserved).
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
      // §31 — restore per-project state captured at merge time.
      const fileOrder = { ...state.fileOrder };
      const exclusions = { ...state.exclusions };
      const inclusions = { ...state.inclusions };
      const projectExcludeRules = { ...state.projectExcludeRules };
      const projectIncludeRules = { ...state.projectIncludeRules };
      delete fileOrder[action.mergedId];
      delete exclusions[action.mergedId];
      delete inclusions[action.mergedId];
      delete projectExcludeRules[action.mergedId];
      delete projectIncludeRules[action.mergedId];
      for (const source of record.sources) {
        if (record.fileOrder[source.id]?.length) {
          fileOrder[source.id] = [...record.fileOrder[source.id]];
        }
        if (record.exclusions[source.id]?.size) {
          exclusions[source.id] = new Set(record.exclusions[source.id]);
        }
        if (record.inclusions[source.id]?.size) {
          inclusions[source.id] = new Set(record.inclusions[source.id]);
        }
        if (record.excludeRules[source.id]?.length) {
          projectExcludeRules[source.id] = [...record.excludeRules[source.id]];
        }
        if (record.includeRules[source.id]?.length) {
          projectIncludeRules[source.id] = [...record.includeRules[source.id]];
        }
      }
      return {
        ...state,
        projects,
        mergeSources,
        exportGroups,
        fileOrder,
        exclusions,
        inclusions,
        projectExcludeRules,
        projectIncludeRules,
      };
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
    filter: applyPrefsToFilterConfig(loadDefaultSelectionPrefs()),
    uiTheme: getInitialUITheme(),
    outputFormat: 'docx',
    outputMode: 'combined',
    outputFilename: 'Codice_Output',
    fileDetails: {},
    fileFieldValues: {},
    documentFieldValues: {},
    imageAssets: [],
    fileImages: {},
    coverPages: [],
    fileOrder: {},
    customLayouts: loadCustomLayouts(),
    appliedLayoutId: null,
    sectionFieldValues: {},
    layoutAssignments: {},
    exportGroups: [],
    sameLayoutForAllExports: true,
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
    if (typeof parsed.sameLayoutForAllExports === 'boolean') {
      result.sameLayoutForAllExports = parsed.sameLayoutForAllExports;
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
    // Export groups persist (WS-9c): the SCAFFOLD (name + per-export
    // layout/first-page/cover choices) survives reloads even when the
    // referenced projects are gone — project ids are random per upload,
    // so references can never reconnect; names are real user work.
    // Stale project ids are pruned to live projects, but the group itself
    // is kept (layoutId/coverId CAN reconnect: layouts and covers persist).
    if (Array.isArray(parsed.exportGroups)) {
      const groups = (
        parsed.exportGroups as Array<{
          id?: unknown;
          name?: unknown;
          projectIds?: unknown;
          layoutId?: unknown;
          firstPage?: unknown;
          coverId?: unknown;
          filename?: unknown;
        }>
      )
        .filter(
          (
            g,
          ): g is {
            id: string;
            name: string;
            projectIds: string[];
            layoutId?: unknown;
            firstPage?: unknown;
            coverId?: unknown;
            filename?: unknown;
          } =>
            typeof g.id === 'string' &&
            typeof g.name === 'string' &&
            Array.isArray(g.projectIds) &&
            g.projectIds.every((x) => typeof x === 'string'),
        )
        .map((g) => ({
          id: g.id,
          name: g.name,
          projectIds: [...new Set(g.projectIds)],
          // Per-export configuration (§27 layout / §43 first page) — kept
          // only when well-formed so junk cannot leak into the reducer.
          ...(typeof g.layoutId === 'string' || g.layoutId === null
            ? { layoutId: g.layoutId as string | null }
            : {}),
          ...(g.firstPage === 'preset' || g.firstPage === 'title' || g.firstPage === 'cover'
            ? { firstPage: g.firstPage as 'preset' | 'title' | 'cover' }
            : {}),
          ...(typeof g.coverId === 'string' ? { coverId: g.coverId } : {}),
          // R12 — per-group filename override pattern (string only).
          ...(typeof g.filename === 'string' ? { filename: g.filename } : {}),
        }));
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
      sameLayoutForAllExports: state.sameLayoutForAllExports,
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
        // Only persist ids of projects that still exist. The group
        // scaffold itself is kept (WS-9c) — project references cannot
        // survive a reload (random ids), but names and per-export
        // layout/first-page/cover choices are durable user work.
        projectIds: g.projectIds.filter((id) =>
          state.projects.some((p) => p.id === id),
        ),
        ...(g.layoutId !== undefined ? { layoutId: g.layoutId } : {}),
        ...(g.firstPage !== undefined ? { firstPage: g.firstPage } : {}),
        ...(g.coverId !== undefined ? { coverId: g.coverId } : {}),
        ...(g.filename !== undefined ? { filename: g.filename } : {}),
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // ignore quota errors
  } finally {
    // R14 — the header save indicator listens for this. 'saved' fires in
    // `finally` so a quota failure cannot leave the indicator on
    // "Saving…" forever (the write itself is best-effort by design).
    emitPersistSignal('saved');
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

  // WS-8a — restore cover-page assets from IndexedDB on mount (binary
  // media does not fit localStorage, so covers persist separately — see
  // lib/coverStorage). RESTORE_COVER_PAGES only fills an EMPTY list, so
  // a user importing a cover before this async load settles keeps theirs.
  const coverRestoreSettled = useRef(false);
  useEffect(() => {
    let cancelled = false;
    loadCoverAssets()
      .then((covers) => {
        coverRestoreSettled.current = true;
        if (!cancelled && covers.length > 0) {
          dispatch({ type: 'RESTORE_COVER_PAGES', covers });
        }
      })
      .catch(() => {
        // Cover persistence is best-effort; nothing to restore.
        coverRestoreSettled.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // WS-9a — restore the image library from IndexedDB on mount (same
  // semantics as covers: only fills an EMPTY list — see lib/imageStorage).
  const imageRestoreSettled = useRef(false);
  useEffect(() => {
    let cancelled = false;
    loadImageAssets()
      .then((assets) => {
        imageRestoreSettled.current = true;
        if (!cancelled && assets.length > 0) {
          dispatch({ type: 'RESTORE_IMAGE_ASSETS', assets });
        }
      })
      .catch(() => {
        // Image persistence is best-effort; nothing to restore.
        imageRestoreSettled.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // WS-9b — warn (once per asset per session) when a storage save drops
  // the OLDEST assets because of the persistence caps. Toasting is
  // optional: tests render AppStateProvider without the ToastProvider.
  const toast = useToastOptional();
  const warnedDroppedIds = useRef<Set<string>>(new Set());
  const maybeWarnDropped = useCallback(
    (dropped: Array<Pick<CoverPageAsset | ImageAsset, 'id' | 'name'>>, kind: 'covers' | 'images') => {
      if (!toast || dropped.length === 0) return;
      const fresh = dropped.filter((d) => !warnedDroppedIds.current.has(d.id));
      if (fresh.length === 0) return;
      for (const d of fresh) warnedDroppedIds.current.add(d.id);
      const isCovers = kind === 'covers';
      const names = fresh.map((d) => d.name).join(', ');
      toast.push({
        kind: 'warning',
        title: isCovers ? 'Cover storage limit reached' : 'Image storage limit reached',
        message:
          `Only the ${isCovers ? '20 most recent cover pages (up to ~50 MB)' : '40 most recent images (up to ~60 MB)'} ` +
          `persist across sessions. Oldest removed from storage: ${names}. ` +
          'They keep working during this session.',
        durationMs: 9000,
      });
    },
    [toast],
  );

  // Persist on changes (debounced).
  const persistTimer = useRef<number | null>(null);
  const firstPersistRun = useRef(true);
  useEffect(() => {
    // R14 — the initial mount always writes the restored state back; that
    // is bookkeeping, not a user edit, so the save indicator stays idle
    // for it. Every REAL change announces 'dirty' (the debounced write is
    // pending) — persistState itself announces 'saved' when it finishes.
    if (firstPersistRun.current) {
      firstPersistRun.current = false;
    } else {
      emitPersistSignal('dirty');
    }
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => persistState(state), 500);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [state]);

  // WS-8a — persist cover pages to IndexedDB (debounced like the
  // localStorage persist above). The whole list is re-written, so
  // REMOVE_COVER_PAGE / renames propagate automatically. The initial
  // empty-list save is skipped until the mount restore settled — never
  // wipe storage while a restore is still in flight. WS-9b: caps-dropped
  // assets are surfaced as a (deduplicated) warning toast.
  const coverPersistTimer = useRef<number | null>(null);
  useEffect(() => {
    if (state.coverPages.length === 0 && !coverRestoreSettled.current) return;
    if (coverPersistTimer.current) clearTimeout(coverPersistTimer.current);
    coverPersistTimer.current = window.setTimeout(() => {
      void saveCoverAssets(state.coverPages)
        .then(({ dropped }) => {
          maybeWarnDropped(dropped, 'covers');
        })
        .catch(() => {
          /* best-effort persistence */
        });
    }, 500);
    return () => {
      if (coverPersistTimer.current) clearTimeout(coverPersistTimer.current);
    };
  }, [state.coverPages, maybeWarnDropped]);

  // WS-9a — persist image assets to IndexedDB, mirroring the cover-page
  // effect above (debounced whole-list rewrite; skip the initial save
  // until the mount restore settled). WS-9b: caps-dropped assets warn.
  const imagePersistTimer = useRef<number | null>(null);
  useEffect(() => {
    if (state.imageAssets.length === 0 && !imageRestoreSettled.current) return;
    if (imagePersistTimer.current) clearTimeout(imagePersistTimer.current);
    imagePersistTimer.current = window.setTimeout(() => {
      void saveImageAssets(state.imageAssets)
        .then(({ dropped }) => {
          maybeWarnDropped(dropped, 'images');
        })
        .catch(() => {
          /* best-effort persistence */
        });
    }, 500);
    return () => {
      if (imagePersistTimer.current) clearTimeout(imagePersistTimer.current);
    };
  }, [state.imageAssets, maybeWarnDropped]);

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
