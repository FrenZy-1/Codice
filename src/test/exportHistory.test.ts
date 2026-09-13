/**
 * Tests for export history helpers (src/lib/exportHistory.ts).
 *
 * jsdom lacks URL.createObjectURL/revokeObjectURL, so they are stubbed with
 * deterministic fakes — the assertions then verify cap behavior, URL
 * lifecycle and the formatting helpers used by the panel.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createHistoryEntry,
  pushHistory,
  clearHistory,
  formatRelativeTime,
  formatSize,
  EXPORT_HISTORY_CAP,
  type ExportHistoryEntry,
} from '../lib/exportHistory';

let createdUrls = 0;
let revokedUrls: string[] = [];

beforeEach(() => {
  createdUrls = 0;
  revokedUrls = [];
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = () => {
    createdUrls += 1;
    return `blob:fake-${createdUrls}`;
  };
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = (
    url: string,
  ) => {
    revokedUrls.push(url);
  };
});

function makeEntry(
  overrides: Partial<ExportHistoryEntry> & { now?: number } = {},
): ExportHistoryEntry {
  const blob = new Blob(['x'.repeat(10)], { type: 'text/plain' });
  const { now, ...rest } = overrides;
  return createHistoryEntry({
    blob,
    filename: 'doc.docx',
    format: 'docx',
    elapsedMs: 42,
    now,
    ...rest,
  });
}

describe('createHistoryEntry', () => {
  it('creates an entry with a fresh object URL and metadata', () => {
    const entry = makeEntry({ detail: '3 files', now: 1_000 });
    expect(entry.url).toMatch(/^blob:fake-/);
    expect(entry.filename).toBe('doc.docx');
    expect(entry.format).toBe('docx');
    expect(entry.sizeBytes).toBe(10);
    expect(entry.elapsedMs).toBe(42);
    expect(entry.detail).toBe('3 files');
    expect(entry.at).toBe(1_000);
    expect(entry.id).toMatch(/^exh-/);
  });

  it('assigns unique ids to successive entries', () => {
    const a = makeEntry();
    const b = makeEntry();
    expect(a.id).not.toBe(b.id);
  });
});

describe('pushHistory', () => {
  it('prepends the newest entry', () => {
    const first = makeEntry({ filename: 'first.docx' });
    const second = makeEntry({ filename: 'second.pdf', format: 'pdf' });
    const list = pushHistory([], first);
    expect(list.map((e) => e.filename)).toEqual(['first.docx']);
    const list2 = pushHistory(list, second);
    expect(list2.map((e) => e.filename)).toEqual([
      'second.pdf',
      'first.docx',
    ]);
  });

  it('caps the list and revokes the URLs of dropped entries', () => {
    let list: ExportHistoryEntry[] = [];
    for (let i = 0; i < EXPORT_HISTORY_CAP + 2; i++) {
      list = pushHistory(list, makeEntry({ filename: `doc-${i}.docx` }));
    }
    expect(list).toHaveLength(EXPORT_HISTORY_CAP);
    expect(list[0].filename).toBe(`doc-${EXPORT_HISTORY_CAP + 1}.docx`);
    // The 2 oldest entries were evicted and their URLs revoked.
    expect(revokedUrls).toHaveLength(2);
    expect(revokedUrls[0]).toMatch(/^blob:fake-/);
  });

  it('honors a custom cap', () => {
    let list: ExportHistoryEntry[] = [];
    for (let i = 0; i < 4; i++) {
      list = pushHistory(list, makeEntry(), 2);
    }
    expect(list).toHaveLength(2);
    expect(revokedUrls).toHaveLength(2);
  });
});

describe('clearHistory', () => {
  it('revokes every URL and returns an empty list', () => {
    const list = [makeEntry(), makeEntry(), makeEntry()];
    const before = list.map((e) => e.url);
    const result = clearHistory(list);
    expect(result).toEqual([]);
    expect(revokedUrls.sort()).toEqual([...before].sort());
  });
});

describe('formatRelativeTime', () => {
  const now = 1_000_000_000;
  it('formats the branches used by the panel', () => {
    expect(formatRelativeTime(now - 2_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 30_000, now)).toBe('30s ago');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });

  it('clamps future timestamps to "just now"', () => {
    expect(formatRelativeTime(now + 60_000, now)).toBe('just now');
  });
});

describe('formatSize', () => {
  it('formats bytes, kilobytes and megabytes', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
