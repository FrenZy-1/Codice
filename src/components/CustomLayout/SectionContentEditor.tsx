'use client';

/**
 * Section content editor (§2/§5/§6/§8) + derived section fields panel.
 *
 * The Section Content list IS the authoritative ordered structure of a
 * section: standalone nodes (headings, text, images, panels, columns,
 * dividers, spacers, page breaks, TOC, metadata) interleaved with file
 * Block definitions, top to bottom.
 *
 * Synchronization (§5/§6): the "Section fields" settings are DERIVED from
 * this list — every field-backed node contributes its field definition in
 * content order. There are no orphan fields, no accidental duplicates, and
 * no arbitrary ordering: moving a node moves its field entry; deleting the
 * node (or the field) removes both.
 *
 * Section TYPES (§9) seed a starting structure exactly once per explicit
 * user action (appendSectionPreset) — never phantom copies.
 */

import { useState } from 'react';
import {
  Plus,
  Trash,
  Copy,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  GripVertical,
  X,
} from '@/components/common/Icons';
import {
  blockFieldsInContentOrder,
  cloneTemplate,
  genLayoutId,
  nodeTypeDescription,
  sectionChildKey,
  sectionFieldsInContentOrder,
  sectionTypePreset,
  SECTION_TYPE_PRESETS,
  type SectionChild,
  type SectionTypeId,
  type TemplateBlockDef,
  type TemplateFieldDefinition,
  type TemplateFieldType,
  type TemplateNode,
  type TemplateBlockType,
  type TemplateSection,
} from '@/lib/customLayouts/model';
import {
  findNodeList,
  makeNode,
  NodeInspector,
  type InspectorScope,
} from '@/components/CustomLayout/NodeTreeEditor';

/* ------------------------------------------------------------------ */
/* Shared mutations on a SectionChild[] list (section or file level)    */
/* ------------------------------------------------------------------ */

/** Immutable helpers used by both the section content editor and the
 * file-level content editor (§7). All return NEW arrays. */

export function moveChild(
  children: SectionChild[],
  childId: string,
  delta: number,
): SectionChild[] {
  const idx = children.findIndex((c) => sectionChildKey(c) === childId);
  const to = idx + delta;
  if (idx < 0 || to < 0 || to >= children.length) return children;
  const next = [...children];
  const [moved] = next.splice(idx, 1);
  next.splice(to, 0, moved);
  return next;
}

export function removeChild(children: SectionChild[], childId: string): SectionChild[] {
  return children.filter((c) => sectionChildKey(c) !== childId);
}

export function makeStandaloneChild(type: TemplateBlockType): SectionChild {
  return { kind: 'node', node: makeNode(type) };
}

/** §1.3/§7 — insert a standalone child at an exact index. */
export function insertChildAt(
  children: SectionChild[],
  index: number,
  type: TemplateBlockType,
): SectionChild[] {
  const next = [...children];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, makeStandaloneChild(type));
  return next;
}

/**
 * §7/§1.3 — hover-reveal insertion row placed BETWEEN content rows (and at
 * the top of a list): lets the user add a standalone node at an exact
 * position instead of only appending. The revealed chip row reuses the
 * standard standalone primitive vocabulary.
 */
