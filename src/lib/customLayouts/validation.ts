/**
 * Required-field validation for custom layouts v3 (§5/§20).
 *
 * Runs BEFORE export and works through the ACTUAL resolved layout/data
 * pipeline semantics — never a hardcoded list of known fields:
 *
 *   1. Document fields — checked once (document-scope value store).
 *   2. Every section → its required section fields (checked once per
 *      section, against the section-scope value store).
 *   3. Every block child → every ASSIGNED file → the block's required
 *      fields (checked per file, against the per-file store).
 *   4. Image fields count as missing when no asset is selected.
 *
 * Field lists are read through the DERIVED accessors (content is the
 * source of truth, §20) — a deleted node's field can never block export.
 *
 * The result identifies the exact section / block / file that failed so
 * the error toast can say precisely what is missing and where (§5: the
 * validation must identify which field/section/block caused the failure).
 * A missing required value BLOCKS the export — no partial document.
 */

import type { DocumentProject, FileDetails } from '@/types';
import type {
  CustomLayoutTemplate,
  TemplateFieldDefinition,
} from './model';
import { templateSections } from './model';

/** One missing required value. */
export interface MissingRequirement {
  /** Human label of the instance, e.g. "Main.kt" or "Section: Task 01". */
  instance: string;
  /** Owning section name (when known). */
  sectionName?: string;
  /** Owning block name (when the instance is a block file instance). */
  blockName?: string;
  /** The file id (when the instance is a file) so the UI can offer a jump. */
  fileId?: string;
  /** The project id (when the instance is a file). */
  projectId?: string;
  /** Missing field labels, e.g. ["Screenshot"]. */
  fields: string[];
}

export interface LayoutValidationInput {
  template: CustomLayoutTemplate;
  projects: DocumentProject[];
  fileDetails: Record<string, FileDetails>;
  /** Per-file custom field values (block fields), keyed by fileId. */
  fileFieldValues: Record<string, Record<string, string>>;
  /** Per-section field values, keyed by sectionId. */
  sectionFieldValues: Record<string, Record<string, string>>;
  /** Document-level field values (file-level bound nodes). */
  documentFieldValues?: Record<string, string>;
  /** blockId → assigned file ids (the session assignment map, §3). */
  fileAssignments: Record<string, string[]>;
  /** Canonical file order per project (assigned files render in it). */
  fileOrder?: Record<string, string[]>;
}

function isFilled(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}

function missingLabels(
  fields: TemplateFieldDefinition[],
  values: Record<string, string>,
): string[] {
  return fields.filter((f) => f.required && !isFilled(values[f.id])).map((f) => f.label);
}

function findFile(
  projects: DocumentProject[],
  fileId: string,
): DocumentProject['files'][number] | undefined {
  for (const p of projects) {
    const f = p.files.find((x) => x.highlighted.fileId === fileId);
    if (f) return f;
  }
  return undefined;
}

/**
 * Validate all required fields through the layout structure. Returns the
 * list of instances with missing values — empty list means the export may
 * proceed. Files assigned to no block are NOT an error (documented) — use
 * `unassignedFileIds` for the non-blocking warning.
 */
export function validateCustomLayout(input: LayoutValidationInput): MissingRequirement[] {
  const missing: MissingRequirement[] = [];

  // Selected file ids — files not selected never render, so they are not
  // validated.
  const selectedIds = new Set<string>();
  for (const project of input.projects) {
    for (const file of project.files) selectedIds.add(file.highlighted.fileId);
  }

  // 0. Document fields — one instance (§21).
  const docMissing = missingLabels(input.template.fields, input.documentFieldValues ?? {});
  if (docMissing.length > 0) {
    missing.push({ instance: 'Document', fields: docMissing });
  }

  for (const section of templateSections(input.template)) {
    // 1. Section fields — one instance per section.
    const sectionMissing = missingLabels(
      section.fields,
      input.sectionFieldValues[section.id] ?? {},
    );
    if (sectionMissing.length > 0) {
      missing.push({
        instance: `Section "${section.name}"`,
        sectionName: section.name,
        fields: sectionMissing,
      });
    }

    // 2. Block fields — one instance per assigned, selected file.
    for (const child of section.children) {
      if (child.kind !== 'block') continue;
      for (const fileId of input.fileAssignments[child.block.id] ?? []) {
        if (!selectedIds.has(fileId)) continue;
        const file = findFile(input.projects, fileId);
        if (!file) continue;
        const fileMissing = missingLabels(
          child.block.fields,
          input.fileFieldValues[fileId] ?? {},
        );
        if (fileMissing.length > 0) {
          missing.push({
            instance: file.highlighted.relativePath,
            sectionName: section.name,
            blockName: child.block.name,
            fileId,
            projectId: file.projectId,
            fields: fileMissing,
          });
        }
      }
    }
  }

  return missing;
}

/**
 * Files (selected, present in the projects) that are assigned to NO block
 * of the template. They will not appear in the export — surfaced as a
 * non-blocking warning (the Layout editor is the fix).
 */
export function unassignedFileIds(input: LayoutValidationInput): string[] {
  const assigned = new Set<string>();
  for (const section of templateSections(input.template)) {
    for (const child of section.children) {
      if (child.kind !== 'block') continue;
      for (const id of input.fileAssignments[child.block.id] ?? []) assigned.add(id);
    }
  }
  const selectedIds = new Set<string>();
  for (const project of input.projects) {
    for (const file of project.files) selectedIds.add(file.highlighted.fileId);
  }
  return [...selectedIds].filter((id) => !assigned.has(id));
}

/**
 * §39 — the derived "layout needs attention" condition behind the top-right
 * Layout button's dot. TRUE only when something actionable exists:
 *   - a required field value is missing (validateCustomLayout), or
 *   - a selected file is assigned to no block (unassignedFileIds).
 * FALSE when there is nothing to do: no applied layout, an empty workspace,
 * or a fully wired layout. It is never a decorative badge.
 */
export function layoutAttentionRequired(
  template: CustomLayoutTemplate | null | undefined,
  input: Omit<LayoutValidationInput, 'template'>,
): boolean {
  if (!template) return false;
  // Nothing uploaded/selected → nothing to wire yet, no dot.
  if (input.projects.every((p) => p.files.length === 0)) return false;
  if (validateCustomLayout({ ...input, template }).length > 0) return true;
  return unassignedFileIds({ ...input, template }).length > 0;
}

/**
 * Render the missing list as the toast's multi-line message (§5):
 * `Main.kt is missing: • Description • Screenshot`
 */
export function formatMissingRequirements(missing: MissingRequirement[]): string {
  return missing
    .slice(0, 8)
    .map((m) => {
      const where = m.blockName ? ` (block: ${m.blockName})` : '';
      const bullets = m.fields.map((f) => `• ${f}`).join(' ');
      return `${m.instance}${where} is missing: ${bullets}`;
    })
    .join('\n');
}
