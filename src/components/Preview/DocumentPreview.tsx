/**
 * Document preview pane — REAL multi-page preview.
 *
 * Renders a paginated HTML approximation of the exported document. It shares
 * ONE element model + paginator with the template-settings preview
 * (`@/lib/preview/documentPagination`, spec §11/§13) and consumes the SAME
 * canonical `DocumentPreset` that feeds the exporters — there is no
 * preview-only style state.
 *
 * Behavior highlights:
 *   - Page-break settings (after title / before project / before file /
 *     before H1) move content to an actual separate page — never a
 *     divider-only simulation (spec §11).
 *   - The title page is ONE coherent group: horizontal alignment applies to
 *     every element; vertical alignment positions the whole group (§9/§29).
 *   - Structured page headers/footers (single/dual/triple + slots) render
 *     per page with tokens resolved through the shared engine (§27, §7).
 *   - Setting changes briefly highlight ONLY the affected preview regions
 *     (§8/§30): region ids match computeHighlightIds and only sub-objects
 *     that actually changed flash.
 *   - Outline panel anchors + scroll-spy, print stylesheet, Unicode
 *     box-drawing glyphs with DejaVu fallback (§23/§24).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { highlightFile, getThemeColors, plainHighlightedFile } from '@/lib/highlight/highlighter';
import { resolveSyntaxTheme } from '@/lib/themes/syntaxThemeRegistry';
import { fontStack } from '@/lib/fonts/fontCatalog';
import type { DocumentPreset, FooterSlotType } from '@/lib/presets/documentPreset';
import type { DocumentImage, DocumentMetadata, FileDetails, HighlightedFile, ImageAsset } from '@/types';
import { formatBytes } from '@/lib/fileDiscovery';
import { languageLabel } from '@/lib/languageDetection';
import { PreviewWelcome, PreviewNoSelection } from '@/components/Preview/PreviewEmptyStates';
import { buildStaticTokenContext, expandTokens } from '@/lib/tokens';
import { buildDocumentOutline, type OutlineEntry } from '@/lib/documentOutline';
import { OutlinePanel } from '@/components/Preview/OutlinePanel';
import { StatsPanel } from '@/components/common/StatsPanel';
import { ToolbarButton, stepZoomLadder } from '@/components/common/PreviewControls';
import { ListTree, BarChart, ChevronLeft, ChevronRight, Minus, Plus } from '@/components/common/Icons';
import { effectiveFileOrder } from '@/lib/documentOrder';
import {
  customLayoutToElements,
  buildLayoutOutline,
  buildLayoutIndexMaps,
} from '@/lib/customLayouts/previewElements';
import { resolveCustomLayout, type ResolutionInputs } from '@/lib/customLayouts/resolver';
import type { DocumentProject } from '@/types';
import {
  buildDocumentElements,
  paginateDocument,
  pageBoxPx,
  pageContentAlignment,
  MM_TO_PX,
  PT_TO_PX,
  WEIGHT_MAP,
  type PaginationProject,
  type PreviewElement,
  type PreviewPage,
} from '@/lib/preview/documentPagination';

/** Map FontWeight to numeric CSS font-weight (re-exported from the shared model). */
const WEIGHTS = WEIGHT_MAP;

/** Cache key that includes the syntax theme so theme changes invalidate it. */
function cacheKey(fileId: string, theme: string): string {
  return `${fileId}::${theme}`;
}

/** CSS font stack with a guaranteed Unicode-glyph fallback for box drawing. */
function glyphCapableStack(stack: string): string {
  if (/monospace\s*$/.test(stack.trim())) {
    return stack.replace(/monospace\s*$/, '"DejaVu Sans Mono", monospace');
  }
  return `${stack}, "DejaVu Sans Mono", monospace`;
}