export function InsertContentRow({
  types,
  onInsert,
  label = 'Insert here',
  asListItem = true,
}: {
  types: TemplateBlockType[];
  onInsert: (type: TemplateBlockType) => void;
  label?: string;
  /** When false the row renders as a plain div (outside an <ol>). */
  asListItem?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const inner = open ? (
    <div className="flex flex-wrap items-center gap-1 rounded border border-dashed border-app bg-surface/40 p-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted">Insert</span>
      {types.map((t) => (
        <button
          key={t}
          type="button"
          className="codice-input-chip"
          title={nodeTypeDescription(t)}
          onClick={() => {
            onInsert(t);
            setOpen(false);
          }}
        >
          {labelForType(t)}
        </button>
      ))}
      <button
        type="button"
        className="ml-auto rounded p-0.5 text-muted hover:text-primary"
        aria-label="Cancel insertion"
        onClick={() => setOpen(false)}
      >
        <X size={10} />
      </button>
    </div>
  ) : (
    <div className="group/ins flex items-center py-0.5">
      <button
        type="button"
        className="flex items-center gap-1 rounded border border-dashed border-app px-1.5 py-0.5 text-[10px] text-muted opacity-0 transition-opacity hover:text-primary focus:opacity-100 group-hover/ins:opacity-100 group-focus-within/ins:opacity-100"
        onClick={() => setOpen(true)}
      >
        <Plus size={9} /> {label}
      </button>
    </div>
  );
  return asListItem ? (
    <li className="list-none" role="presentation">
      {inner}
    </li>
  ) : (
    inner
  );
}

/* ------------------------------------------------------------------ */
/* Content list                                                        */
/* ------------------------------------------------------------------ */

export const FILE_LEVEL_TYPES: TemplateBlockType[] = [
  'heading', 'text', 'image', 'divider', 'spacer', 'pageBreak', 'toc', 'metadata', 'panel', 'columns',
];

export const SECTION_STANDALONE_TYPES: TemplateBlockType[] = [
  'heading', 'text', 'image', 'divider', 'spacer', 'pageBreak', 'toc', 'metadata', 'panel', 'columns',
];

/**
 * Ordered content list for ONE scope (a section, or the file level).
 * Nodes render recursively (panels/columns expand their stacks); block
 * children render as block cards with their assigned-file chips.
 *
 * §7/§8 — field nodes are no longer added from a separate "Field" chip row:
 * the single Image/Text/Heading primitives are bound to fields from their
 * inspector (Content → "＋ New field…"), which calls `onCreateField`.
 */
export function SectionContentList({
  items,
  fields,
  allowBlocks,
  blockCards,
  onUpdate,
  onCreateField,
}: {
  items: SectionChild[];
  /** Scope field definitions (LIVE derived section fields, or [] at file level). */
  fields: TemplateFieldDefinition[];
  /** Whether block children are allowed (false at the file level, §7). */
  allowBlocks: boolean;
  /** Renderer for block children (section scope only). */
  blockCards?: (child: Extract<SectionChild, { kind: 'block' }>) => React.ReactNode;
  /** Replace the whole children list. */
  onUpdate: (next: SectionChild[]) => void;
  /** §9 — inspector "＋ New field…": create a field in the owning scope AND
   * bind the given node to it in one mutation. */
  onCreateField?: (label: string, kind: TemplateFieldType, bindNodeId: string) => void;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const mutateNode = (childId: string, fn: (node: TemplateNode) => void) => {
    onUpdate(
      items.map((c) => {
        if (c.kind !== 'node' || c.node.id !== childId) return c;
        const node = cloneTemplate(c.node);
        fn(node);
        return { ...c, node };
      }),
    );
  };

  return (
    <ol className="space-y-1" role="list" aria-label="Section children">
      {/* §1.3 — insert-before rows let standalone content start BEFORE the
          first block/heading and land BETWEEN any two children. */}
      <InsertContentRow
        types={SECTION_STANDALONE_TYPES}
        onInsert={(type) => onUpdate(insertChildAt(items, 0, type))}
        label="Insert at top"
      />
      {items.map((child, idx) => {
        const childKey = sectionChildKey(child);
        return (
        <li key={childKey} className="rounded border border-app bg-surface/60 p-1.5">
          {child.kind === 'node' ? (
            <StandaloneNodeRow
              node={child.node}
              childId={child.node.id}
              depth={0}
              fields={fields}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              onCreateField={onCreateField}
              onMove={(delta) => onUpdate(moveChild(items, childKey, delta))}
              onRemove={() => onUpdate(removeChild(items, childKey))}
              onDuplicate={() => {
                const copy = cloneTemplate(child);
                copy.node.id = genLayoutId('n');
                const next = [...items];
                next.splice(idx + 1, 0, copy);
                onUpdate(next);
              }}
              onMutateNode={(fn) => mutateNode(child.node.id, fn)}
            />
          ) : allowBlocks && blockCards ? (
            blockCards(child)
          ) : (
            <div className="text-xs text-muted">Block (not allowed here)</div>
          )}
        </li>
        );
      })}
      <InsertContentRow
        types={SECTION_STANDALONE_TYPES}
        onInsert={(type) => onUpdate(insertChildAt(items, items.length, type))}
        label="Insert at end"
      />
    </ol>
  );
}

/**
 * Add-controls row: the standardized standalone primitive chips (§7/§8).
 * Field-bound content is created from the node inspector's "Content"
 * select ("＋ New field…") — NOT from a competing "Field" chip row, so the
 * user-facing vocabulary exposes exactly ONE image/text/heading primitive.
 */
export function ContentAddControls({
  scope,
  onAddNode,
}: {
  scope: 'file' | 'section';
  onAddNode: (type: TemplateBlockType) => void;
}) {
  const types = scope === 'file' ? FILE_LEVEL_TYPES : SECTION_STANDALONE_TYPES;
  return (
    <div className="mt-2 space-y-1.5 border-t border-app pt-2">
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-24 flex-shrink-0 text-[10px] text-muted">Standalone</span>
        {types.map((t) => (
          <button
            key={t}
            type="button"
            className="codice-input-chip"
            title={nodeTypeDescription(t)}
            onClick={() => onAddNode(t)}
          >
            <Plus size={9} /> {labelForType(t)}
          </button>
        ))}
      </div>
      <p className="pl-24 text-[10px] text-muted">
        Need a fillable value instead of fixed text? Select a Text/Heading/Image node and use its
        “Content” dropdown → “＋ New field…” — binding puts data from your document, section or file
        into that spot (§9).
      </p>
    </div>
  );
}

function labelForType(t: TemplateBlockType): string {
  switch (t) {
    case 'text': return 'Text';
    case 'heading': return 'Heading';
    case 'image': return 'Image';
    case 'divider': return 'Divider';
    case 'spacer': return 'Spacer';
    case 'pageBreak': return 'Page break';
    case 'toc': return 'TOC';
    case 'metadata': return 'Metadata';
    case 'panel': return 'Panel';
    case 'columns': return 'Columns';
    default: return t;
  }
}

/* ------------------------------------------------------------------ */
/* Recursive standalone node row (panel/columns aware, §8/§26)          */
/* ------------------------------------------------------------------ */

function StandaloneNodeRow({
  node,
  childId,
  depth,
  fields,
  selectedNodeId,
  onSelectNode,
  onCreateField,
  onMove,
  onRemove,
  onDuplicate,
  onMutateNode,
}: {
  node: TemplateNode;
  childId: string;
  depth: number;
  fields: TemplateFieldDefinition[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onCreateField?: (label: string, kind: TemplateFieldType, bindNodeId: string) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMutateNode: (fn: (node: TemplateNode) => void) => void;
}) {
  const isContainer = node.type === 'panel' || node.type === 'columns';
  const [expanded, setExpanded] = useState(true);
  const selected = selectedNodeId === node.id;
  const fieldLabel = node.fieldId ? fields.find((f) => f.id === node.fieldId)?.label : undefined;

  // §9 — the inspector's "＋ New field…" creates the section field AND binds
  // THIS node in the single owning mutation (scope is always 'section' here).
  const handleCreateField = onCreateField
    ? (scope: InspectorScope, label: string, kind: TemplateFieldType) => {
        if (scope === 'section') onCreateField(label, kind, node.id);
      }
    : undefined;

  const innerOps = (listId: string) => ({
    onAdd: (type: TemplateBlockType, containerId?: string | null, columnIdx?: number) => {
      onMutateNode((root) => {
        const created = makeNode(type);
        if (containerId) {
          const container = findNodeList([root], containerId);
          const target = container ? container.list[container.index] : null;
          if (target?.children) {
            const idx = columnIdx ?? 0;
            target.children[Math.min(idx, target.children.length - 1)]?.push(created);
          }
        }
        void listId;
      });
    },
    onMove: (id: string, delta: number) => {
      onMutateNode((root) => {
        const found = findNodeList([root], id);
        if (!found) return;
        const to = found.index + delta;
        if (to < 0 || to >= found.list.length) return;
        const [moved] = found.list.splice(found.index, 1);
        found.list.splice(to, 0, moved);
      });
    },
    onRemove: (id: string) => {
      onMutateNode((root) => {
        const found = findNodeList([root], id);
        if (found) found.list.splice(found.index, 1);
      });
    },
    onDuplicate: (id: string) => {
      onMutateNode((root) => {
        const found = findNodeList([root], id);
        if (!found) return;
        const copy = cloneTemplate(found.list[found.index]);
        copy.id = genLayoutId('n');
        found.list.splice(found.index + 1, 0, copy);
      });
    },
    onPatch: (id: string, patch: Partial<TemplateNode>) => {
      onMutateNode((root) => {
        const found = findNodeList([root], id);
        if (found) Object.assign(found.list[found.index], patch);
      });
    },
    onPatchStyle: (id: string, patch: Partial<NonNullable<TemplateNode['style']>>) => {
      onMutateNode((root) => {
        const found = findNodeList([root], id);
        if (found) {
          found.list[found.index].style = { ...(found.list[found.index].style ?? {}), ...patch };
        }
      });
    },
  });

  // NOTE: rendered INSIDE the <li> provided by SectionContentList — a bare
  // div here keeps the DOM valid (no nested <li>, §39 hydration cleanliness).
  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded px-1 py-0.5 text-xs transition-colors ${
          selected ? 'bg-app ring-1 ring-[var(--color-accent)]' : 'hover:bg-app'
        }`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-secondary"
          title={nodeTypeDescription(node.type)}
          onClick={() => onSelectNode(selected ? null : node.id)}
        >
          <span className="codice-drag-handle mr-1 inline-flex align-middle" aria-hidden="true">
            <GripVertical size={10} />
          </span>
          <span className="font-medium text-primary">{labelForType(node.type)}</span>
          {node.text ? (
            <span className="ml-1 text-muted">
              “{node.text.slice(0, 24)}{node.text.length > 24 ? '…' : ''}”
            </span>
          ) : null}
          {fieldLabel && (
            <span className="ml-1 rounded border border-app px-1 text-[9px] text-muted">
              field: {fieldLabel}
            </span>
          )}
        </button>
        {isContainer && (
          <button
            type="button"
            className="flex-shrink-0 rounded p-0.5 text-muted hover:text-primary"
            aria-label={expanded ? 'Collapse container' : 'Expand container'}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        )}
        <span className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title="Move earlier" aria-label="Move earlier" onClick={() => onMove(-1)}>
            <ChevronUp size={10} />
          </button>
          <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title="Move later" aria-label="Move later" onClick={() => onMove(1)}>
            <ChevronDown size={10} />
          </button>
          <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title="Duplicate" aria-label="Duplicate" onClick={onDuplicate}>
            <Copy size={10} />
          </button>
          <button type="button" className="rounded p-0.5 text-muted hover:text-error" title="Remove" aria-label="Remove" onClick={onRemove}>
            <Trash size={10} />
          </button>
        </span>
      </div>

      {/* Panel/columns children (§8) */}
      {node.type === 'panel' && expanded && (
        <ContainerStack
          label="Panel content"
          containerId={node.id}
          columnIdx={0}
          list={node.children?.[0] ?? []}
          depth={depth + 1}
          fields={fields}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
          onCreateField={onCreateField}
          ops={innerOps(node.id)}
        />
      )}
      {node.type === 'columns' && expanded && (
        <div className="my-0.5 flex gap-1" style={{ paddingLeft: depth * 12 + 8 }}>
          {(node.children ?? []).slice(0, node.style?.columns ?? 2).map((col, i) => (
            <ContainerStack
              key={i}
              label={`Column ${i + 1}`}
              containerId={node.id}
              columnIdx={i}
              list={col}
              depth={depth + 1}
              fields={fields}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
              onCreateField={onCreateField}
              ops={innerOps(node.id)}
            />
          ))}
        </div>
      )}

      {/* Property inspector for the selected node (reuses the block
          inspector — same node model, §26) */}
      {selected && (
        <div className="mt-1" style={{ paddingLeft: depth * 12 + 8 }}>
          <NodeInspector
            node={node}
            scope="section"
            fields={[]}
            sectionFields={fields}
            onCreateField={handleCreateField}
            onPatch={(patch) => onMutateNode((root) => Object.assign(root, patch))}
            onPatchStyle={(patch) =>
              onMutateNode((root) => {
                root.style = { ...(root.style ?? {}), ...patch };
              })
            }
          />
        </div>
      )}
    </div>
  );
}

function ContainerStack({
  label,
  containerId,
  columnIdx,
  list,
  depth,
  fields,
  selectedNodeId,
  onSelectNode,
  onCreateField,
  ops,
}: {
  label: string;
  containerId: string;
  columnIdx: number;
  list: TemplateNode[];
  depth: number;
  fields: TemplateFieldDefinition[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onCreateField?: (label: string, kind: TemplateFieldType, bindNodeId: string) => void;
  ops: {
    onAdd: (type: TemplateBlockType, containerId?: string | null, columnIdx?: number) => void;
    onMove: (id: string, delta: number) => void;
    onRemove: (id: string) => void;
    onDuplicate: (id: string) => void;
    onPatch: (id: string, patch: Partial<TemplateNode>) => void;
    onPatchStyle: (id: string, patch: Partial<NonNullable<TemplateNode['style']>>) => void;
  };
}) {
  return (
    <div
      className="ml-3 rounded border border-dashed border-app/70 p-1"
      aria-label={label}
    >
      <div className="mb-0.5 text-[9px] uppercase tracking-wide text-muted">{label}</div>
      <div className="space-y-0.5">
        {list.map((n) => (
          <InnerNodeRow
            key={n.id}
            node={n}
            depth={depth}
            fields={fields}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
            onCreateField={onCreateField}
            ops={ops}
          />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {(['text', 'heading', 'image', 'divider'] as TemplateBlockType[]).map((t) => (
          <button
            key={t}
            type="button"
            className="codice-input-chip"
            onClick={() => ops.onAdd(t, containerId, columnIdx)}
            title={`Add ${labelForType(t)} to ${label}`}
          >
            <Plus size={8} /> {labelForType(t)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A node inside a panel/columns stack of a standalone node. */
function InnerNodeRow({
  node,
  depth,
  fields,
  selectedNodeId,
  onSelectNode,
  onCreateField,
  ops,
}: {
  node: TemplateNode;
  depth: number;
  fields: TemplateFieldDefinition[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onCreateField?: (label: string, kind: TemplateFieldType, bindNodeId: string) => void;
  ops: {
    onMove: (id: string, delta: number) => void;
    onRemove: (id: string) => void;
    onDuplicate: (id: string) => void;
    onPatch: (id: string, patch: Partial<TemplateNode>) => void;
    onPatchStyle: (id: string, patch: Partial<NonNullable<TemplateNode['style']>>) => void;
  };
}) {
  const selected = selectedNodeId === node.id;
  const fieldLabel = node.fieldId ? fields.find((f) => f.id === node.fieldId)?.label : undefined;
  // §9 — "＋ New field…" for an inner node binds THAT node (section scope).
  const handleCreateField = onCreateField
    ? (scope: InspectorScope, label: string, kind: TemplateFieldType) => {
        if (scope === 'section') onCreateField(label, kind, node.id);
      }
    : undefined;
  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded px-1 py-0.5 text-xs transition-colors ${
          selected ? 'bg-app ring-1 ring-[var(--color-accent)]' : 'hover:bg-app'
        }`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-secondary"
          onClick={() => onSelectNode(selected ? null : node.id)}
        >
          <span className="font-medium text-primary">{labelForType(node.type)}</span>
          {node.text ? <span className="ml-1 text-muted">“{node.text.slice(0, 20)}”</span> : null}
          {fieldLabel && <span className="ml-1 rounded border border-app px-1 text-[9px] text-muted">field: {fieldLabel}</span>}
        </button>
        <span className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title="Move earlier" aria-label="Move earlier" onClick={() => ops.onMove(node.id, -1)}>
            <ChevronUp size={9} />
          </button>
          <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title="Move later" aria-label="Move later" onClick={() => ops.onMove(node.id, 1)}>
            <ChevronDown size={9} />
          </button>
          <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title="Duplicate" aria-label="Duplicate" onClick={() => ops.onDuplicate(node.id)}>
            <Copy size={9} />
          </button>
          <button type="button" className="rounded p-0.5 text-muted hover:text-error" title="Remove" aria-label="Remove" onClick={() => ops.onRemove(node.id)}>
            <Trash size={9} />
          </button>
        </span>
      </div>
      {selected && (
        <div className="mt-1" style={{ paddingLeft: depth * 12 + 8 }}>
          <NodeInspector
            node={node}
            scope="section"
            fields={[]}
            sectionFields={fields}
            onCreateField={handleCreateField}
            onPatch={(patch) => ops.onPatch(node.id, patch)}
            onPatchStyle={(patch) => ops.onPatchStyle(node.id, patch)}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Derived section fields panel (§5/§6)                                */
/* ------------------------------------------------------------------ */

/**
 * The Section Fields settings, DERIVED from the section content (§6):
 * content order wins; editing a label/kind/required patches the bound
 * field definition; deleting a field removes its bound node(s) with it.
 */
export function SectionFieldsPanel({
  section,
  onPatchField,
  onDeleteField,
}: {
  section: TemplateSection;
  onPatchField: (id: string, patch: Partial<TemplateFieldDefinition>) => void;
  /** Deleting a field also removes every content node bound to it (§6). */
  onDeleteField: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const derived = sectionFieldsInContentOrder(section);

  return (
    <div className="rounded-md border border-app" data-tour="layout-fields">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs text-secondary transition-colors hover:text-primary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="font-medium">Section fields — derived from the content order</span>
        <span className="badge">{derived.length}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-app p-2">
          <p className="text-[10px] text-muted">
            The order here mirrors “Section content” — move a node there and its field moves with
            it (§6). Delete a field to remove its bound content with it. Add fields by selecting a
            node and using its “Content” dropdown → “＋ New field…” (§9).
          </p>
          {derived.length === 0 && (
            <p className="px-1 py-2 text-center text-[11px] text-muted">
              No fields yet — select a Text/Heading/Image node and use its “Content” dropdown →
              “＋ New field…”.
            </p>
          )}
          {derived.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-1.5 text-xs">
              <input
                type="text"
                className="input w-40 py-0.5"
                value={f.label}
                aria-label={`Field label — ${f.label}`}
                onChange={(e) => onPatchField(f.id, { label: e.target.value })}
              />
              <select
                className="select w-24 py-0.5"
                value={f.kind}
                aria-label={`Field kind — ${f.label}`}
                onChange={(e) => onPatchField(f.id, { kind: e.target.value as TemplateFieldDefinition['kind'] })}
              >
                <option value="text">Text</option>
                <option value="textarea">Paragraph</option>
                <option value="image">Image</option>
              </select>
              <label className="flex items-center gap-1 text-[11px] text-secondary">
                <input
                  type="checkbox"
                  className="h-3 w-3"
                  checked={f.required}
                  onChange={(e) => onPatchField(f.id, { required: e.target.checked })}
                />
                Required
              </label>
              <button
                type="button"
                className="codice-bulk-btn ml-auto"
                title={`Remove field ${f.label} and its bound content`}
                aria-label={`Remove field ${f.label} and its bound content`}
                onClick={() => onDeleteField(f.id)}
              >
                <Trash size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Derived BLOCK fields panel (§20 — same rule as sections)            */
/* ------------------------------------------------------------------ */

/**
 * The Block's field settings, DERIVED from the block pattern (§20):
 * pattern order wins; editing a label/kind/required patches the field
 * definition; deleting a field removes the pattern nodes bound to it
 * (mirroring the section behavior, so settings and content can never
 * drift apart). Values are filled PER FILE (File properties).
 */
export function BlockFieldsPanel({
  block,
  sectionFields,
  onPatchField,
  onDeleteField,
}: {
  block: TemplateBlockDef;
  /** The owning section's LIVE derived fields — their ids are NOT block
   * fields even when a block node binds to them (scope rule, §20). */
  sectionFields: TemplateFieldDefinition[];
  onPatchField: (id: string, patch: Partial<TemplateFieldDefinition>) => void;
  /** Deleting a field also removes every pattern node bound to it. */
  onDeleteField: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const derived = blockFieldsInContentOrder(
    block,
    new Set(sectionFields.map((f) => f.id)),
  );

  return (
    <div className="rounded-md border border-app" data-tour="layout-fields">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs text-secondary transition-colors hover:text-primary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="font-medium">Block fields — derived from the pattern (filled per file)</span>
        <span className="badge">{derived.length}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-app p-2">
          <p className="text-[10px] text-muted">
            The order mirrors the pattern — move a node and its field moves with it (§20). Values
            are filled PER FILE in File properties (right-click a file). Add fields by selecting a
            node and using its “Content” dropdown → “＋ New field…” (§9). Deleting a field removes
            the nodes bound to it.
          </p>
          {derived.length === 0 && (
            <p className="px-1 py-2 text-center text-[11px] text-muted">
              No per-file fields yet — select a node in the pattern and use its “Content” dropdown →
              “＋ New field…”.
            </p>
          )}
          {derived.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-1.5 text-xs">
              <input
                type="text"
                className="input w-40 py-0.5"
                value={f.label}
                aria-label={`Block field label — ${f.label}`}
                onChange={(e) => onPatchField(f.id, { label: e.target.value })}
              />
              <select
                className="select w-24 py-0.5"
                value={f.kind}
                aria-label={`Block field kind — ${f.label}`}
                onChange={(e) => onPatchField(f.id, { kind: e.target.value as TemplateFieldDefinition['kind'] })}
              >
                <option value="text">Text</option>
                <option value="textarea">Paragraph</option>
                <option value="image">Image</option>
              </select>
              <label className="flex items-center gap-1 text-[11px] text-secondary">
                <input
                  type="checkbox"
                  className="h-3 w-3"
                  checked={f.required}
                  onChange={(e) => onPatchField(f.id, { required: e.target.checked })}
                />
                Required
              </label>
              <button
                type="button"
                className="codice-bulk-btn ml-auto"
                title={`Remove field ${f.label} and its bound pattern nodes`}
                aria-label={`Remove field ${f.label} and its bound pattern nodes`}
                onClick={() => onDeleteField(f.id)}
              >
                <Trash size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section type seeder (§9)                                            */
/* ------------------------------------------------------------------ */

/**
 * §9 — Section types are STARTING structures. One explicit click appends
 * the chosen preset's structure exactly once (never a phantom copy on
 * every re-render or accidental select-drag).
 */
export function SectionTypeSeeder({
  onAppend,
}: {
  onAppend: (type: SectionTypeId) => void;
}) {
  const [type, setType] = useState<SectionTypeId>('task');
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="label block mb-1">Add a starter structure</label>
        <select
          className="select w-60"
          value={type}
          onChange={(e) => setType(e.target.value as SectionTypeId)}
          aria-label="Starter structure type"
        >
          {Object.values(SECTION_TYPE_PRESETS).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <span className="min-w-0 flex-1 truncate pb-2 text-[11px] text-muted">
        {sectionTypePreset(type).description}
      </span>
      <button type="button" className="btn-secondary" onClick={() => onAppend(type)}>
        <Plus size={13} /> Append structure
      </button>
    </div>
  );
}

/** Remove every content node bound to a field id (depth-first). */
export function stripFieldBindings(node: TemplateNode, fieldId: string): boolean {
  if (node.fieldId === fieldId) return true;
  if (node.children) {
    for (const stack of node.children) {
      for (const child of [...stack]) {
        if (stripFieldBindings(child, fieldId)) {
          stack.splice(stack.indexOf(child), 1);
        }
      }
    }
  }
  return false;
}
