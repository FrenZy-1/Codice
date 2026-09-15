'use client';

/**
 * Node tree editor + property inspector (Block Editor level, §3/§9).
 *
 * The recursive editor from the original Layout Studio, re-homed into the
 * new hierarchy: it edits the NODE list of a Block definition (or a section
 * standalone list), preserving every capability — panels/columns, move /
 * duplicate / remove, collapse, property inspector with style overrides and
 * field binding. The inspector's "Bind to field" lists BOTH the owning
 * block's fields AND the owning section's fields (scope-ordered, §4).
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
} from '@/components/common/Icons';
import {
  NODE_TYPE_LABELS,
  nodeTypeDescription,
  genLayoutId,
  type TemplateNode,
  type TemplateBlockType,
  type TemplateFieldDefinition,
} from '@/lib/customLayouts/model';

/** Palette groups for the node palette (§6/§18). */
export const NODE_PALETTE: Array<{ group: string; types: TemplateBlockType[] }> = [
  { group: 'Content', types: ['heading', 'text', 'description', 'summary', 'note'] },
  { group: 'Code', types: ['file', 'code', 'fileName', 'filePath', 'language', 'fileSize', 'lineCount'] },
  { group: 'Media', types: ['image', 'fileImages'] },
  { group: 'Layout', types: ['panel', 'columns', 'divider', 'spacer', 'pageBreak'] },
  { group: 'Document', types: ['toc', 'metadata', 'project'] },
];

export function makeNode(type: TemplateBlockType): TemplateNode {
  const node: TemplateNode = { id: genLayoutId('n'), type };
  if (type === 'text') node.text = 'New text — tokens like {fileName} work';
  if (type === 'heading') {
    node.text = 'New heading';
    node.style = { level: 2 };
  }
  if (type === 'spacer') node.style = { heightPt: 12 };
  if (type === 'divider') node.style = { heightPt: 1, fillColor: '#888888' };
  if (type === 'panel') node.children = [[]];
  if (type === 'columns') {
    node.style = { columns: 2 };
    node.children = [[], []];
  }
  if (type === 'image') node.style = { caption: true };
  return node;
}

/** Locate the list holding a node id (depth-first, containers included). */
export function findNodeList(
  nodes: TemplateNode[],
  id: string,
): { list: TemplateNode[]; index: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return { list: nodes, index: i };
    const children = nodes[i].children;
    if (children) {
      for (const col of children) {
        const found = findNodeList(col, id);
        if (found) return found;
      }
    }
  }
  return null;
}

/** Locate a container node by id (for insertion into panel/column children). */
export function findContainer(nodes: TemplateNode[], id: string): TemplateNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      for (const col of n.children) {
        const found = findContainer(col, id);
        if (found) return found;
      }
    }
  }
  return null;
}

