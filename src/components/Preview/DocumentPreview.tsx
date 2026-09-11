/**
 * Document preview pane.
 *
 * Renders an HTML approximation of what the exported document will look like.
 * The preview uses the configured syntax theme (via Shiki) for code coloring
 * and applies the chosen page size and margins visually.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { getTheme } from '@/lib/themes/syntaxThemes';
import { highlightFile, getThemeColors } from '@/lib/highlight/highlighter';
import type { HighlightedFile } from '@/types';
import { formatBytes } from '@/lib/fileDiscovery';
import { languageLabel } from '@/lib/languageDetection';

const PAGE_DIMENSIONS_PX: Record<string, [number, number]> = {
  A4: [794, 1123], // 210x297mm at 96dpi
  Letter: [816, 1056],
  Legal: [816, 1344],
  A3: [1123, 1587],
};

export function DocumentPreview() {
  const { state, getSelectedFiles } = useAppState();
  const [highlightedCache, setHighlightedCache] = useState<
    Record<string, HighlightedFile>
  >({});
  const [themeColors, setThemeColors] = useState<{
    background: string;
    foreground: string;
  }>({ background: '#24292e', foreground: '#e1e4e8' });
  const containerRef = useRef<HTMLDivElement>(null);

  const opts = state.options;
  const theme = getTheme(opts.syntaxTheme);

  // Update theme colors when syntax theme changes.
  useEffect(() => {
    let cancelled = false;
    getThemeColors(opts.syntaxTheme).then((c) => {
      if (!cancelled) setThemeColors(c);
    });
    return () => {
      cancelled = true;
    };
  }, [opts.syntaxTheme]);

  // Gather all selected files across projects.
  const allSelected = useMemo(() => {
    const result: Array<{
      projectLabel: string;
      projectId: string;
      relativePath: string;
      language: string | null;
      sizeBytes: number;
      fileId: string;
    }> = [];
    for (const project of state.projects) {
      const selected = getSelectedFiles(project.id);
      for (const file of project.files) {
        if (selected.has(file.id)) {
          result.push({
            projectLabel: project.label,
            projectId: project.id,
            relativePath: file.relativePath,
            language: file.language,
            sizeBytes: file.size,
            fileId: file.id,
          });
        }
      }
    }
    return result;
  }, [state.projects, getSelectedFiles]);

  // Highlight files lazily — only the first N to keep the preview fast.
  const PREVIEW_LIMIT = 25;
  const filesToPreview = allSelected.slice(0, PREVIEW_LIMIT);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      for (const item of filesToPreview) {
        if (cancelled) return;
        if (highlightedCache[item.fileId]) continue;
        // Find the file's handle in state.
        const project = state.projects.find((p) => p.id === item.projectId);
        const file = project?.files.find((f) => f.id === item.fileId);
        if (!file?.fileHandle) continue;
        try {
          const text = await file.fileHandle.getText();
          const highlighted = await highlightFile(
            item.fileId,
            item.relativePath,
            item.language,
            text,
            opts.syntaxTheme,
          );
          if (!cancelled) {
            setHighlightedCache((prev) => ({
              ...prev,
              [item.fileId]: highlighted,
            }));
          }
        } catch {
          // ignore
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesToPreview.map((f) => f.fileId).join(','), opts.syntaxTheme]);

  const [pageW, pageH] = PAGE_DIMENSIONS_PX[opts.pageSize] ?? PAGE_DIMENSIONS_PX.A4;
  const effectiveW = opts.landscape ? pageH : pageW;
  const effectiveH = opts.landscape ? pageW : pageH;

  const scaleFactor = useMemo(() => {
    if (!containerRef.current) return 0.7;
    const available = containerRef.current.clientWidth - 48;
    return Math.min(1, available / effectiveW);
  }, [effectiveW, containerRef.current?.clientWidth]);

  const projectGroups = useMemo(() => {
    const groups: Array<{
      projectLabel: string;
      projectId: string;
      files: typeof filesToPreview;
    }> = [];
    for (const item of filesToPreview) {
      let g = groups.find((g) => g.projectId === item.projectId);
      if (!g) {
        g = {
          projectLabel: item.projectLabel,
          projectId: item.projectId,
          files: [],
        };
        groups.push(g);
      }
      g.files.push(item);
    }
    return groups;
  }, [filesToPreview]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto bg-[#0d1117] p-6"
      style={{
        backgroundImage:
          'radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
      }}
    >
      <div className="mx-auto" style={{ width: effectiveW * scaleFactor }}>
        <div
          className="bg-white shadow-2xl mx-auto"
          style={{
            width: effectiveW,
            minHeight: effectiveH,
            transform: `scale(${scaleFactor})`,
            transformOrigin: 'top left',
            marginBottom: (effectiveH - effectiveH * scaleFactor) * -1 + 24,
            padding: `${opts.margins.top * 3.78}px ${opts.margins.right * 3.78}px ${opts.margins.bottom * 3.78}px ${opts.margins.left * 3.78}px`,
            fontFamily: opts.bodyFont,
            fontSize: opts.bodyFontSize,
            color: '#1f2937',
          }}
        >
          {opts.includeFrontMatter && state.metadata.title && (
            <div className="text-center" style={{ marginTop: 100 }}>
              <div
                style={{
                  fontFamily: opts.headingFont,
                  fontSize: 32,
                  fontWeight: 'bold',
                  color: '#0f172a',
                }}
              >
                {state.metadata.title}
              </div>
              {state.metadata.author && (
                <div style={{ fontSize: 16, color: '#4b5563', marginTop: 12 }}>
                  {state.metadata.author}
                </div>
              )}
              {state.metadata.course && (
                <div style={{ fontSize: 14, color: '#6b7280', marginTop: 6 }}>
                  {state.metadata.course}
                </div>
              )}
              {state.metadata.university && (
                <div style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>
                  {state.metadata.university}
                </div>
              )}
              <div
                style={{
                  fontSize: 11,
                  color: '#9ca3af',
                  marginTop: 32,
                }}
              >
                Generated: {new Date().toLocaleString()}
              </div>
              {state.metadata.version && (
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                  Version: {state.metadata.version}
                </div>
              )}
              {state.metadata.description && (
                <div
                  style={{
                    fontSize: 12,
                    color: '#4b5563',
                    marginTop: 24,
                    maxWidth: 400,
                    margin: '24px auto 0',
                  }}
                >
                  {state.metadata.description}
                </div>
              )}
              <div style={{ pageBreakAfter: 'always', height: 0 }} />
            </div>
          )}

          {opts.includeToc && (
            <div style={{ marginBottom: 24 }}>
              <h1
                style={{
                  fontFamily: opts.headingFont,
                  fontSize: 22,
                  fontWeight: 'bold',
                  marginBottom: 12,
                  color: '#0f172a',
                }}
              >
                Table of Contents
              </h1>
              {projectGroups.map((g, gi) => (
                <div key={g.projectId}>
                  <div
                    style={{
                      fontFamily: opts.headingFont,
                      fontWeight: 'bold',
                      fontSize: 13,
                      marginTop: 8,
                    }}
                  >
                    {gi + 1}. {g.projectLabel}
                  </div>
                  {g.files.map((f, fi) => (
                    <div
                      key={f.fileId}
                      style={{
                        fontSize: 11,
                        color: '#4b5563',
                        marginLeft: 16,
                        marginTop: 2,
                      }}
                    >
                      {gi + 1}.{fi + 1}  {f.relativePath}
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ pageBreakAfter: 'always', height: 0 }} />
            </div>
          )}

          {projectGroups.map((g, gi) => (
            <div key={g.projectId} style={{ marginTop: gi === 0 ? 0 : 24 }}>
              <h1
                style={{
                  fontFamily: opts.headingFont,
                  fontSize: 22,
                  fontWeight: 'bold',
                  marginTop: 16,
                  marginBottom: 12,
                  color: '#0f172a',
                }}
              >
                {gi + 1}. {g.projectLabel}
              </h1>

              {opts.includeProjectStructure && (
                <div style={{ marginBottom: 16 }}>
                  <h2
                    style={{
                      fontFamily: opts.headingFont,
                      fontSize: 16,
                      fontWeight: 'bold',
                      marginBottom: 8,
                      color: '#0f172a',
                    }}
                  >
                    Project Structure
                  </h2>
                  <div
                    style={{
                      fontFamily: opts.codeFont,
                      fontSize: opts.codeFontSize - 1,
                      color: '#4b5563',
                      whiteSpace: 'pre',
                      lineHeight: 1.3,
                    }}
                  >
                    {buildStructurePreview(g.files.map((f) => f.relativePath))}
                  </div>
                </div>
              )}

              <h2
                style={{
                  fontFamily: opts.headingFont,
                  fontSize: 16,
                  fontWeight: 'bold',
                  marginTop: 16,
                  marginBottom: 8,
                  color: '#0f172a',
                }}
              >
                Source Files
              </h2>

              {g.files.map((f, fi) => {
                const highlighted = highlightedCache[f.fileId];
                return (
                  <div
                    key={f.fileId}
                    style={{
                      marginTop: opts.pageBreakBetweenFiles && fi > 0 ? 24 : 8,
                      pageBreakBefore:
                        opts.pageBreakBetweenFiles && fi > 0 ? 'always' : 'auto',
                    }}
                  >
                    <h3
                      style={{
                        fontFamily: opts.headingFont,
                        fontSize: 13,
                        fontWeight: 'bold',
                        color: '#1e293b',
                        marginTop: 8,
                      }}
                    >
                      {gi + 1}.{fi + 1}  {f.relativePath}
                    </h3>
                    {opts.showFileHeaders && (
                      <div
                        style={{
                          fontFamily: opts.codeFont,
                          fontSize: opts.codeFontSize - 1,
                          fontWeight: 'bold',
                          color: '#586069',
                          borderBottom: '0.5px solid #d0d7de',
                          paddingBottom: 4,
                          marginBottom: 6,
                        }}
                      >
                        {f.relativePath}    ·    {languageLabel(f.language)}    ·    {formatBytes(f.sizeBytes)}
                      </div>
                    )}
                    <CodeBlock
                      highlighted={highlighted}
                      options={opts}
                      themeColors={themeColors}
                    />
                  </div>
                );
              })}
            </div>
          ))}

          {allSelected.length > PREVIEW_LIMIT && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                background: '#fef3c7',
                color: '#92400e',
                fontSize: 12,
                borderRadius: 4,
              }}
            >
              Preview limited to {PREVIEW_LIMIT} files. The exported document
              will contain all {allSelected.length} selected files.
            </div>
          )}

          {allSelected.length === 0 && (
            <div
              style={{
                padding: 48,
                textAlign: 'center',
                color: '#9ca3af',
                fontSize: 14,
              }}
            >
              No files selected. Add a project and select files to preview the
              document.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CodeBlock({
  highlighted,
  options,
  themeColors,
}: {
  highlighted?: HighlightedFile;
  options: ReturnType<typeof useAppState>['state']['options'];
  themeColors: { background: string; foreground: string };
}) {
  if (!highlighted) {
    return (
      <div
        style={{
          padding: options.codePadding,
          background: themeColors.background,
          color: themeColors.foreground,
          fontFamily: options.codeFont,
          fontSize: options.codeFontSize,
          lineHeight: options.codeLineHeight,
          borderRadius: 2,
        }}
      >
        <div style={{ opacity: 0.5 }}>Loading…</div>
      </div>
    );
  }

  const lineNumberWidth = String(highlighted.lines.length).length;

  return (
    <div
      style={{
        background: themeColors.background,
        color: themeColors.foreground,
        fontFamily: options.codeFont,
        fontSize: options.codeFontSize,
        lineHeight: options.codeLineHeight,
        padding: options.codePadding,
        borderRadius: 2,
        border: options.codeBorderColor
          ? `${options.codeBorderWidth}px solid ${options.codeBorderColor}`
          : undefined,
        overflow: 'hidden',
      }}
    >
      {highlighted.lines.map((line) => (
        <div key={line.lineNumber} style={{ display: 'flex' }}>
          {options.showLineNumbers && (
            <span
              style={{
                color: '#7d8590',
                width: `${lineNumberWidth + 1}ch`,
                marginRight: 8,
                userSelect: 'none',
                textAlign: 'right',
                flexShrink: 0,
              }}
            >
              {line.lineNumber}
            </span>
          )}
          <span
            style={{
              whiteSpace: options.wrapLongLines ? 'pre-wrap' : 'pre',
              wordBreak: options.wrapLongLines ? 'break-word' : 'normal',
              overflow: options.wrapLongLines ? 'hidden' : 'auto',
            }}
          >
            {line.tokens.length === 0 ? (
              '\u00A0'
            ) : (
              line.tokens.map((tok, i) => {
                const text = line.text.slice(tok.start, tok.start + tok.length);
                return (
                  <span
                    key={i}
                    style={{
                      color: tok.color ?? themeColors.foreground,
                      fontWeight: tok.bold ? 'bold' : undefined,
                      fontStyle: tok.italic ? 'italic' : undefined,
                      textDecoration: tok.underline ? 'underline' : undefined,
                    }}
                  >
                    {text}
                  </span>
                );
              })
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function buildStructurePreview(paths: string[]): string {
  type Node = { name: string; children: Map<string, Node>; isFile: boolean };
  const root: Node = { name: '', children: new Map(), isFile: false };
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      if (!node.children.has(parts[i])) {
        node.children.set(parts[i], {
          name: parts[i],
          children: new Map(),
          isFile: isLast,
        });
      }
      node = node.children.get(parts[i])!;
      if (isLast) node.isFile = true;
    }
  }
  const out: string[] = [];
  const render = (node: Node, prefix: string, isRoot: boolean) => {
    const entries = Array.from(node.children.values()).sort((a, b) => {
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const isLast = i === entries.length - 1;
      const connector = isRoot ? '' : isLast ? '└── ' : '├── ';
      const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
      out.push(`${prefix}${connector}${e.name}`);
      if (!e.isFile) render(e, childPrefix, false);
    }
  };
  render(root, '', true);
  return out.join('\n');
}
