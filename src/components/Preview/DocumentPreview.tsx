/**
 * Document preview pane.
 *
 * Renders an HTML approximation of what the exported document will look like.
 * The preview consumes the SAME `DocumentPreset` that feeds the exporters —
 * there is no separate preview-only style state.
 *
 * Bug fixes applied here:
 *   - File header: fileName and relativePath are independent elements.
 *   - File metadata: showLanguageLabel / showFileSize / showLineCount each
 *     independently control their metadata piece.
 *   - Heading numbering: hierarchical (1, 1.1, 1.1.1) when misc.numberHeadings
 *     AND the per-heading numbered flag are both on.
 *   - Title page description: shows when enabled + content present.
 *   - Project header: showPath and showMetadata render real content.
 *   - Page header/footer: rendered visually with spacing.
 *   - Document density: all spacing values applied.
 *   - Page breaks: visible page-break markers.
 *   - Heading italic + weight: applied per-level.
 *   - Code border: borderStyle='none' truly disables border.
 *   - All document colors wired to semantic elements.
 *
 * Syntax highlighting is performed by Shiki. Shiki token colors are ALWAYS
 * respected — `preset.code.textColor` is only a fallback.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { highlightFile, getThemeColors } from '@/lib/highlight/highlighter';
import { resolveSyntaxTheme } from '@/lib/themes/syntaxThemeRegistry';
import { fontStack } from '@/lib/fonts/fontCatalog';
import type { DocumentPreset, FontWeight } from '@/lib/presets/documentPreset';
import type { HighlightedFile } from '@/types';
import { formatBytes } from '@/lib/fileDiscovery';
import { languageLabel } from '@/lib/languageDetection';

const PAGE_DIMENSIONS_PX: Record<string, [number, number]> = {
  A4: [794, 1123],
  Letter: [816, 1056],
  Legal: [816, 1344],
  A3: [1123, 1587],
};

/** Map FontWeight to numeric CSS font-weight. */
const WEIGHT_MAP: Record<FontWeight, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

/** Cache key that includes the syntax theme so theme changes invalidate it. */
function cacheKey(fileId: string, theme: string): string {
  return `${fileId}::${theme}`;
}