export function NodeTreeEditor({
  nodes,
  fields,
  sectionFields,
  selectedId,
  collapsed,
  onSelect,
  onMove,
  onRemove,
  onDuplicate,
  onToggleCollapse,
  onAdd,
  onPatch,
  onPatchStyle,
}: {
  nodes: TemplateNode[];
  /** Owning block's fields (per-file scope). */
  fields: TemplateFieldDefinition[];
  /** Owning section's fields (section scope) — bind targets too. */
  sectionFields: TemplateFieldDefinition[];
  selectedId: string | null;
  collapsed: Set<string>;
  onSelect: (id: string) => void;
  onMove: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onAdd: (type: TemplateBlockType, containerId?: string | null, columnIdx?: number) => void;
  onPatch: (id: string, patch: Partial<TemplateNode>) => void;
  onPatchStyle: (id: string, patch: Partial<NonNullable<TemplateNode['style']>>) => void;
}) {
  const selected = selectedId
    ? (findNodeList(nodes, selectedId)?.list[findNodeList(nodes, selectedId)!.index] ?? null)
    : null;

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-app p-2" data-tour="layout-palette">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
            Add node
          </span>
          <span className="text-[10px] text-muted">
            Code = only the code · File = header + code
          </span>
        </div>
        <div className="space-y-1.5">
          {NODE_PALETTE.map((group) => (
            <div key={group.group} className="flex flex-wrap items-center gap-1">
              <span className="w-16 flex-shrink-0 text-[10px] text-muted">{group.group}</span>
              {group.types.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="codice-input-chip"
                  title={nodeTypeDescription(type)}
                  aria-label={`Add ${NODE_TYPE_LABELS[type]} — ${nodeTypeDescription(type)}`}
                  onClick={() => onAdd(type)}
                >
                  <Plus size={9} /> {NODE_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-app p-2">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-secondary">
          Node structure — this pattern repeats once per assigned file
        </div>
        {nodes.length === 0 ? (
          <p className="px-1 py-3 text-center text-xs text-muted">
            Empty — add nodes from the palette above.
          </p>
        ) : (
          <ol className="space-y-0.5" role="list" aria-label="Block nodes">
            {nodes.map((n) => (
              <NodeRow
                key={n.id}
                node={n}
                depth={0}
                selectedId={selectedId}
                collapsed={collapsed}
                fields={fields}
                sectionFields={sectionFields}
                onSelect={onSelect}
                onMove={onMove}
                onRemove={onRemove}
                onDuplicate={onDuplicate}
                onToggleCollapse={onToggleCollapse}
                onAdd={onAdd}
              />
            ))}
          </ol>
        )}
      </div>

      {selected && (
        <NodeInspector
          node={selected}
          fields={fields}
          sectionFields={sectionFields}
          onPatch={(patch) => onPatch(selected.id, patch)}
          onPatchStyle={(patch) => onPatchStyle(selected.id, patch)}
        />
      )}
    </div>
  );
}

function NodeRow({
  node,
  depth,
  selectedId,
  collapsed,
  fields,
  sectionFields,
  onSelect,
  onMove,
  onRemove,
  onDuplicate,
  onToggleCollapse,
  onAdd,
}: {
  node: TemplateNode;
  depth: number;
  selectedId: string | null;
  collapsed: Set<string>;
  fields: TemplateFieldDefinition[];
  sectionFields: TemplateFieldDefinition[];
  onSelect: (id: string) => void;
  onMove: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onAdd: (type: TemplateBlockType, containerId?: string | null, columnIdx?: number) => void;
}) {
  const hasChildren = node.type === 'panel' || node.type === 'columns';
  const isCollapsed = collapsed.has(node.id);
  const selected = selectedId === node.id;

  return (
    <li>
      <div
        className={`group flex items-center gap-1 rounded px-1 py-0.5 text-xs transition-colors ${
          selected ? 'bg-app ring-1 ring-[var(--color-accent)]' : 'hover:bg-app'
        }`}
        style={{ paddingLeft: depth * 14 + 4 }}
        role="treeitem"
        aria-selected={selected}
        aria-label={`${NODE_TYPE_LABELS[node.type]} node${node.text ? `: ${node.text}` : ''}`}
      >
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-secondary"
          title={nodeTypeDescription(node.type)}
          onClick={() => onSelect(node.id)}
        >
          <span className="codice-drag-handle mr-1 inline-flex align-middle" aria-hidden="true">
            <GripVertical size={10} />
          </span>
          <span className="font-medium text-primary">{NODE_TYPE_LABELS[node.type]}</span>
          {node.text ? (
            <span className="ml-1 text-muted">
              “{node.text.slice(0, 24)}
              {node.text.length > 24 ? '…' : ''}”
            </span>
          ) : null}
          {node.fieldId ? (
            <span className="ml-1 rounded border border-app px-1 text-[9px] text-muted">
              field: {labelOf(fields, node.fieldId) ?? labelOf(sectionFields, node.fieldId) ?? 'id'}
            </span>
          ) : null}
        </button>
        {hasChildren && (
          <button
            type="button"
            className="flex-shrink-0 rounded p-0.5 text-muted hover:text-primary"
            aria-label={isCollapsed ? 'Expand children' : 'Collapse children'}
            onClick={() => onToggleCollapse(node.id)}
          >
            {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          </button>
        )}
        <span className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title="Move earlier" aria-label="Move node earlier" onClick={() => onMove(node.id, -1)}>
            <ChevronUp size={10} />
          </button>
          <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title="Move later" aria-label="Move node later" onClick={() => onMove(node.id, 1)}>
            <ChevronDown size={10} />
          </button>
          <button type="button" className="rounded p-0.5 text-muted hover:text-primary" title="Duplicate node" aria-label="Duplicate node" onClick={() => onDuplicate(node.id)}>
            <Copy size={10} />
          </button>
          <button type="button" className="rounded p-0.5 text-muted hover:text-error" title="Remove node" aria-label="Remove node" onClick={() => onRemove(node.id)}>
            <Trash size={10} />
          </button>
        </span>
      </div>

      {node.type === 'panel' && !isCollapsed && (
        <ContainerZone
          label="Panel content"
          containerId={node.id}
          columnIdx={0}
          list={node.children?.[0] ?? []}
          depth={depth + 1}
          selectedId={selectedId}
          collapsed={collapsed}
          fields={fields}
          sectionFields={sectionFields}
          onSelect={onSelect}
          onMove={onMove}
          onRemove={onRemove}
          onDuplicate={onDuplicate}
          onToggleCollapse={onToggleCollapse}
          onAdd={onAdd}
        />
      )}
      {node.type === 'columns' && !isCollapsed && (
        <div className="my-0.5 flex gap-1" style={{ paddingLeft: depth * 14 + 10 }}>
          {(node.children ?? []).slice(0, node.style?.columns ?? 2).map((col, i) => (
            <ContainerZone
              key={i}
              label={`Column ${i + 1}`}
              containerId={node.id}
              columnIdx={i}
              list={col}
              depth={depth + 1}
              selectedId={selectedId}
              collapsed={collapsed}
              fields={fields}
              sectionFields={sectionFields}
              onSelect={onSelect}
              onMove={onMove}
              onRemove={onRemove}
              onDuplicate={onDuplicate}
              onToggleCollapse={onToggleCollapse}
              onAdd={onAdd}
            />
          ))}
        </div>
      )}
    </li>
  );
}

function labelOf(fields: TemplateFieldDefinition[], id: string): string | null {
  return fields.find((f) => f.id === id)?.label ?? null;
}

function ContainerZone({
  label,
  containerId,
  columnIdx,
  list,
  depth,
  selectedId,
  collapsed,
  fields,
  sectionFields,
  onSelect,
  onMove,
  onRemove,
  onDuplicate,
  onToggleCollapse,
  onAdd,
}: Omit<Parameters<typeof NodeRow>[0], 'node'> & {
  label: string;
  containerId: string;
  columnIdx: number;
  list: TemplateNode[];
}) {
  return (
    <div className="ml-3 rounded border border-dashed border-app/70 p-1" aria-label={label}>
      <div className="mb-0.5 text-[9px] uppercase tracking-wide text-muted">{label}</div>
      <ol className="space-y-0.5" role="list">
        {list.map((n) => (
          <NodeRow
            key={n.id}
            node={n}
            depth={depth}
            selectedId={selectedId}
            collapsed={collapsed}
            fields={fields}
            sectionFields={sectionFields}
            onSelect={onSelect}
            onMove={onMove}
            onRemove={onRemove}
            onDuplicate={onDuplicate}
            onToggleCollapse={onToggleCollapse}
            onAdd={onAdd}
          />
        ))}
      </ol>
      <div className="mt-1 flex flex-wrap gap-1">
        {(['text', 'heading', 'image', 'fileImages', 'divider'] as TemplateBlockType[]).map((t) => (
          <button
            key={t}
            type="button"
            className="codice-input-chip"
            onClick={() => onAdd(t, containerId, columnIdx)}
            title={`Add ${NODE_TYPE_LABELS[t]} to ${label}`}
          >
            <Plus size={8} /> {NODE_TYPE_LABELS[t]}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Property inspector (compact, §39)                                   */
/* ------------------------------------------------------------------ */

export function NodeInspector({
  node,
  fields,
  sectionFields,
  onPatch,
  onPatchStyle,
}: {
  node: TemplateNode;
  fields: TemplateFieldDefinition[];
  sectionFields: TemplateFieldDefinition[];
  onPatch: (patch: Partial<TemplateNode>) => void;
  onPatchStyle: (patch: Partial<NonNullable<TemplateNode['style']>>) => void;
}) {
  const style = node.style ?? {};
  const bindable =
    node.type === 'text' || node.type === 'heading' || node.type === 'image';

  return (
    <div className="rounded-md border border-app p-2" aria-label="Node inspector" data-tour="layout-inspector">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-secondary">
        {NODE_TYPE_LABELS[node.type]} settings
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {(node.type === 'text' || node.type === 'heading') && !node.fieldId && (
          <div className="col-span-2">
            <label className="label block mb-1">
              {node.type === 'heading' ? 'Heading text' : 'Text'} — tokens {'{fileName} {filePath} {title} {projectName}'}
            </label>
            <input
              type="text"
              className="input"
              value={node.text ?? ''}
              onChange={(e) => onPatch({ text: e.target.value })}
            />
          </div>
        )}

        {bindable && (
          <div className="col-span-2">
            <label className="label block mb-1">
              Bind to field (optional) — block fields first, then section fields
            </label>
            <select
              className="select"
              value={node.fieldId ?? ''}
              onChange={(e) => onPatch({ fieldId: e.target.value || undefined })}
            >
              <option value="">— none —</option>
              {fields.length > 0 && (
                <optgroup label="Block fields (per file)">
                  {fields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label} ({f.kind}
                      {f.required ? ', required' : ''})
                    </option>
                  ))}
                </optgroup>
              )}
              {sectionFields.length > 0 && (
                <optgroup label="Section fields (shared)">
                  {sectionFields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label} ({f.kind}
                      {f.required ? ', required' : ''})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        )}

        {(node.type === 'text') && node.fieldId && (
          <label className="col-span-2 flex items-center gap-1.5 text-xs text-secondary">
            <input
              type="checkbox"
              className="h-3 w-3"
              checked={style.label ?? false}
              onChange={(e) => onPatchStyle({ label: e.target.checked })}
            />
            Show the field label above the value
          </label>
        )}

        {node.type === 'heading' && (
          <div>
            <label className="label block mb-1">Level</label>
            <select
              className="select"
              value={style.level ?? 2}
              onChange={(e) => onPatchStyle({ level: Number(e.target.value) as 1 | 2 | 3 })}
            >
              <option value={1}>H1</option>
              <option value={2}>H2</option>
              <option value={3}>H3</option>
            </select>
          </div>
        )}

        {node.type === 'image' && !node.fieldId && (
          <div className="col-span-2">
            <label className="label block mb-1">Image asset id (from an imported image)</label>
            <input
              type="text"
              className="input"
              placeholder="img-… (or bind to an image field above)"
              value={node.text ?? ''}
              onChange={(e) => onPatch({ text: e.target.value })}
            />
          </div>
        )}

        <div>
          <label className="label block mb-1">Align</label>
          <select
            className="select"
            value={style.align ?? 'left'}
            onChange={(e) => onPatchStyle({ align: e.target.value as 'left' | 'center' | 'right' })}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>

        {(node.type === 'text' || node.type === 'heading') && (
          <>
            <div>
              <label className="label block mb-1">Size (pt)</label>
              <input
                type="number"
                className="input"
                min={6}
                max={48}
                value={style.fontSizePt ?? ''}
                placeholder="preset"
                onChange={(e) =>
                  onPatchStyle({ fontSizePt: e.target.value ? Number(e.target.value) : undefined })
                }
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-secondary">
              <input
                type="checkbox"
                className="h-3 w-3"
                checked={style.bold ?? false}
                onChange={(e) => onPatchStyle({ bold: e.target.checked })}
              />
              Bold
            </label>
            <label className="flex items-center gap-1.5 text-xs text-secondary">
              <input
                type="checkbox"
                className="h-3 w-3"
                checked={style.italic ?? false}
                onChange={(e) => onPatchStyle({ italic: e.target.checked })}
              />
              Italic
            </label>
          </>
        )}

        {(node.type === 'spacer' || node.type === 'divider') && (
          <div>
            <label className="label block mb-1">
              {node.type === 'divider' ? 'Thickness (pt)' : 'Height (pt)'}
            </label>
            <input
              type="number"
              className="input"
              min={node.type === 'divider' ? 0.5 : 4}
              max={200}
              step={node.type === 'divider' ? 0.5 : 1}
              value={style.heightPt ?? (node.type === 'divider' ? 1 : 12)}
              onChange={(e) => onPatchStyle({ heightPt: Number(e.target.value) })}
            />
          </div>
        )}

        {node.type === 'divider' && (
          <div>
            <label className="label block mb-1">Bar color</label>
            <input
              type="color"
              className="input h-7 p-0.5"
              value={style.fillColor || '#888888'}
              onChange={(e) => onPatchStyle({ fillColor: e.target.value })}
            />
          </div>
        )}

        {node.type === 'columns' && (
          <div>
            <label className="label block mb-1">Column count</label>
            <select
              className="select"
              value={style.columns ?? 2}
              onChange={(e) => {
                const n = Number(e.target.value) as 2 | 3;
                onPatchStyle({ columns: n });
                const children = [...(node.children ?? [])];
                while (children.length < n) children.push([]);
                onPatch({ children: children.slice(0, n) });
              }}
            >
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </div>
        )}

        {(node.type === 'panel' || node.type === 'columns' || node.type === 'divider') && (
          <>
            {node.type !== 'divider' && (
              <>
                <div>
                  <label className="label block mb-1">Fill color</label>
                  <input
                    type="color"
                    className="input h-7 p-0.5"
                    value={style.fillColor || '#f5f5f5'}
                    onChange={(e) => onPatchStyle({ fillColor: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label block mb-1">Border color</label>
                  <input
                    type="color"
                    className="input h-7 p-0.5"
                    value={style.borderColor || '#dddddd'}
                    onChange={(e) => onPatchStyle({ borderColor: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label block mb-1">Border width (pt)</label>
                  <input
                    type="number"
                    className="input"
                    min={0}
                    max={6}
                    step={0.5}
                    value={style.borderWidthPt ?? 1}
                    onChange={(e) => onPatchStyle({ borderWidthPt: Number(e.target.value) })}
                  />
                </div>
              </>
            )}
            {node.type === 'panel' && (
              <div>
                <label className="label block mb-1">Padding (pt)</label>
                <input
                  type="number"
                  className="input"
                  min={0}
                  max={48}
                  value={style.paddingPt ?? 8}
                  onChange={(e) => onPatchStyle({ paddingPt: Number(e.target.value) })}
                />
              </div>
            )}
          </>
        )}

        {node.type === 'panel' && (
          <div>
            <label className="label block mb-1">Fixed height (pt, empty box)</label>
            <input
              type="number"
              className="input"
              min={0}
              max={400}
              value={style.heightPt ?? ''}
              placeholder="auto"
              onChange={(e) =>
                onPatchStyle({ heightPt: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </div>
        )}

        {node.type === 'image' && (
          <label className="flex items-center gap-1.5 text-xs text-secondary">
            <input
              type="checkbox"
              className="h-3 w-3"
              checked={style.caption !== false}
              onChange={(e) => onPatchStyle({ caption: e.target.checked })}
            />
            Show caption
          </label>
        )}
      </div>
    </div>
  );
}

/** Small helper hook used by editors for collapse state. */
export function useCollapseState(): [Set<string>, (id: string) => void] {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return [collapsed, toggle];
}
