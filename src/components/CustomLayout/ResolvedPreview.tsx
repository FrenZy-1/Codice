'use client';

/**
 * Resolved preview (§17) — renders the RESOLVED block stream with the
 * active preset's typography. This is the same resolved representation the
 * exporters consume; the studio never invents its own template rendering.
 */

import type { ResolvedLayoutBlock } from '@/lib/customLayouts/model';
import type { DocumentProject } from '@/types';
import { useAppState } from '@/hooks/useAppState';
import { fontStack } from '@/lib/fonts/fontCatalog';

export function ResolvedPreview({
  blocks,
  filesById,
  onNeedFileText,
  projects,
}: {
  blocks: ResolvedLayoutBlock[];
  filesById: React.MutableRefObject<Map<string, string>>;
  onNeedFileText: (fileId: string) => string | null;
  projects: DocumentProject[];
}) {
  const { state } = useAppState();
  const preset = state.preset;

  const findFile = (projectId: string, fileId: string) => {
    const p = projects.find((x) => x.id === projectId);
    return p?.files.find((f) => f.highlighted.fileId === fileId);
  };

  const renderBlocks = (list: ResolvedLayoutBlock[]): React.ReactNode[] => {
    return list.map((block, i) => {
      switch (block.kind) {
        case 'heading': {
          const h = preset.headings[block.level === 1 ? 'h1' : block.level === 2 ? 'h2' : 'h3'];
          return (
            <div
              key={i}
              style={{
                fontFamily: fontStack(h.font),
                fontSize: (block.fontSizePt ?? h.sizePt) * (4 / 3),
                fontWeight: block.bold ? 700 : 600,
                fontStyle: block.italic ? 'italic' : undefined,
                color: block.color ?? h.color,
                textAlign: block.align,
                margin: '10px 0 6px',
              }}
            >
              {block.text}
            </div>
          );
        }
        case 'paragraph':
          return (
            <p
              key={i}
              style={{
                fontFamily: fontStack(preset.typography.bodyFont),
                fontSize: (block.fontSizePt ?? preset.typography.bodyFontSizePt) * (4 / 3),
                color: block.color ?? preset.colors.primaryText,
                textAlign: block.align,
                margin: '0 0 6px',
                whiteSpace: 'pre-wrap',
              }}
            >
              {block.text}
            </p>
          );
        case 'labeled':
          return (
            <div key={i} style={{ margin: '0 0 8px' }}>
              <div
                style={{
                  fontSize: 8.5,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                  color: preset.colors.mutedText,
                  marginBottom: 2,
                }}
              >
                {block.label}
              </div>
              <p
                style={{
                  fontFamily: fontStack(preset.typography.bodyFont),
                  fontSize: preset.typography.bodyFontSizePt * (4 / 3),
                  color: block.color ?? preset.colors.primaryText,
                  textAlign: block.align,
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {block.text}
              </p>
            </div>
          );
        case 'fileHeader': {
          const file = findFile(block.projectId, block.fileId);
          return (
            <div
              key={i}
              style={{
                borderBottom: preset.fileHeaders.borderBottom
                  ? `1px solid ${preset.fileHeaders.borderColor}`
                  : undefined,
                paddingBottom: 4,
                marginBottom: 8,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: preset.fileHeaders.textColor }}>
                {file?.relativePath.split('/').pop() ?? '(file)'}
              </div>
              <div style={{ fontSize: 9.5, color: preset.colors.mutedText }}>
                {file?.relativePath ?? ''}
              </div>
            </div>
          );
        }
        case 'code': {
          const file = findFile(block.projectId, block.fileId);
          let text = filesById.current.get(block.fileId) ?? null;
          if (text === null && file) {
            text = onNeedFileText(block.fileId);
          }
          return (
            <pre
              key={i}
              style={{
                background: preset.code.backgroundColor,
                color: preset.code.textColor,
                fontFamily: fontStack(preset.code.font),
                fontSize: Math.min(8, preset.code.fontSizePt) * (4 / 3),
                lineHeight: 1.35,
                padding: preset.code.paddingPt,
                border:
                  preset.code.borderColor && preset.code.borderStyle !== 'none'
                    ? `${Math.max(0.5, preset.code.borderWidthPt)}px ${preset.code.borderStyle} ${preset.code.borderColor}`
                    : undefined,
                borderRadius: preset.code.borderRadiusPt,
                overflow: 'hidden',
                whiteSpace: 'pre-wrap',
                maxHeight: 180,
                margin: '6px 0',
              }}
            >
              {text !== null
                ? text.split('\n').slice(0, 24).join('\n')
                : '…code block (content loads when the file is readable)…'}
            </pre>
          );
        }
        case 'image':
          return (
            <figure key={i} style={{ margin: '8px 0', textAlign: block.align ?? 'center' }}>
              <img
                src={block.dataUrl}
                alt={block.caption || block.name}
                style={{
                  maxWidth: '62%',
                  border: `0.5px solid ${preset.colors.borders}`,
                  borderRadius: 2,
                }}
              />
              {block.captionVisible && block.caption && (
                <figcaption
                  style={{
                    fontSize: 9,
                    color: preset.colors.secondaryText,
                    fontStyle: 'italic',
                    marginTop: 3,
                  }}
                >
                  {block.caption}
                </figcaption>
              )}
            </figure>
          );
        case 'pageBreak':
          return (
            <div
              key={i}
              className="my-3 flex items-center gap-2 text-[9px] uppercase tracking-widest text-muted"
              aria-label="Page break"
            >
              <span className="h-px flex-1 bg-[var(--color-border)]" />
              page break
              <span className="h-px flex-1 bg-[var(--color-border)]" />
            </div>
          );
        case 'spacer':
          return <div key={i} style={{ height: block.heightPt * (4 / 3) }} />;
        case 'divider':
          return (
            <div
              key={i}
              aria-hidden="true"
              style={{
                height: Math.max(1, block.heightPt * (4 / 3)),
                background: block.fillColor ?? preset.colors.mutedText,
                borderRadius: 1,
                margin: '8px 0',
              }}
            />
          );
        case 'panel':
          return (
            <div
              key={i}
              style={{
                background: block.fillColor ?? undefined,
                border: block.borderColor
                  ? `${block.borderWidthPt ?? 1}px solid ${block.borderColor}`
                  : undefined,
                borderRadius: block.radiusPt ?? 0,
                padding: block.paddingPt ?? 8,
                height:
                  block.children.length === 0 && block.heightPt
                    ? Math.max(1, block.heightPt * (4 / 3))
                    : undefined,
                margin: '8px 0',
                // §25 — panel text color as the content default.
                color: block.textColor ?? undefined,
              }}
            >
              {renderBlocks(block.children)}
            </div>
          );
        case 'columns':
          return (
            <div key={i} className="my-2 flex gap-3">
              {block.columns.map((col, ci) => (
                <div key={ci} className="min-w-0 flex-1">
                  {renderBlocks(col)}
                </div>
              ))}
            </div>
          );
        case 'toc':
          return (
            <div key={i} className="my-2 rounded border border-app p-2 text-xs text-muted">
              Table of Contents (rendered from the selected files)
            </div>
          );
        case 'metadata':
          return (
            <div key={i} className="my-2 rounded border border-app p-2 text-xs text-muted">
              Metadata / title page (rendered from the document info dialog)
            </div>
          );
        case 'projectHeader': {
          const p = projects.find((x) => x.id === block.projectId);
          return (
            <div key={i} className="my-2 text-[11px] font-semibold uppercase tracking-wide text-secondary">
              {p?.label ?? 'Project header'}
            </div>
          );
        }
        default:
          return null;
      }
    });
  };

  return (
    // §19 — the layout preview shares the DOCUMENT surface: the preset's
    // page background + text colors (like the main + template previews),
    // never a hardcoded dark theme. Both app themes stay readable.
    <div
      data-tour="layout-preview-surface"
      style={{
        background: preset.colors.background,
        color: preset.colors.primaryText,
        borderRadius: 4,
        padding: 14,
        border: `1px solid ${preset.colors.borders}`,
        minHeight: '100%',
      }}
    >
      {renderBlocks(blocks)}
    </div>
  );
}
