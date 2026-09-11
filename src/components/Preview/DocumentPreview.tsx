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
import { fontStack } from '@/lib/fonts/fontCatalog';
import type { HighlightedFile } from '@/types';
import { formatBytes } from '@/lib/fileDiscovery';
import { languageLabel } from '@/lib/languageDetection';
import { presetToOptions } from '@/lib/presets/presetToOptions';

const PAGE_DIMENSIONS_PX: Record<string, [number, number]> = {
  A4: [794, 1123],
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

  const preset = state.preset;
  const opts = useMemo(() => presetToOptions(preset), [preset]);
  const theme = getTheme(preset.syntaxTheme);

  useEffect(() => {
    let cancelled = false;
    getThemeColors(preset.syntaxTheme).then((c) => {
      if (!cancelled) setThemeColors(c);
    });
    return () => {
      cancelled = true;
    };
  }, [preset.syntaxTheme]);

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

  const PREVIEW_LIMIT = 25;
  const filesToPreview = allSelected.slice(0, PREVIEW_LIMIT);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      for (const item of filesToPreview) {
        if (cancelled) return;
        if (highlightedCache[item.fileId]) continue;
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
            preset.syntaxTheme,
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
  }, [filesToPreview.map((f) => f.fileId).join(','), preset.syntaxTheme]);

  const [pageW, pageH] = PAGE_DIMENSIONS_PX[preset.page.size] ?? PAGE_DIMENSIONS_PX.A4;
  const effectiveW = preset.page.landscape ? pageH : pageW;
  const effectiveH = preset.page.landscape ? pageW : pageH;

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
      className="flex-1 overflow-auto bg-app p-6"
      style={{
        backgroundImage:
          'radial-gradient(circle, rgba(128,128,128,0.07) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
      }}
    >
      <div className="mx-auto" style={{ width: effectiveW * scaleFactor }}>
        <div
          className="shadow-2xl mx-auto"
          style={{
            width: effectiveW,
            minHeight: effectiveH,
            transform: `scale(${scaleFactor})`,
            transformOrigin: 'top left',
            marginBottom: (effectiveH - effectiveH * scaleFactor) * -1 + 24,
            padding: `${preset.page.marginTopMm * 3.78}px ${preset.page.marginRightMm * 3.78}px ${preset.page.marginBottomMm * 3.78}px ${preset.page.marginLeftMm * 3.78}px`,
            fontFamily: fontStack(preset.typography.bodyFont),
            fontSize: preset.typography.bodyFontSizePt,
            color: preset.colors.primaryText,
            background: preset.colors.background,
          }}
        >
          {preset.titlePage.enabled && state.metadata.title && (
            <div className="text-center" style={{ marginTop: 100 }}>
              {preset.titlePage.showTitle && (
                <div
                  style={{
                    fontFamily: fontStack(preset.headings.title.font),
                    fontSize: preset.headings.title.sizePt,
                    fontWeight: preset.headings.title.weight,
                    fontStyle: preset.headings.title.italic ? 'italic' : 'normal',
                    color: preset.headings.title.color,
                    textAlign: preset.headings.title.alignment,
                  }}
                >
                  {state.metadata.title}
                </div>
              )}
              {preset.titlePage.showAuthor && state.metadata.author && (
                <div
                  style={{
                    fontSize: preset.typography.bodyFontSizePt + 2,
                    color: preset.colors.secondaryText,
                    marginTop: 12,
                  }}
                >
                  {state.metadata.author}
                </div>
              )}
              {preset.titlePage.showCourse && state.metadata.course && (
                <div
                  style={{
                    fontSize: preset.typography.bodyFontSizePt,
                    color: preset.colors.mutedText,
                    marginTop: 6,
                  }}
                >
                  {state.metadata.course}
                </div>
              )}
              {preset.titlePage.showUniversity && state.metadata.university && (
                <div
                  style={{
                    fontSize: preset.typography.bodyFontSizePt,
                    color: preset.colors.mutedText,
                    marginTop: 4,
                  }}
                >
                  {state.metadata.university}
                </div>
              )}
              {preset.titlePage.showDate && (
                <div
                  style={{
                    fontSize: 11,
                    color: preset.colors.mutedText,
                    marginTop: 32,
                  }}
                >
                  Generated: {new Date().toLocaleString()}
                </div>
              )}
              {preset.titlePage.showVersion && state.metadata.version && (
                <div
                  style={{
                    fontSize: 11,
                    color: preset.colors.mutedText,
                    marginTop: 4,
                  }}
                >
                  Version: {state.metadata.version}
                </div>
              )}
              {preset.titlePage.showDescription && state.metadata.description && (
                <div
                  style={{
                    fontSize: 12,
                    color: preset.colors.secondaryText,
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

          {preset.includeToc && (
            <div style={{ marginBottom: 24 }}>
              <div
                style={{
                  fontFamily: fontStack(preset.headings.h1.font),
                  fontSize: preset.headings.h1.sizePt,
                  fontWeight: preset.headings.h1.weight,
                  color: preset.headings.h1.color,
                  marginBottom: 12,
                }}
              >
                Table of Contents
              </div>
              {projectGroups.map((g, gi) => (
                <div key={g.projectId}>
                  <div
                    style={{
                      fontFamily: fontStack(preset.headings.h1.font),
                      fontWeight: 'bold',
                      fontSize: 13,
                      marginTop: 8,
                      color: preset.colors.primaryText,
                    }}
                  >
                    {gi + 1}. {g.projectLabel}
                  </div>
                  {g.files.map((f, fi) => (
                    <div
                      key={f.fileId}
                      style={{
                        fontSize: 11,
                        color: preset.colors.secondaryText,
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
              <div
                style={{
                  fontFamily: fontStack(preset.projectHeaders.font),
                  fontSize: preset.projectHeaders.sizePt,
                  fontWeight: preset.projectHeaders.weight,
                  color: preset.projectHeaders.color,
                  textTransform: preset.projectHeaders.uppercase
                    ? 'uppercase'
                    : 'none',
                  marginTop: preset.projectHeaders.spaceBeforePt,
                  marginBottom: preset.projectHeaders.spaceAfterPt,
                }}
              >
                {gi + 1}. {g.projectLabel}
              </div>

              {preset.includeProjectStructure && (
                <div style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      fontFamily: fontStack(preset.headings.h2.font),
                      fontSize: preset.headings.h2.sizePt,
                      fontWeight: preset.headings.h2.weight,
                      color: preset.headings.h2.color,
                      marginBottom: 8,
                    }}
                  >
                    Project Structure
                  </div>
                  <div
                    style={{
                      fontFamily: fontStack(preset.code.font),
                      fontSize: preset.code.fontSizePt - 1,
                      color: preset.colors.secondaryText,
                      whiteSpace: 'pre',
                      lineHeight: 1.3,
                    }}
                  >
                    {buildStructurePreview(g.files.map((f) => f.relativePath))}
                  </div>
                </div>
              )}

              <div
                style={{
                  fontFamily: fontStack(preset.headings.h2.font),
                  fontSize: preset.headings.h2.sizePt,
                  fontWeight: preset.headings.h2.weight,
                  color: preset.headings.h2.color,
                  marginTop: 16,
                  marginBottom: 8,
                }}
              >
                Source Files
              </div>

              {g.files.map((f, fi) => {
                const highlighted = highlightedCache[f.fileId];
                return (
                  <div
                    key={f.fileId}
                    style={{
                      marginTop:
                        preset.pageBreakBetweenFiles && fi > 0 ? 24 : 8,
                      pageBreakBefore:
                        preset.pageBreakBetweenFiles && fi > 0
                          ? 'always'
                          : 'auto',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: fontStack(preset.headings.h3.font),
                        fontSize: preset.headings.h3.sizePt,
                        fontWeight: preset.headings.h3.weight,
                        color: preset.headings.h3.color,
                        marginTop: 8,
                      }}
                    >
                      {gi + 1}.{fi + 1}  {f.relativePath}
                    </div>
                    {preset.fileHeaders.show && (
                      <div
                        style={{
                          fontFamily: fontStack(preset.fileHeaders.font),
                          fontSize: preset.fileHeaders.fontSizePt,
                          fontWeight: preset.fileHeaders.bold ? 'bold' : 'normal',
                          color: preset.fileHeaders.textColor,
                          background:
                            preset.fileHeaders.background === 'transparent'
                              ? undefined
                              : preset.fileHeaders.background,
                          borderBottom: preset.fileHeaders.borderBottom
                            ? `0.5px solid ${preset.fileHeaders.borderColor}`
                            : undefined,
                          paddingBottom: 4,
                          marginBottom: 6,
                        }}
                      >
                        {[
                          preset.fileHeaders.showRelativePath && f.relativePath,
                          preset.fileHeaders.showLanguageLabel &&
                            languageLabel(f.language),
                          preset.fileHeaders.showFileSize &&
                            formatBytes(f.sizeBytes),
                        ]
                          .filter(Boolean)
                          .join('    ·    ')}
                      </div>
                    )}
                    <CodeBlock
                      highlighted={highlighted}
                      preset={preset}
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
                color: preset.colors.mutedText,
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
  preset,
  themeColors,
}: {
  highlighted?: HighlightedFile;
  preset: ReturnType<typeof useAppState>['state']['preset'];
  themeColors: { background: string; foreground: string };
}) {
  if (!highlighted) {
    return (
      <div
        style={{
          padding: preset.code.paddingPt,
          background: themeColors.background,
          color: themeColors.foreground,
          fontFamily: fontStack(preset.code.font),
          fontSize: preset.code.fontSizePt,
          lineHeight: preset.code.lineHeight,
          borderRadius: preset.code.borderRadiusPt,
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
        fontFamily: fontStack(preset.code.font),
        fontSize: preset.code.fontSizePt,
        lineHeight: preset.code.lineHeight,
        padding: preset.code.paddingPt,
        borderRadius: preset.code.borderRadiusPt,
        border: preset.code.borderColor
          ? `${preset.code.borderWidthPt}px solid ${preset.code.borderColor}`
          : undefined,
        overflow: 'hidden',
      }}
    >
      {highlighted.lines.map((line) => (
        <div key={line.lineNumber} style={{ display: 'flex' }}>
          {preset.code.showLineNumbers && (
            <span
              style={{
                color: preset.code.lineNumberColor,
                background: preset.code.lineNumberBackground ?? undefined,
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
              whiteSpace: preset.code.wrapLongLines ? 'pre-wrap' : 'pre',
              wordBreak: preset.code.wrapLongLines ? 'break-word' : 'normal',
              overflow: preset.code.wrapLongLines ? 'hidden' : 'auto',
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