export function DocumentPreview() {
  const { state, getSelectedFiles } = useAppState();
  const [highlightedCache, setHighlightedCache] = useState<
    Record<string, HighlightedFile>
  >({});
  const [themeColors, setThemeColors] = useState<{
    background: string;
    foreground: string;
  }>({ background: '#0d1117', foreground: '#e6edf3' });
  const containerRef = useRef<HTMLDivElement>(null);

  const preset = state.preset;
  const resolvedTheme = resolveSyntaxTheme(preset.syntaxTheme);

  // Fetch theme colors whenever the syntax theme changes.
  useEffect(() => {
    let cancelled = false;
    getThemeColors(resolvedTheme).then((c) => {
      if (!cancelled) setThemeColors(c);
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedTheme]);

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

  const PREVIEW_LIMIT = 25;
  const filesToPreview = allSelected.slice(0, PREVIEW_LIMIT);

  // Re-highlight files when the syntax theme changes — clear the entire
  // cache so stale tokens don't bleed through.
  useEffect(() => {
    setHighlightedCache({});
  }, [resolvedTheme]);

  // Highlight files lazily. Re-runs when the file set or syntax theme changes.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      for (const item of filesToPreview) {
        if (cancelled) return;
        const key = cacheKey(item.fileId, resolvedTheme);
        if (highlightedCache[key]) continue;
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
            resolvedTheme,
          );
          if (!cancelled) {
            setHighlightedCache((prev) => ({
              ...prev,
              [key]: highlighted,
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
  }, [filesToPreview.map((f) => f.fileId).join(','), resolvedTheme]);

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

  /** Compute heading number prefix based on hierarchy. */
  function headingNumber(
    level: 'h1' | 'h2' | 'h3' | 'h4',
    projectIdx: number,
    fileIdx: number,
  ): string {
    if (!preset.misc.numberHeadings) return '';
    const h = preset.headings[level];
    if (!h.numbered) return '';
    switch (level) {
      case 'h1':
        return `${projectIdx + 1}. `;
      case 'h2':
        return `${projectIdx + 1}.${fileIdx + 1} `;
      case 'h3':
        return `${projectIdx + 1}.${fileIdx + 1}.1 `;
      case 'h4':
        return `${projectIdx + 1}.${fileIdx + 1}.1.1 `;
    }
  }

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
            fontWeight: WEIGHT_MAP[preset.typography.bodyWeight],
            color: preset.colors.primaryText,
            background: preset.colors.background,
            position: 'relative',
          }}
        >
          {/* Page header — rendered at the top */}
          {preset.page.pageHeader && (
            <div
              style={{
                color: preset.colors.mutedText,
                fontSize: 10,
                textAlign: 'right',
                marginBottom: preset.page.headerSpacingMm * 2,
                borderBottom: `0.5px solid ${preset.colors.borders}`,
                paddingBottom: 4,
              }}
            >
              {preset.page.pageHeader}
            </div>
          )}

          {/* Title page */}
          {preset.titlePage.enabled && state.metadata.title && (
            <div
              style={{
                textAlign: preset.titlePage.alignment,
                marginTop: preset.titlePage.verticalOffsetPt,
              }}
            >
              {preset.titlePage.showTitle && (
                <div
                  style={{
                    fontFamily: fontStack(preset.headings.title.font),
                    fontSize: preset.headings.title.sizePt,
                    fontWeight: WEIGHT_MAP[preset.headings.title.weight],
                    fontStyle: preset.headings.title.italic ? 'italic' : 'normal',
                    color: preset.headings.title.color,
                    textAlign: preset.headings.title.alignment,
                    lineHeight: preset.headings.title.lineHeight,
                    marginTop: preset.headings.title.spaceBeforePt,
                    marginBottom: preset.headings.title.spaceAfterPt,
                  }}
                >
                  {state.metadata.title}
                </div>
              )}
              {preset.titlePage.showSubtitle && state.metadata.course && (
                <div
                  style={{
                    fontFamily: fontStack(preset.typography.bodyFont),
                    fontSize: preset.typography.bodyFontSizePt + 2,
                    color: preset.colors.secondaryText,
                    marginTop: 8,
                    marginBottom: 8,
                  }}
                >
                  {state.metadata.course}
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
              {preset.titlePage.showCourse && !preset.titlePage.showSubtitle && state.metadata.course && (
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
                  {state.metadata.date || `Generated: ${new Date().toLocaleString()}`}
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
              {preset.pageBreaks.afterTitlePage && (
                <PageBreakMarker label="Page break — after title page" color={preset.colors.borders} />
              )}
            </div>
          )}

          {/* TOC */}
          {preset.misc.includeToc && (
            <div style={{ marginBottom: preset.layout.sectionSpacingPt }}>
              <div
                style={{
                  fontFamily: fontStack(preset.headings.h1.font),
                  fontSize: preset.headings.h1.sizePt,
                  fontWeight: WEIGHT_MAP[preset.headings.h1.weight],
                  fontStyle: preset.headings.h1.italic ? 'italic' : 'normal',
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
                      fontWeight: WEIGHT_MAP[preset.headings.h1.weight],
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
            </div>
          )}

          {/* Per-project sections */}
          {projectGroups.map((g, gi) => {
            // Compute project-level stats for the metadata display.
            const projectFiles = g.files;
            const totalSize = projectFiles.reduce((acc, f) => acc + f.sizeBytes, 0);
            return (
              <div
                key={g.projectId}
                style={{
                  marginTop: gi === 0 ? 0 : preset.layout.sectionSpacingPt,
                }}
              >
                {preset.pageBreaks.beforeProject && gi > 0 && (
                  <PageBreakMarker label={`Page break — before project ${gi + 1}`} color={preset.colors.borders} />
                )}

                {/* Project header — title + path + metadata, each independently toggled */}
                {preset.projectHeaders.showTitle && (
                  <div
                    style={{
                      fontFamily: fontStack(preset.projectHeaders.font),
                      fontSize: preset.projectHeaders.sizePt,
                      fontWeight: WEIGHT_MAP[preset.projectHeaders.weight],
                      color: preset.projectHeaders.color,
                      textTransform: preset.projectHeaders.uppercase ? 'uppercase' : 'none',
                      textAlign: preset.projectHeaders.alignment,
                      marginTop: preset.projectHeaders.spaceBeforePt,
                      marginBottom: 4,
                    }}
                  >
                    {gi + 1}. {g.projectLabel}
                  </div>
                )}
                {preset.projectHeaders.showPath && (
                  <div style={{ fontSize: 10, color: preset.colors.mutedText, marginBottom: 4 }}>
                    Path: {g.projectLabel}/
                  </div>
                )}
                {preset.projectHeaders.showMetadata && (
                  <div style={{ fontSize: 10, color: preset.colors.mutedText, marginBottom: preset.projectHeaders.spaceAfterPt }}>
                    Files: {projectFiles.length} · Total size: {formatBytes(totalSize)}
                  </div>
                )}

                {/* Project structure */}
                {preset.projectStructure.enabled && (
                  <div style={{ marginBottom: preset.layout.sectionSpacingPt }}>
                    <div
                      style={{
                        fontFamily: fontStack(preset.headings.h2.font),
                        fontSize: preset.headings.h2.sizePt,
                        fontWeight: WEIGHT_MAP[preset.headings.h2.weight],
                        fontStyle: preset.headings.h2.italic ? 'italic' : 'normal',
                        color: preset.headings.h2.color,
                        textAlign: preset.headings.h2.alignment,
                        marginBottom: 8,
                        lineHeight: preset.headings.h2.lineHeight,
                        textIndent: preset.headings.h2.indentPt,
                      }}
                    >
                      {headingNumber('h2', gi, 0)}Project Structure
                    </div>
                    <div
                      style={{
                        fontFamily: fontStack(preset.projectStructure.font),
                        fontSize: preset.projectStructure.fontSizePt,
                        color: preset.projectStructure.color,
                        whiteSpace: 'pre',
                        lineHeight: preset.projectStructure.lineHeight,
                      }}
                    >
                      {buildStructurePreview(
                        g.files.map((f) => f.relativePath),
                        preset.projectStructure.dirsFirst,
                      )}
                    </div>
                  </div>
                )}

                {/* H2 — Source Files */}
                <div
                  style={{
                    fontFamily: fontStack(preset.headings.h2.font),
                    fontSize: preset.headings.h2.sizePt,
                    fontWeight: WEIGHT_MAP[preset.headings.h2.weight],
                    fontStyle: preset.headings.h2.italic ? 'italic' : 'normal',
                    color: preset.headings.h2.color,
                    textAlign: preset.headings.h2.alignment,
                    marginTop: preset.headings.h2.spaceBeforePt,
                    marginBottom: preset.headings.h2.spaceAfterPt,
                    lineHeight: preset.headings.h2.lineHeight,
                    textIndent: preset.headings.h2.indentPt,
                  }}
                >
                  {headingNumber('h2', gi, 0)}Source Files
                </div>

                {g.files.map((f, fi) => {
                  const key = cacheKey(f.fileId, resolvedTheme);
                  const highlighted = highlightedCache[key];
                  const fileName = f.relativePath.split('/').pop() || f.relativePath;
                  return (
                    <div
                      key={f.fileId}
                      style={{
                        marginTop: fi === 0 ? 0 : preset.layout.sectionSpacingPt,
                      }}
                    >
                      {preset.pageBreaks.beforeFile && fi > 0 && (
                        <PageBreakMarker label={`Page break — before file ${fi + 1}`} color={preset.colors.borders} />
                      )}

                      {/* H3 — file heading */}
                      <div
                        style={{
                          fontFamily: fontStack(preset.headings.h3.font),
                          fontSize: preset.headings.h3.sizePt,
                          fontWeight: WEIGHT_MAP[preset.headings.h3.weight],
                          fontStyle: preset.headings.h3.italic ? 'italic' : 'normal',
                          color: preset.headings.h3.color,
                          textAlign: preset.headings.h3.alignment,
                          marginTop: preset.headings.h3.spaceBeforePt,
                          marginBottom: preset.headings.h3.spaceAfterPt,
                          lineHeight: preset.headings.h3.lineHeight,
                          textIndent: preset.headings.h3.indentPt,
                        }}
                      >
                        {headingNumber('h3', gi, fi)}
                        {f.relativePath}
                      </div>

                      {/* File header — fileName and relativePath are independent */}
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
                            marginBottom: preset.fileHeaders.spacingAfterPt,
                          }}
                        >
                          {preset.fileHeaders.showFileName && (
                            <div style={{ fontWeight: preset.fileHeaders.bold ? 'bold' : 'normal' }}>
                              {fileName}
                            </div>
                          )}
                          {preset.fileHeaders.showRelativePath && (
                            <div style={{ fontSize: preset.fileHeaders.fontSizePt - 1, opacity: 0.8 }}>
                              {f.relativePath}
                            </div>
                          )}
                          {/* Metadata line — each piece independently toggled */}
                          {(preset.fileHeaders.showLanguageLabel ||
                            preset.fileHeaders.showFileSize ||
                            (preset.fileHeaders.showLineCount && highlighted)) && (
                            <div style={{ fontSize: preset.fileHeaders.fontSizePt - 1, color: preset.colors.mutedText, marginTop: 2 }}>
                              {[
                                preset.fileHeaders.showLanguageLabel && languageLabel(f.language),
                                preset.fileHeaders.showFileSize && formatBytes(f.sizeBytes),
                                preset.fileHeaders.showLineCount && highlighted && `${highlighted.lines.length} lines`,
                              ].filter(Boolean).join('  ·  ')}
                            </div>
                          )}
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
            );
          })}

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

          {/* Page footer — rendered at the bottom */}
          {preset.page.pageFooter && (
            <div
              style={{
                color: preset.colors.mutedText,
                fontSize: 10,
                textAlign: 'center',
                marginTop: 32,
                borderTop: `0.5px solid ${preset.colors.borders}`,
                paddingTop: 4,
              }}
            >
              {preset.page.pageFooter
                .replace('{page}', '1')
                .replace('{pages}', '1')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Visual page-break marker. */
function PageBreakMarker({ label, color }: { label: string; color: string }) {
  return (
    <div
      style={{
        margin: '12px 0',
        padding: '4px 8px',
        textAlign: 'center',
        fontSize: 9,
        fontWeight: 'bold',
        color: color,
        borderTop: `1px dashed ${color}`,
        borderBottom: `1px dashed ${color}`,
        textTransform: 'uppercase',
        letterSpacing: 1,
      }}
    >
      {label}
    </div>
  );
}

/**
 * Code block renderer.
 *
 * Background logic:
 *   - If `preset.code.useSyntaxThemeBackground` is true → use Shiki's bg.
 *   - Otherwise → use `preset.code.backgroundColor`.
 *
 * Token colors: ALWAYS from Shiki. `preset.code.textColor` is the fallback
 * for tokens that don't have an explicit color.
 *
 * Border: `borderStyle='none'` truly disables the border (border: none).
 */
function CodeBlock({
  highlighted,
  preset,
  themeColors,
}: {
  highlighted?: HighlightedFile;
  preset: DocumentPreset;
  themeColors: { background: string; foreground: string };
}) {
  const effectiveBg = preset.code.useSyntaxThemeBackground
    ? themeColors.background
    : preset.code.backgroundColor;
  const fallbackFg = preset.code.useSyntaxThemeBackground
    ? themeColors.foreground
    : preset.code.textColor;

  // Border: 'none' truly disables it.
  const borderStyle =
    preset.code.borderStyle === 'none' || !preset.code.borderColor
      ? 'none'
      : `${preset.code.borderWidthPt}px solid ${preset.code.borderColor}`;

  if (!highlighted) {
    return (
      <div
        style={{
          padding: preset.code.paddingPt,
          background: effectiveBg,
          color: fallbackFg,
          fontFamily: fontStack(preset.code.font),
          fontSize: preset.code.fontSizePt,
          fontWeight: WEIGHT_MAP[preset.code.fontWeight],
          lineHeight: preset.code.lineHeight,
          borderRadius: preset.code.borderRadiusPt,
          border: borderStyle,
        }}
      >
        <div style={{ opacity: 0.5 }}>Loading…</div>
      </div>
    );
  }

  const lineNumberWidth =
    preset.code.lineNumberWidthChars > 0
      ? preset.code.lineNumberWidthChars
      : String(highlighted.lines.length).length;

  return (
    <div
      style={{
        background: effectiveBg,
        fontFamily: fontStack(preset.code.font),
        fontSize: preset.code.fontSizePt,
        fontWeight: WEIGHT_MAP[preset.code.fontWeight],
        lineHeight: preset.code.lineHeight,
        padding: preset.code.paddingPt,
        borderRadius: preset.code.borderRadiusPt,
        border: borderStyle,
        overflow: 'hidden',
        marginTop: preset.code.blockSpacingBeforePt,
        marginBottom: preset.code.blockSpacingAfterPt,
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
              color: fallbackFg,
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
                      color: tok.color ?? undefined,
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

function buildStructurePreview(
  paths: string[],
  dirsFirst: boolean = true,
): string {
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
      if (dirsFirst) {
        if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      }
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