/** Preview file limit — the exported document contains ALL selected files. */
const PREVIEW_LIMIT = 25;

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
    getThemeColors(resolvedTheme)
      .then((c) => {
        if (!cancelled) setThemeColors(c);
      })
      .catch(() => {
        if (!cancelled) setThemeColors({ background: '#0d1117', foreground: '#e6edf3' });
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedTheme]);

  // Gather all selected files across projects — in the CANONICAL document
  // order (§13/§36) with per-file details + images attached (§6/§10).
  const allSelected = useMemo(() => {
    const result: Array<{
      projectLabel: string;
      projectId: string;
      relativePath: string;
      language: string | null;
      sizeBytes: number;
      fileId: string;
      details?: FileDetails;
      images?: DocumentImage[];
    }> = [];
    for (const project of state.projects) {
      const selected = getSelectedFiles(project.id);
      const ordered = effectiveFileOrder(project.files, state.fileOrder[project.id]);
      for (const file of ordered) {
        if (selected.has(file.id)) {
          const details = state.fileDetails[file.id];
          const imageIds = state.fileImages[file.id] ?? [];
          const images = imageIds
            .map((id) => state.imageAssets.find((a) => a.id === id))
            .filter((a): a is ImageAsset => Boolean(a))
            .map((a) => ({
              id: a.id,
              name: a.name,
              dataUrl: a.dataUrl,
              mime: a.mime,
              width: a.width,
              height: a.height,
              caption: a.caption,
            }));
          result.push({
            projectLabel: project.label,
            projectId: project.id,
            relativePath: file.relativePath,
            language: file.language,
            sizeBytes: file.size,
            fileId: file.id,
            ...(details ? { details } : {}),
            ...(images.length > 0 ? { images } : {}),
          });
        }
      }
    }
    return result;
  }, [
    state.projects,
    state.fileOrder,
    state.fileDetails,
    state.fileImages,
    state.imageAssets,
    getSelectedFiles,
  ]);

  const filesToPreview = allSelected.slice(0, PREVIEW_LIMIT);

  // Prune stale theme entries when the theme changes.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setHighlightedCache((prev) => {
        const next: Record<string, HighlightedFile> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (k.endsWith(`::${resolvedTheme}`)) next[k] = v;
        }
        return next;
      });
    }, 0);
    return () => window.clearTimeout(t);
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
          let highlighted: HighlightedFile;
          try {
            highlighted = await highlightFile(
              item.fileId,
              item.relativePath,
              item.language,
              text,
              resolvedTheme,
            );
          } catch {
            // spec §8: a file whose highlighting fails (unknown language,
            // grammar error) still renders — as plaintext — instead of
            // being stuck on "Loading…" forever. Re-enabling an excluded
            // file therefore always recovers naturally.
            highlighted = plainHighlightedFile(item.fileId, item.relativePath, text);
          }
          if (!cancelled) {
            setHighlightedCache((prev) => ({
              ...prev,
              [key]: highlighted,
            }));
          }
        } catch {
          // Unreadable file handle — nothing to render.
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [filesToPreview.map((f) => f.fileId).join(','), resolvedTheme]);

  // ---- Document outline state ----
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  /** Smooth-scroll the preview so the anchor section sits at the top. */
  const navigateToOutline = useCallback((id: string) => {
    const root = containerRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-outline-id="${id}"]`);
    if (!root || !el) return;
    const rootRect = root.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const top = root.scrollTop + (elRect.top - rootRect.top) - 24;
    if (typeof root.scrollTo === 'function') {
      root.scrollTo({ top, behavior: 'smooth' });
    } else {
      root.scrollTop = top; // jsdom fallback
    }
  }, []);

  /** rAF-throttled scroll-spy — the topmost visible anchor wins. */
  const handlePreviewScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const root = containerRef.current;
      if (!root) return;
      const anchors = root.querySelectorAll<HTMLElement>('[data-outline-id]');
      if (anchors.length === 0) return;
      const rootTop = root.getBoundingClientRect().top;
      let current: string | null = anchors[0].getAttribute('data-outline-id');
      for (const el of Array.from(anchors)) {
        if (el.getBoundingClientRect().top <= rootTop + 120) {
          current = el.getAttribute('data-outline-id');
        } else {
          break;
        }
      }
      setActiveOutlineId(current);
    });
  }, []);

  // Ctrl+O (dispatched from the global shortcut handler) toggles the panel.
  useEffect(() => {
    const onToggle = () => setOutlineOpen((v) => !v);
    window.addEventListener('codice:toggle-outline', onToggle);
    return () => {
      window.removeEventListener('codice:toggle-outline', onToggle);
    };
  }, []);

  // Measure the container width so the page can be scaled to fit.
  // The scroll container below is rendered UNCONDITIONALLY (the empty state
  // renders inside it), so this element never gets replaced and the
  // observer stays attached for the component's whole life — previously the
  // empty state swapped in a different node and containerWidth froze at a
  // stale value, shrinking the preview to the 0.3 scale floor (§2/§3).
  const [containerWidth, setContainerWidth] = useState(800);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- Preview zoom (§5) — affects THIS preview only; independent from the
  // template-settings preview zoom (§16) and from any document setting. ----
  const [zoom, setZoom] = useState<number | 'fit'>('fit');

  // ---- Shared pagination model ----

  const paginationProjects = useMemo<PaginationProject[]>(() => {
    const groups: PaginationProject[] = [];
    for (const item of filesToPreview) {
      let g = groups.find((g) => g.label === item.projectLabel && g.outlineProjectId === item.projectId);
      if (!g) {
        g = {
          label: item.projectLabel,
          path: `${item.projectLabel}/`,
          structure: [],
          files: [],
          outlineProjectId: item.projectId,
        };
        groups.push(g);
      }
      g.structure.push(item.relativePath);
      g.files.push({
        name: item.relativePath.split('/').pop() || item.relativePath,
        path: item.relativePath,
        language: item.language ?? 'plaintext',
        size: item.sizeBytes,
        outlineFileId: item.fileId,
        ...(item.details ? { details: item.details } : {}),
        ...(item.images ? { images: item.images } : {}),
      });
    }
    return groups;
  }, [filesToPreview]);

  // ---- Multi-project preview tabs (spec §11/§12) ----
  // In "separate document per project" mode the preview shows ONE project
  // at a time, switchable via browser-style tabs. Combined mode keeps the
  // sequential multi-project document (and shows no tabs).
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const separateMode = state.outputMode === 'separate' && paginationProjects.length > 1;
  const projectTabId = (g: PaginationProject) => g.outlineProjectId ?? g.label;
  // Derived (not effect-synced): a selection that no longer matches any
  // project (removed/reordered) falls back to the first project.
  const validTabId = paginationProjects.some((g) => projectTabId(g) === activeTabId)
    ? activeTabId
    : null;
  const activeGroup = separateMode
    ? paginationProjects.find((g) => projectTabId(g) === validTabId) ?? paginationProjects[0]
    : null;
  const visiblePaginationProjects = useMemo<PaginationProject[]>(
    () => (separateMode && activeGroup ? [activeGroup] : paginationProjects),
    [separateMode, activeGroup, paginationProjects],
  );

  const getHlForFile = useCallback(
    (fileId: string): HighlightedFile | null =>
      highlightedCache[cacheKey(fileId, resolvedTheme)] ?? null,
    [highlightedCache, resolvedTheme],
  );

  // §15 — the file context menu's "Open in preview" jumps straight to the
  // file using its STABLE identity (fileId + owning project), never the
  // filename. In separate-per-project mode the correct project tab is
  // activated first, then the anchor is scrolled into view.
  useEffect(() => {
    const onNavigateToFile = (e: Event) => {
      const detail = (e as CustomEvent<{ fileId: string; projectId?: string }>).detail;
      const fileId = typeof detail === 'string' ? detail : detail?.fileId;
      const projectId = typeof detail === 'string' ? undefined : detail?.projectId;
      if (typeof fileId !== 'string') return;
      const anchorId = `outline-file-${fileId}`;
      const group = paginationProjects.find((g) =>
        g.files.some((f) => f.outlineFileId === fileId),
      );
      if (group && projectTabId(group) !== validTabId) {
        setActiveTabId(projectTabId(group));
        // Allow the tab switch to render, then scroll to the anchor.
        window.setTimeout(() => navigateToOutline(anchorId), 150);
        return;
      }
      navigateToOutline(anchorId);
    };
    window.addEventListener('codice:navigate-to-file', onNavigateToFile);
    return () => {
      window.removeEventListener('codice:navigate-to-file', onNavigateToFile);
    };
  }, [navigateToOutline, paginationProjects, validTabId]);

  // ---- Applied custom layout (§16-§33) — ONE canonical data flow:
  // state data → resolver → resolved blocks → THIS preview AND the
  // exporters. The preview never invents its own template representation.
  const appliedLayout = useMemo(
    () =>
      state.customLayouts.find((t) => t.id === state.appliedLayoutId) ?? null,
    [state.customLayouts, state.appliedLayoutId],
  );

  // DocumentProject-shaped projection of the visible pagination groups
  // (the resolver consumes the document model, not preview internals).
  const layoutProjects = useMemo<DocumentProject[]>(
    () =>
      visiblePaginationProjects.map((g) => ({
        id: g.outlineProjectId ?? g.label,
        label: g.label,
        folderName: g.label,
        structurePaths: [],
        files: g.files.map((f) => ({
          projectId: g.outlineProjectId ?? g.label,
          projectLabel: g.label,
          relativePath: f.path,
          language: null,
          highlighted: {
            fileId: f.outlineFileId ?? f.path,
            relativePath: f.path,
            language: null,
            lines: [],
          },
          sizeBytes: f.size,
          details: f.details,
          images: f.images,
        })),
      })),
    [visiblePaginationProjects],
  );

  const layoutResolution = useMemo(() => {
    if (!appliedLayout) return null;
    const inputs: ResolutionInputs = {
      projects: layoutProjects,
      fileDetails: state.fileDetails,
      fileFieldValues: state.fileFieldValues,
      sectionFieldValues: state.sectionFieldValues,
      fileOrder: state.fileOrder,
      assignments: state.layoutAssignments,
      imageAssets: Object.fromEntries(state.imageAssets.map((a) => [a.id, a])),
      metadata: state.metadata,
      fileCount: layoutProjects.reduce((acc, p) => acc + p.files.length, 0),
    };
    return resolveCustomLayout(appliedLayout, inputs);
  }, [
    appliedLayout,
    layoutProjects,
    state.fileDetails,
    state.fileFieldValues,
    state.sectionFieldValues,
    state.fileOrder,
    state.layoutAssignments,
    state.imageAssets,
    state.metadata,
  ]);

  const elements = useMemo(
    () =>
      layoutResolution
        ? customLayoutToElements(
            layoutResolution,
            visiblePaginationProjects,
            buildLayoutIndexMaps(visiblePaginationProjects),
          )
        : buildDocumentElements(preset, visiblePaginationProjects),
    [layoutResolution, preset, visiblePaginationProjects],
  );

  const pages = useMemo(
    () =>
      paginateDocument(elements, preset, visiblePaginationProjects, {
        getLineCount: (file) => {
          const id = visiblePaginationProjects
            .flatMap((p) => p.files)
            .find((f) => f === file)?.outlineFileId;
          const hl = id ? getHlForFile(id) : null;
          if (hl) return hl.lines.length;
          return file.code ? file.code.split('\n').length : 1;
        },
        getLineText: (file, lineIdx) => {
          const id = visiblePaginationProjects
            .flatMap((p) => p.files)
            .find((f) => f === file)?.outlineFileId;
          const hl = id ? getHlForFile(id) : null;
          return hl?.lines[lineIdx]?.text ?? '';
        },
      }),
    [elements, preset, visiblePaginationProjects, getHlForFile],
  );

  const outline: OutlineEntry[] = useMemo(
    () =>
      layoutResolution
        ? // §33 — the applied layout mirrors into the SAME outline model.
          buildLayoutOutline(layoutResolution, visiblePaginationProjects)
        : buildDocumentOutline({
            projects: visiblePaginationProjects.map((g) => ({
              id: g.outlineProjectId ?? g.label,
              label: g.label,
              files: g.files.map((f) => ({
                fileId: f.outlineFileId ?? f.path,
                relativePath: f.path,
                language: f.language,
                sizeBytes: f.size,
              })),
            })),
            includeTitlePage: preset.titlePage.enabled,
            hasTitle: Boolean(state.metadata.title),
            includeToc: preset.misc.includeToc,
            includeStructure: preset.projectStructure.enabled,
          }),
    [
      layoutResolution,
      visiblePaginationProjects,
      preset.titlePage.enabled,
      preset.misc.includeToc,
      preset.projectStructure.enabled,
      state.metadata.title,
    ],
  );

  /* ------------------------------------------------------------------ */
  /* Change flash — ONLY the affected regions (spec §8/§30)              */
  /* ------------------------------------------------------------------ */

  const flashTimerRef = useRef<number | null>(null);
  useEffect(() => {
    // The template editor computes the affected region ids (diffed against
    // the previous preset so group-merging patches target only the changed
    // sub-objects) and broadcasts them — both previews flash the SAME ids.
    const onFlash = (e: Event) => {
      const ids = (e as CustomEvent<string[]>).detail ?? [];
      if (!Array.isArray(ids) || ids.length === 0) return;
      const root = containerRef.current;
      if (!root) return;
      root.querySelectorAll<HTMLElement>('[data-codice-region]').forEach((el) => {
        const region = el.dataset.codiceRegion ?? '';
        if (!ids.includes(region)) return;
        el.classList.remove('codice-highlight');
        void el.offsetWidth; // restart animation
        el.classList.add('codice-highlight');
      });
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => {
        root.querySelectorAll<HTMLElement>('.codice-highlight').forEach((el) =>
          el.classList.remove('codice-highlight'),
        );
      }, 1100);
    };
    window.addEventListener('codice:flash-regions', onFlash);
    return () => {
      window.removeEventListener('codice:flash-regions', onFlash);
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  /* ---------------- Page box + zoom (§5) ---------------- */

  const { pageW: effectiveW, pageH: effectiveH } = pageBoxPx(preset);
  // 'Fit' derives from the LIVE container measurement; an explicit zoom
  // percentage overrides it. The floor keeps tiny viewports readable while
  // the document preview keeps its visual focus (§3).
  const fitScale = Math.min(1, Math.max(0.3, (containerWidth - 48) / effectiveW));
  const scaleFactor = zoom === 'fit' ? fitScale : Math.min(2, Math.max(0.3, zoom / 100));
  const stepZoom = (delta: number) =>
    setZoom((z) => stepZoomLadder(typeof z === 'number' ? z : Math.round(fitScale * 100), delta));

  const marginTop = preset.page.marginTopMm * MM_TO_PX;
  const marginBottom = preset.page.marginBottomMm * MM_TO_PX;
  const marginLeft = preset.page.marginLeftMm * MM_TO_PX;
  const marginRight = preset.page.marginRightMm * MM_TO_PX;
  const headerReserve = preset.page.pageHeaderShow ? Math.max(28, preset.page.headerSpacingMm * MM_TO_PX) : 0;
  const footerReserve = preset.page.pageFooterShow ? Math.max(28, preset.page.footerSpacingMm * MM_TO_PX) : 0;

  const effectiveBg = preset.code.useSyntaxThemeBackground ? themeColors.background : preset.code.backgroundColor;
  const fallbackFg = preset.code.useSyntaxThemeBackground ? themeColors.foreground : preset.code.textColor;
  const codeBorderCss =
    preset.code.borderStyle === 'none' || !preset.code.borderColor
      ? 'none'
      : `${Math.max(0.5, preset.code.borderWidthPt)}px ${preset.code.borderStyle} ${preset.code.borderColor}`;

  /* ---------------- Per-page token expansion (shared engine) ---------------- */

  const nowDate = new Date();
  const staticCtx = buildStaticTokenContext({
    metadata: state.metadata,
    firstProjectLabel: allSelected[0]?.projectLabel ?? null,
    fileCount: allSelected.length,
    now: nowDate,
  });

  function headerText(slot: string | null): string | null {
    if (!slot) return null;
    return expandTokens(slot, staticCtx);
  }

  function footerValue(type: FooterSlotType, page: PreviewPage, pageNo: number): string {
    switch (type) {
      case 'none':
        return '';
      case 'text':
        return expandTokens(preset.page.pageFooterText ?? '', {
          ...staticCtx,
          page: String(pageNo),
          pages: String(pages.length),
          lines: String(page.linesOnPage),
          fileName: page.fileName ?? '',
          projectName: page.projectName ?? '',
        });
      case 'pageNumber':
        return String(pageNo);
      case 'pageCount':
        return String(pages.length);
      case 'linesOnPage':
        return page.linesOnPage > 0 ? `${page.linesOnPage} lines` : '—';
      case 'fileName':
        return page.fileName ?? '';
      case 'projectName':
        return page.projectName ?? '';
      case 'date':
        return state.metadata.date || nowDate.toLocaleDateString();
      default:
        return '';
    }
  }

  function renderHeaderRow() {
    if (!preset.page.pageHeaderShow) return null;
    const p = preset.page;
    const slots = (() => {
      if (p.pageHeaderLayout === 'single') {
        return [{ text: headerText(p.pageHeaderCenter ?? p.pageHeader), align: p.pageHeaderAlign }];
      }
      if (p.pageHeaderLayout === 'dual') {
        return [
          { text: headerText(p.pageHeaderLeft), align: 'left' as const },
          { text: headerText(p.pageHeaderRight), align: 'right' as const },
        ];
      }
      return [
        { text: headerText(p.pageHeaderLeft), align: 'left' as const },
        { text: headerText(p.pageHeaderCenter), align: 'center' as const },
        { text: headerText(p.pageHeaderRight), align: 'right' as const },
      ];
    })().filter((s) => s.text);

    if (slots.length === 0) return null;
    return (
      <div
        data-codice-region="page-header"
        style={{
          display: 'flex',
          justifyContent:
            p.pageHeaderLayout === 'single'
              ? p.pageHeaderAlign === 'left'
                ? 'flex-start'
                : p.pageHeaderAlign === 'right'
                  ? 'flex-end'
                  : 'center'
              : 'space-between',
          gap: 12,
          color: preset.colors.mutedText,
          fontSize: 10,
          borderBottom: `0.5px solid ${preset.colors.borders}`,
          paddingBottom: 4,
        }}
      >
        {slots.map((s, i) => (
          <span key={i} style={{ textAlign: s.align }}>
            {s.text}
          </span>
        ))}
      </div>
    );
  }

  function renderFooterRow(page: PreviewPage, pageNo: number) {
    if (!preset.page.pageFooterShow) return null;
    const p = preset.page;
    const slots = (() => {
      if (p.pageFooterLayout === 'single') return [p.pageFooterCenter];
      if (p.pageFooterLayout === 'dual') return [p.pageFooterLeft, p.pageFooterRight];
      return [p.pageFooterLeft, p.pageFooterCenter, p.pageFooterRight];
    })();

    const values = slots.map((s) => footerValue(s, page, pageNo));
    if (values.every((v) => v === '')) return null;

    const single = p.pageFooterLayout === 'single';
    return (
      <div
        data-codice-region="page-footer"
        style={{
          display: 'flex',
          justifyContent: single
            ? p.pageFooterAlign === 'left'
              ? 'flex-start'
              : p.pageFooterAlign === 'right'
                ? 'flex-end'
                : 'center'
            : 'space-between',
          gap: 12,
          color: preset.colors.mutedText,
          fontSize: 10,
          borderTop: `0.5px solid ${preset.colors.borders}`,
          paddingTop: 4,
        }}
      >
        {values.map((v, i) => (
          <span key={i}>{v}</span>
        ))}
      </div>
    );
  }

  /* ---------------- Element rendering ---------------- */

  function renderElement(el: PreviewElement, key: string): React.ReactNode {
    switch (el.type) {
      case 'titlePage':
        return renderTitlePage(key);
      case 'toc':
        return renderToc(key);
      case 'projectHeader':
        return renderProjectHeader(el, key);
      case 'structure':
        return renderStructure(el, key);
      case 'heading':
        return renderHeading(el, key);
      case 'paragraph':
        return (
          <p
            key={key}
            data-codice-region="body"
            style={{
              // Primary text is the CANONICAL body color (spec §5).
              color: preset.colors.primaryText,
              fontSize: preset.typography.bodyFontSizePt * PT_TO_PX,
              fontWeight: WEIGHTS[preset.typography.bodyWeight],
              lineHeight: preset.typography.lineSpacing,
              margin: `0 0 ${preset.typography.paragraphSpacingPt}pt 0`,
              fontFamily: fontStack(preset.typography.bodyFont),
            }}
          >
            {el.text}
          </p>
        );
      case 'fileHeader':
        return renderFileHeader(el, key);
      case 'fileDetail':
        return renderFileDetail(el, key);
      case 'image':
        return renderImage(el, key);
      case 'code':
        return renderCodeChunk(el, key);
      case 'spacer':
        return <div key={key} style={{ height: el.height }} />;
      case 'divider':
        return (
          <div
            key={key}
            data-codice-region="divider"
            style={{
              height: Math.max(1, el.heightPx),
              background: el.fillColor ?? preset.colors.mutedText,
              borderRadius: Math.min(2, Math.max(1, el.heightPx / 2)),
              margin: `${preset.typography.paragraphSpacingPt}px 0`,
            }}
          />
        );
      case 'panel':
        return renderPanel(el, key);
      case 'columns':
        return renderColumns(el, key);
      default:
        return null;
    }
  }

  /** §6 — visual container: fill/border/radius/padding around child blocks. */
  function renderPanel(el: Extract<PreviewElement, { type: 'panel' }>, key: string) {
    const hasChildren = el.children.length > 0;
    return (
      <div
        key={key}
        data-codice-region="panel"
        style={{
          background: el.fillColor ?? undefined,
          border:
            el.borderWidthPt && el.borderColor
              ? `${el.borderWidthPt}px solid ${el.borderColor}`
              : undefined,
          borderRadius: el.radiusPt ? el.radiusPt * PT_TO_PX : undefined,
          padding: el.paddingPt ? el.paddingPt * PT_TO_PX : undefined,
          height:
            !hasChildren && el.heightPt ? Math.max(1, el.heightPt * PT_TO_PX) : undefined,
          margin: `${preset.typography.paragraphSpacingPt}px 0`,
        }}
      >
        {el.children.map((child, i) => renderElement(child, `${key}-${i}`))}
      </div>
    );
  }

  /** §6 — side-by-side regions; each column stacks its own children. */
  function renderColumns(el: Extract<PreviewElement, { type: 'columns' }>, key: string) {
    return (
      <div
        key={key}
        data-codice-region="columns"
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
          margin: `${preset.typography.paragraphSpacingPt}px 0`,
        }}
      >
        {el.columns.map((col, i) => (
          <div key={i} style={{ flex: 1, minWidth: 0 }}>
            {col.map((child, j) => renderElement(child, `${key}-${i}-${j}`))}
          </div>
        ))}
      </div>
    );
  }

  /** Title page — ONE coherent group (§9): group-wide horizontal alignment. */
  function renderTitlePage(key: string) {
    const tp = preset.titlePage;
    const md: DocumentMetadata = state.metadata;
    const titleH = preset.headings.title;
    const descriptionMargin =
      tp.alignment === 'center' ? '24px auto 0' : tp.alignment === 'right' ? '24px 0 0 auto' : '24px 0 0';
    return (
      <div
        key={key}
        data-outline-id="outline-title"
        data-codice-region="title-page"
        style={{
          textAlign: tp.alignment,
          // verticalOffsetPt nudges the group down from the top (top mode).
          // In center/bottom modes the group is positioned by the page's
          // justify-content so Center/Center truly centers it (spec §9/§29);
          // bottom mode uses the offset as an upward nudge from the bottom.
          marginTop: tp.verticalAlignment === 'top' ? tp.verticalOffsetPt * PT_TO_PX : undefined,
          transform:
            tp.verticalAlignment === 'bottom'
              ? `translateY(-${tp.verticalOffsetPt * PT_TO_PX}px)`
              : undefined,
        }}
      >
        {tp.showTitle && md.title && (
          <div
            data-codice-region="heading-title"
            style={{
              fontFamily: fontStack(titleH.font),
              fontSize: titleH.sizePt * PT_TO_PX,
              fontWeight: WEIGHTS[titleH.weight],
              fontStyle: titleH.italic ? 'italic' : 'normal',
              color: titleH.color,
              lineHeight: titleH.lineHeight,
              textIndent: titleH.indentPt,
            }}
          >
            {md.title}
          </div>
        )}
        {tp.showSubtitle && md.subtitle && (
          <div
            style={{
              fontFamily: fontStack(preset.typography.bodyFont),
              fontSize: preset.typography.bodyFontSizePt * PT_TO_PX + 2,
              color: preset.colors.secondaryText,
              marginTop: 10,
            }}
          >
            {md.subtitle}
          </div>
        )}
        {tp.showAuthor && md.author && (
          <div style={{ fontSize: preset.typography.bodyFontSizePt * PT_TO_PX + 2, color: preset.colors.secondaryText, marginTop: 18 }}>
            {md.author}
          </div>
        )}
        {tp.showCourse && md.course && (
          <div style={{ fontSize: 12, color: preset.colors.mutedText, marginTop: 8 }}>
            {md.course}
          </div>
        )}
        {tp.showUniversity && md.university && (
          <div style={{ fontSize: 12, color: preset.colors.mutedText, marginTop: 4 }}>
            {md.university}
          </div>
        )}
        {tp.showDate && (
          <div style={{ fontSize: 11, color: preset.colors.mutedText, marginTop: 28 }}>
            {md.date || `Generated: ${nowDate.toLocaleString()}`}
          </div>
        )}
        {tp.showVersion && md.version && (
          <div style={{ marginTop: 6 }}>
            <span
              style={{
                display: 'inline-block',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.4,
                color: preset.colors.accent,
                background: preset.colors.surface,
                border: `0.5px solid ${preset.colors.borders}`,
                borderRadius: 999,
                padding: '2px 10px',
              }}
            >
              Version: {md.version}
            </span>
          </div>
        )}
        {tp.showDescription && md.description && (
          <div
            style={{
              fontSize: 12,
              color: preset.colors.secondaryText,
              maxWidth: 400,
              margin: descriptionMargin,
            }}
          >
            {md.description}
          </div>
        )}
      </div>
    );
  }

  function renderToc(key: string) {
    const h1 = preset.headings.h1;
    // §4 — the TOC content group follows its own horizontal alignment
    // (vertical alignment is applied by the page container).
    const tocAlign = preset.toc.horizontalAlignment;
    return (
      <div
        key={key}
        data-outline-id="outline-toc"
        data-codice-region="toc"
        style={{ marginBottom: preset.layout.sectionSpacingPt, textAlign: tocAlign }}
      >
        <div
          style={{
            fontFamily: fontStack(h1.font),
            fontSize: h1.sizePt * PT_TO_PX,
            fontWeight: WEIGHTS[h1.weight],
            fontStyle: h1.italic ? 'italic' : 'normal',
            color: h1.color,
            marginBottom: 12,
          }}
        >
          Table of Contents
        </div>
        {visiblePaginationProjects.map((g, gi) => (
          <div key={g.outlineProjectId ?? gi}>
            <div
              style={{
                fontFamily: fontStack(h1.font),
                fontWeight: WEIGHTS[h1.weight],
                fontSize: 13,
                marginTop: 8,
                // Project TOC lines are headings-in-context (§10).
                color: preset.colors.headings,
              }}
            >
              <span style={{ color: preset.colors.accent }}>{gi + 1}. </span>
              {g.label}
            </div>
            {g.files.map((f, fi) => (
              <div
                key={f.outlineFileId ?? fi}
                style={{
                  fontSize: 11,
                  color: preset.colors.secondaryText,
                  marginLeft: 16,
                  marginTop: 2,
                }}
              >
                {gi + 1}.{fi + 1}  {f.path}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  function renderProjectHeader(el: Extract<PreviewElement, { type: 'projectHeader' }>, key: string) {
    const g = visiblePaginationProjects[el.projectIdx];
    if (!g) return null;
    const ph = preset.projectHeaders;
    const totalSize = g.files.reduce((acc, f) => acc + f.size, 0);
    return (
      <div key={key} data-outline-id={el.outlineId} data-codice-region="project-header">
        {ph.showTitle && (
          <div
            style={{
              fontFamily: fontStack(ph.font),
              fontSize: ph.sizePt * PT_TO_PX,
              fontWeight: WEIGHTS[ph.weight],
              color: ph.color,
              textTransform: ph.uppercase ? 'uppercase' : 'none',
              textAlign: ph.alignment,
              marginTop: ph.spaceBeforePt,
              marginBottom: 4,
            }}
          >
            <span style={{ color: preset.colors.accent }}>{el.projectIdx + 1}. </span>
            {g.label}
          </div>
        )}
        {ph.showPath && (
          <div style={{ fontSize: 10, color: preset.colors.mutedText, marginBottom: 4 }}>
            Path: {g.path}
          </div>
        )}
        {ph.showMetadata && (
          <div style={{ fontSize: 10, color: preset.colors.mutedText, marginBottom: ph.spaceAfterPt }}>
            Files: {g.files.length} · Total size: {formatBytes(totalSize)}
          </div>
        )}
      </div>
    );
  }

  function buildStructureLines(paths: string[], dirsFirst: boolean): string[] {
    type Node = { name: string; children: Map<string, Node>; isFile: boolean };
    const root: Node = { name: '', children: new Map(), isFile: false };
    for (const p of paths) {
      const parts = p.split('/');
      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const isLast = i === parts.length - 1;
        if (!node.children.has(parts[i])) {
          node.children.set(parts[i], { name: parts[i], children: new Map(), isFile: isLast });
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
    return out;
  }

  function renderStructure(el: Extract<PreviewElement, { type: 'structure' }>, key: string) {
    const g = visiblePaginationProjects[el.projectIdx];
    if (!g) return null;
    const ps = preset.projectStructure;
    const h2 = preset.headings.h2;
    const lines = buildStructureLines(g.structure, ps.dirsFirst);
    return (
      <div key={key} data-outline-id={el.outlineId} data-codice-region="structure" style={{ marginBottom: preset.layout.sectionSpacingPt }}>
        <div
          style={{
            fontFamily: fontStack(h2.font),
            fontSize: h2.sizePt * PT_TO_PX,
            fontWeight: WEIGHTS[h2.weight],
            fontStyle: h2.italic ? 'italic' : 'normal',
            color: h2.color,
            marginBottom: 8,
            lineHeight: h2.lineHeight,
            textIndent: h2.indentPt,
          }}
        >
          <span style={{ color: preset.colors.accent }}>
            {preset.misc.numberHeadings && h2.numbered
              ? `${el.projectIdx + 1}.${g.files.length + 1} `
              : ''}
          </span>
          Project Structure
        </div>
        <div
          style={{
            fontFamily: glyphCapableStack(fontStack(ps.font)),
            fontSize: ps.fontSizePt * PT_TO_PX,
            color: ps.color,
            whiteSpace: 'pre',
            lineHeight: ps.lineHeight,
          }}
        >
          {lines.join('\n')}
        </div>
      </div>
    );
  }

  function renderHeading(el: Extract<PreviewElement, { type: 'heading' }>, key: string) {
    const h = preset.headings[el.level];
    const regionId =
      el.level === 'h1' ? 'heading-h1' : el.level === 'h2' ? 'heading-h2' : el.level === 'h3' ? 'heading-h3' : 'heading-h4';
    return (
      <div
        key={key}
        data-outline-id={el.outlineId}
        data-codice-region={regionId}
        style={{
          fontFamily: fontStack(h.font),
          fontSize: h.sizePt * PT_TO_PX,
          fontWeight: WEIGHTS[h.weight],
          fontStyle: h.italic ? 'italic' : 'normal',
          color: h.color,
          textAlign: h.alignment,
          marginTop: h.spaceBeforePt,
          marginBottom: h.spaceAfterPt,
          lineHeight: h.lineHeight,
          textIndent: h.indentPt,
        }}
      >
        <span style={{ color: preset.colors.accent }}>{el.numberPrefix}</span>
        {el.text}
      </div>
    );
  }

  function renderFileHeader(el: Extract<PreviewElement, { type: 'fileHeader' }>, key: string) {
    const g = visiblePaginationProjects[el.projectIdx];
    const file = g?.files[el.fileIdx];
    if (!g || !file) return null;
    const fh = preset.fileHeaders;
    const hl = file.outlineFileId ? getHlForFile(file.outlineFileId) : null;
    const metaBits: string[] = [];
    if (fh.showLanguageLabel) metaBits.push(languageLabel(file.language));
    if (fh.showFileSize) metaBits.push(formatBytes(file.size));
    if (fh.showLineCount && hl) metaBits.push(`${hl.lines.length} lines`);
    if (metaBits.length === 0 && !fh.showFileName && !fh.showRelativePath) return null;
    return (
      <div
        key={key}
        data-codice-region="file-header"
        data-outline-id={el.outlineId}
        style={{
          fontFamily: fontStack(fh.font),
          fontSize: fh.fontSizePt * PT_TO_PX,
          color: fh.textColor,
          background: fh.background === 'transparent' ? undefined : fh.background,
          borderBottom: fh.borderBottom ? `1px solid ${fh.borderColor}` : undefined,
          paddingBottom: 4,
          marginBottom: preset.fileHeaders.spacingAfterPt,
        }}
      >
        {fh.showFileName && (
          <div style={{ fontWeight: fh.bold ? 'bold' : 'normal' }}>{file.name}</div>
        )}
        {fh.showRelativePath && (
          <div style={{ fontSize: fh.fontSizePt * PT_TO_PX - 1, opacity: 0.85, fontWeight: fh.bold ? 'bold' : 'normal' }}>
            {file.path}
          </div>
        )}
        {metaBits.length > 0 && (
          <div style={{ fontSize: fh.fontSizePt * PT_TO_PX - 1, color: preset.colors.mutedText, marginTop: 2 }}>
            {metaBits.join('  ·  ')}
          </div>
        )}
      </div>
    );
  }

  /** §6 — a labeled per-file detail (Description / Summary / Note). */
  function renderFileDetail(
    el: Extract<PreviewElement, { type: 'fileDetail' }>,
    key: string,
  ) {
    return (
      <div
        key={key}
        data-codice-region="file-detail"
        style={{ marginBottom: preset.typography.paragraphSpacingPt }}
      >
        <div
          style={{
            fontSize: Math.max(9, preset.typography.bodyFontSizePt * PT_TO_PX - 2),
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            color: preset.colors.mutedText,
            marginBottom: 3,
          }}
        >
          {el.label}
        </div>
        <p
          style={{
            color: preset.colors.primaryText,
            fontSize: preset.typography.bodyFontSizePt * PT_TO_PX,
            fontWeight: WEIGHTS[preset.typography.bodyWeight],
            lineHeight: preset.typography.lineSpacing,
            margin: 0,
            fontFamily: fontStack(preset.typography.bodyFont),
            whiteSpace: 'pre-wrap',
          }}
        >
          {el.text}
        </p>
      </div>
    );
  }

  /** §10/§12 — an attached image, aspect-fit inside the content column. */
  function renderImage(
    el: Extract<PreviewElement, { type: 'image' }>,
    key: string,
  ) {
    const g = el.projectIdx !== undefined ? visiblePaginationProjects[el.projectIdx] : undefined;
    const file = el.fileIdx !== undefined ? g?.files[el.fileIdx] : undefined;
    const img = el.image ?? file?.images?.[el.imageIdx ?? 0];
    if (!img) return null;
    return (
      <figure
        key={key}
        data-codice-region="image"
        style={{
          margin: `${preset.typography.paragraphSpacingPt}pt 0`,
          textAlign: 'center',
        }}
      >
        <img
          src={img.dataUrl}
          alt={img.caption || img.name}
          style={{
            maxWidth: '62%',
            maxHeight: 420,
            height: 'auto',
            border: `0.5px solid ${preset.colors.borders}`,
            borderRadius: 2,
          }}
        />
        {img.caption && (
          <figcaption
            style={{
              fontSize: Math.max(9, preset.typography.bodyFontSizePt * PT_TO_PX - 3),
              color: preset.colors.secondaryText,
              marginTop: 4,
              fontStyle: 'italic',
            }}
          >
            {img.caption}
          </figcaption>
        )}
      </figure>
    );
  }

  /** One page-chunk of a code block (fromLine..toLine, startLineNumber). */
  function renderCodeChunk(el: Extract<PreviewElement, { type: 'code' }>, key: string) {
    const g = visiblePaginationProjects[el.projectIdx];
    const file = g?.files[el.fileIdx];
    if (!g || !file) return null;
    const c = preset.code;
    const hl = file.outlineFileId ? getHlForFile(file.outlineFileId) : null;
    const allLines = hl?.lines ?? [];
    const lines = allLines.slice(el.fromLine, el.toLine);
    const lineNumberWidth = c.lineNumberWidthChars > 0
      ? c.lineNumberWidthChars
      : allLines.length > 0
        ? String(allLines.length).length
        : 2;
    return (
      <div
        key={key}
        data-codice-region="code"
        data-outline-id={el.outlineId}
        style={{
          background: effectiveBg,
          fontFamily: glyphCapableStack(fontStack(c.font)),
          fontSize: c.fontSizePt * PT_TO_PX,
          fontWeight: WEIGHTS[c.fontWeight],
          lineHeight: c.lineHeight,
          padding: c.paddingPt,
          borderRadius: c.borderRadiusPt,
          border: codeBorderCss,
          overflow: 'hidden',
          marginTop: preset.code.blockSpacingBeforePt,
          marginBottom: preset.code.blockSpacingAfterPt,
        }}
      >
        {lines.length === 0 && !hl ? (
          <div style={{ opacity: 0.5, color: fallbackFg, minHeight: 40 }}>Loading…</div>
        ) : (
          lines.map((line) => (
            <div key={`${key}-${line.lineNumber}`} style={{ display: 'flex' }}>
              {c.showLineNumbers && (
                <span
                  style={{
                    color: c.lineNumberColor,
                    background: c.lineNumberBackground ?? undefined,
                    width: `${lineNumberWidth + 1}ch`,
                    marginRight: 8,
                    userSelect: 'none',
                    textAlign: 'right',
                    flexShrink: 0,
                  }}
                >
                  {el.startLineNumber + line.lineNumber - (el.fromLine + 1) + 1}
                </span>
              )}
              <span
                style={{
                  whiteSpace: c.wrapLongLines ? 'pre-wrap' : 'pre',
                  wordBreak: c.wrapLongLines ? 'break-word' : 'normal',
                  overflow: c.wrapLongLines ? 'hidden' : 'auto',
                  color: fallbackFg,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {line.tokens.length === 0
                  ? '\u00A0'
                  : line.tokens.map((tok, i) => (
                      <span
                        key={i}
                        style={{
                          color: tok.color ?? undefined,
                          fontWeight: tok.bold ? 'bold' : undefined,
                          fontStyle: tok.italic ? 'italic' : undefined,
                          textDecoration: tok.underline ? 'underline' : undefined,
                        }}
                      >
                        {line.text.slice(tok.start, tok.start + tok.length)}
                      </span>
                    ))}
              </span>
            </div>
          ))
        )}
      </div>
    );
  }

  /* ---------------- Page rendering ---------------- */

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {separateMode && (
        <div
          className="codice-print-hidden flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-app bg-surface px-2 py-1.5"
          role="tablist"
          aria-label="Projects in this export — one document per project"
          data-codice-region="project-tabs"
        >
          {paginationProjects.map((g, i) => {
            const id = projectTabId(g);
            const selected = (activeGroup ? projectTabId(activeGroup) : projectTabId(paginationProjects[0])) === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                title={`Preview ${g.label} — ${g.files.length} file${g.files.length === 1 ? '' : 's'}`}
                onClick={() => setActiveTabId(id)}
                className={`flex max-w-[180px] flex-shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-2.5 py-1 text-xs transition-colors ${
                  selected
                    ? 'border-[var(--color-accent)] bg-app text-primary font-medium'
                    : 'border-transparent text-secondary hover-surface'
                }`}
              >
                <span className="truncate">{g.label}</span>
                <span className="rounded-full border border-app px-1 text-[9px] tabular-nums text-muted">
                  {g.files.length}
                </span>
              </button>
            );
          })}
          <span className="ml-2 flex-shrink-0 text-[10px] text-muted">
            Separate output — one document per project
          </span>
        </div>
      )}
      {/* Zoom toolbar (§5) — same control language as the template-settings
          preview, but the zoom STATE is independent (§16). Hidden from print. */}
      <div className="codice-print-hidden flex flex-shrink-0 items-center gap-2 border-b border-app bg-surface/70 px-3 py-1.5 backdrop-blur">
        <div className="flex items-center gap-0.5">
          <ToolbarButton label="Zoom out" onClick={() => stepZoom(-1)}>
            <Minus size={13} />
          </ToolbarButton>
          <button
            type="button"
            onClick={() => setZoom('fit')}
            className={`min-w-[44px] rounded px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors ${
              zoom === 'fit'
                ? 'bg-[var(--color-accent)] text-[var(--color-accent-text)]'
                : 'text-secondary hover-surface'
            }`}
            title="Fit to width"
          >
            {zoom === 'fit' ? 'Fit' : `${zoom}%`}
          </button>
          <ToolbarButton label="Zoom in" onClick={() => stepZoom(1)}>
            <Plus size={13} />
          </ToolbarButton>
        </div>
        <div className="h-4 w-px bg-[var(--color-border)]" aria-hidden />
        <span className="text-[10px] tabular-nums text-muted">
          {pages.length} page{pages.length === 1 ? '' : 's'}
        </span>
        <span className="ml-auto text-[10px] tabular-nums text-muted">
          {effectiveW}×{effectiveH}px · {preset.page.landscape ? 'landscape' : 'portrait'}
        </span>
      </div>
      {/* §3 — right-side control anchor region. Everything that floats on
          the right (pills, Outline panel, Statistics) is anchored to THIS
          wrapper, which by construction starts BELOW the project tabs and
          the zoom toolbar. The pills therefore can never overlap or slide
          under the toolbar, no matter whether tabs are visible, how wide
          the preview is, which zoom level is active, or how many projects
          exist — a layout-system fix, not a magic offset. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={containerRef}
        className="codice-print-area min-h-0 flex-1 overflow-auto bg-app p-6"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(128,128,128,0.07) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
        onScroll={handlePreviewScroll}
      >
        {allSelected.length === 0 ? (
          state.projects.length === 0 ? (
            <PreviewWelcome />
          ) : (
            <PreviewNoSelection projectCount={state.projects.length} />
          )
        ) : (
        <div className="codice-preview-frame mx-auto flex w-fit min-w-full flex-col items-center gap-6">
        {pages.map((page, idx) => {
          // §4/§9/§10 — shared model: title pages follow the title alignment,
          // TOC pages follow the TOC alignment, content/project pages always
          // start at the top.
          const justify = pageContentAlignment(
            page.kind,
            preset.titlePage.verticalAlignment,
            preset.toc.verticalAlignment,
          );
          return (
            // §2 — the slot wrapper owns the SCALED layout box so the visual
            // page exactly fills it: centering happens on the wrapper (never
            // on the oversized unscaled page box, which previously overflowed
            // the frame symmetrically and pushed the page visually left).
            <div key={idx} className="codice-page-slot" style={{ width: effectiveW * scaleFactor }}>
              <div
                className="codice-page-scale"
                style={{
                  // Explicit UNSCALED page width: the transform then maps
                  // this box to exactly the slot's scaled width. Without it
                  // the wrapper stretches to the slot width and gets scaled
                  // twice (overflow at zoom > 100%).
                  width: effectiveW,
                  transform: `scale(${scaleFactor})`,
                  transformOrigin: 'top left',
                  marginBottom: (effectiveH - effectiveH * scaleFactor) * -1,
                }}
              >
              <div
                className="codice-preview-surface shadow-2xl"
                data-page={idx + 1}
                style={{
                  width: effectiveW,
                  minHeight: effectiveH,
                background: preset.colors.background,
                color: preset.colors.primaryText,
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: justify,
                paddingTop: marginTop,
                paddingBottom: marginBottom,
                paddingLeft: marginLeft,
                paddingRight: marginRight,
                fontFamily: fontStack(preset.typography.bodyFont),
                fontSize: preset.typography.bodyFontSizePt,
                fontWeight: WEIGHTS[preset.typography.bodyWeight],
              }}
            >
              {/* Header — at the very top of the page */}
              {preset.page.pageHeaderShow && (
                <div style={{ position: 'absolute', top: Math.max(8, marginTop - headerReserve / 2 - 10), left: marginLeft, right: marginRight }}>
                  {renderHeaderRow()}
                </div>
              )}

              {/* Content */}
              <div style={{ flex: '0 0 auto' }}>
                {page.elements.map((el, i) => renderElement(el, `${idx}-${i}`))}
              </div>

              {/* Footer — at the very bottom */}
              {preset.page.pageFooterShow && (
                <div style={{ position: 'absolute', bottom: Math.max(8, marginBottom - footerReserve / 2 - 10), left: marginLeft, right: marginRight }}>
                  {renderFooterRow(page, idx + 1)}
                </div>
              )}
            </div>
              </div>
            </div>
          );
        })}

        {allSelected.length > PREVIEW_LIMIT && (
          <div
            className="codice-print-hidden"
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
        </div>
        )}
      </div>

      {/* Floating outline + statistics pills (hidden from print output).
          Anchored INSIDE the §3 control region (which starts below the
          tabs + toolbar rows) — top-3 keeps them just under the toolbar
          edge without ever covering it. §13 — the Outline pill is visible
          whenever the preview has content pages; it must never disappear
          just because the current outline has no entries (e.g. layouts
          that render code-only blocks). */}
      <div className="absolute right-4 top-3 z-10 flex flex-col items-end gap-1 codice-print-hidden">
        {!outlineOpen && pages.length > 0 && (
          <button
            type="button"
            className="codice-outline-toggle"
            onClick={() => setOutlineOpen(true)}
            title="Document outline (Ctrl+O)"
            aria-label="Open document outline"
          >
            <ListTree size={14} />
            <span className="hidden sm:inline">Outline</span>
            <span className="codice-outline-count">{outline.length}</span>
          </button>
        )}
        {!statsOpen && (
          <button
            type="button"
            className="codice-outline-toggle"
            onClick={() => setStatsOpen(true)}
            title="Document statistics"
            aria-label="Open document statistics"
            data-tour="stats"
          >
            <BarChart size={14} />
            <span className="hidden sm:inline">Statistics</span>
          </button>
        )}
      </div>
      {outlineOpen && (
        <OutlinePanel
          entries={outline}
          activeId={activeOutlineId}
          onNavigate={navigateToOutline}
          onClose={() => setOutlineOpen(false)}
        />
      )}
      {statsOpen && (
        <div className="absolute inset-0 z-10 flex items-start justify-end p-4 codice-print-hidden">
          <div
            className="codice-fade-in w-80 max-h-full overflow-y-auto rounded-lg border border-app bg-surface-elevated shadow-2xl"
            role="dialog"
            aria-label="Document statistics"
          >
            <div className="flex items-center justify-between border-b border-app px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-secondary">
                <BarChart size={13} />
                Document statistics
              </div>
              <button
                type="button"
                className="codice-outline-toggle !px-1.5"
                onClick={() => setStatsOpen(false)}
                aria-label="Close document statistics"
                title="Close"
              >
                ✕
              </button>
            </div>
            <StatsPanel embedded />
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
