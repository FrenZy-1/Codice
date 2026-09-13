'use client';

/**
 * Document statistics — aggregate view of everything that is currently
 * selected across all projects.
 *
 * Presented as a PILL beside the Outline pill in the preview pane (spec §16);
 * the pill opens this panel as a floating card. With `embedded` the panel
 * body renders directly (used inside the card). All numbers come from
 * `computeDocumentStats` (pure, synchronous).
 */

import { useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import {
  computeDocumentStats,
  formatStatsMarkdown,
  languageHueColor,
} from '@/lib/documentStats';
import { formatBytes } from '@/lib/fileDiscovery';
import { useToast } from '@/components/common/Toast';
import { BarChart, AlertTriangle, Copy, Check } from '@/components/common/Icons';

export function StatsPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const { state, getSelectedFiles } = useAppState();
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  // Build the selections map on every render — cheap for typical sizes.
  const selections: Record<string, Set<string>> = {};
  for (const project of state.projects) {
    selections[project.id] = getSelectedFiles(project.id);
  }
  const stats = computeDocumentStats(state.projects, selections);

  const hasSelection = stats.selectedFiles > 0;

  const copyStats = async () => {
    const md = formatStatsMarkdown(stats);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(md);
      } else {
        // Fallback for non-secure contexts: transient textarea + execCommand.
        const ta = document.createElement('textarea');
        ta.value = md;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
    } catch {
      toast.push({
        kind: 'error',
        title: 'Copy failed',
        message: 'The clipboard is unavailable in this browser context.',
      });
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
    toast.push({
      kind: 'success',
      title: 'Statistics copied',
      message: `${stats.selectedFiles} files summarized as Markdown`,
    });
  };

  const body = (
    <div className={embedded ? 'p-3' : undefined}>
      {!hasSelection ? (
        <div className="text-xs text-muted">
          Select files to see live document statistics.
        </div>
      ) : (
        <>
          {/* Kind counts */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <StatChip label="Source" value={stats.sourceFiles} />
            <StatChip label="Config" value={stats.configFiles} />
            <StatChip label="Binary" value={stats.binaryFiles} />
          </div>

          {/* Size summary */}
          <dl className="mt-3 space-y-1 text-xs">
            <Row label="Total size" value={formatBytes(stats.totalBytes)} />
            <Row
              label="Average file"
              value={formatBytes(stats.averageBytes)}
            />
            {stats.largest && (
              <Row
                label="Largest file"
                value={`${stats.largest.name} (${stats.largest.bytes})`}
                truncate
              />
            )}
            <Row label="Languages" value={String(stats.languageCount)} />
            {stats.duplicateNames > 0 && (
              <Row
                label="Duplicate names"
                value={String(stats.duplicateNames)}
                icon={
                  <span className="text-warning" title="File names appearing more than once — disambiguated with path context">
                    <AlertTriangle size={11} />
                  </span>
                }
              />
            )}
          </dl>

          {/* Language breakdown bars */}
          {stats.languages.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="label">By language</div>
              {stats.languages.slice(0, 8).map((lang) => (
                <div key={lang.id} className="space-y-0.5">
                  <div className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="truncate text-secondary">
                      {lang.label}
                      <span className="text-muted"> · {lang.files}f</span>
                    </span>
                    <span className="flex-shrink-0 tabular-nums text-muted">
                      {lang.pct}%
                    </span>
                  </div>
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full"
                    style={{ background: 'var(--color-border-muted)' }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, lang.pct)}%`,
                        background: languageHueColor(lang.id),
                      }}
                    />
                  </div>
                </div>
              ))}
              {stats.languages.length > 8 && (
                <div className="pt-0.5 text-[10px] text-muted">
                  + {stats.languages.length - 8} more languages
                </div>
              )}
            </div>
          )}

          {/* Copy action — available whenever there is a selection */}
          <div className="mt-3 border-t border-app pt-2">
            <button
              type="button"
              className="codice-stats-copy-wide"
              data-copied={copied}
              aria-label="Copy statistics as Markdown"
              title="Copy as Markdown"
              onClick={() => void copyStats()}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              <span>{copied ? 'Copied' : 'Copy as Markdown'}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );

  if (embedded) return body;

  // Non-embedded fallback (kept for potential reuse outside the preview card).
  return (
    <div className="border-t border-app px-3 py-2">
      <div className="flex w-full items-center gap-1">
        <div className="flex flex-1 items-center gap-1.5 rounded px-1 py-1 text-xs font-medium text-secondary">
          <BarChart size={13} />
          <span>Document statistics</span>
          <span className="badge ml-auto">{stats.selectedFiles} files</span>
        </div>
      </div>
      <div className="codice-fade-in mt-2 max-h-72 overflow-y-auto rounded-md border border-app bg-surface-elevated p-3">
        {body}
      </div>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-app bg-app px-1 py-1.5">
      <div className="text-sm font-semibold tabular-nums text-primary">
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-muted">
        {label}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  truncate,
  icon,
}: {
  label: string;
  value: string;
  truncate?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="flex-shrink-0 text-muted">{label}</dt>
      <dd
        className={`flex items-center gap-1 text-secondary ${truncate ? 'min-w-0 truncate' : 'text-right'}`}
      >
        {icon}
        <span className="truncate">{value}</span>
      </dd>
    </div>
  );
}
