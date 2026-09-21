/**
 * UI-side helpers for the v3 custom layout model (WS-2).
 *
 * Small pure functions the studio components need that did NOT belong in
 * model.ts (owned by the model layer): live field derivation for the
 * FILE scope, in-place node binding for the "＋ New field…" inspector
 * flow (§9), and the unified Image source resolution shared by the UI
 * (§7/§8). Everything here is pure and works on draft clones.
 */

import {
  genLayoutId,
  nodeFieldIds,
  type CustomLayoutTemplate,
  type ImageSource,
  type TemplateFieldDefinition,
  type TemplateFieldType,
  type TemplateNode,
  type TemplateSection,
} from './model';

/* ------------------------------------------------------------------ */
/* Field definitions                                                   */
/* ------------------------------------------------------------------ */

/** Mint a fresh field definition (used by the inspector "New field…"). */
export function newFieldDefinition(
  label: string,
  kind: TemplateFieldType,
  required = false,
): TemplateFieldDefinition {
  return { id: genLayoutId('fld'), label, kind, required };
}

/**
 * The template's DOCUMENT fields, ordered to match the file-level content
 * (§21) — same derivation rule as `sectionFieldsInContentOrder`: collect
 * the field ids referenced by root standalone nodes (containers included)
 * in content order and look the definitions up in `template.fields`.
 */
export function documentFieldsInContentOrder(
  template: CustomLayoutTemplate,
): TemplateFieldDefinition[] {
  const ids: string[] = [];
  for (const child of template.rootChildren) {
    if (child.kind === 'node') ids.push(...nodeFieldIds(child.node));
  }
  const byId = new Map(template.fields.map((f) => [f.id, f]));
  const out: TemplateFieldDefinition[] = [];
  for (const id of [...new Set(ids)]) {
    out.push(byId.get(id) ?? { id, label: 'Field', kind: 'text', required: false });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Node lookup / binding                                               */
/* ------------------------------------------------------------------ */

/** Depth-first node lookup inside one root tree (containers included). */
export function findNodeInTree(
  node: TemplateNode,
  id: string,
): TemplateNode | null {
  if (node.id === id) return node;
  for (const stack of node.children ?? []) {
    for (const child of stack) {
      const found = findNodeInTree(child, id);
      if (found) return found;
    }
  }
  return null;
}

/** Bind (or unbind) a node by id inside the given root trees, in place. */
export function setNodeFieldBinding(
  roots: TemplateNode[],
  nodeId: string,
  fieldId: string | undefined,
): boolean {
  for (const root of roots) {
    const found = findNodeInTree(root, nodeId);
    if (found) {
      if (fieldId === undefined) delete found.fieldId;
      else found.fieldId = fieldId;
      return true;
    }
  }
  return false;
}

/** Every node root of a section's content: standalone nodes + block nodes. */
export function sectionNodeRoots(section: TemplateSection): TemplateNode[] {
  const out: TemplateNode[] = [];
  for (const child of section.children) {
    if (child.kind === 'node') out.push(child.node);
    else out.push(...child.block.nodes);
  }
  return out;
}

/** The template's FILE-LEVEL standalone node roots (containers included). */
export function rootNodeRoots(template: CustomLayoutTemplate): TemplateNode[] {
  const out: TemplateNode[] = [];
  for (const child of template.rootChildren) {
    if (child.kind === 'node') out.push(child.node);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Unified Image primitive (§7/§8)                                     */
/* ------------------------------------------------------------------ */

/**
 * The effective content source of an Image node, mirroring the resolver's
 * fallback: explicit `style.imageSource`, else a bound field, else the
 * library. New image nodes carry NO imageSource (undefined) and no fieldId,
 * so they default to the library.
 */
export function effectiveImageSource(node: TemplateNode): ImageSource {
  if (node.style?.imageSource) return node.style.imageSource;
  return node.fieldId ? 'field' : 'library';
}
