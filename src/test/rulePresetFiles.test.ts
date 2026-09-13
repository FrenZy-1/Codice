/**
 * Tests for rule-preset import/export (serialize → parse round-trip,
 * corruption handling, and merge dedupe semantics).
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  mergeRulePresets,
  parseRulePresets,
  persistRulePresets,
  RULE_PRESETS_CAP,
  RULE_PRESETS_FILE_KIND,
  RULE_PRESETS_FILE_VERSION,
  serializeRulePresets,
  type RulePreset,
} from '../lib/rulePresets';

function makePreset(overrides: Partial<RulePreset> = {}): RulePreset {
  return {
    id: 'rp-test-1',
    name: 'Ship src only',
    exclude: ['**/*.test.*'],
    include: ['src/**'],
    createdAt: 1700000000000,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('serializeRulePresets', () => {
  it('wraps presets in a versioned envelope', () => {
    const json = serializeRulePresets([makePreset()], '2026-01-01T00:00:00Z');
    const parsed = JSON.parse(json);
    expect(parsed.kind).toBe(RULE_PRESETS_FILE_KIND);
    expect(parsed.version).toBe(RULE_PRESETS_FILE_VERSION);
    expect(parsed.exportedAt).toBe('2026-01-01T00:00:00Z');
    expect(parsed.presets).toHaveLength(1);
    expect(parsed.presets[0].name).toBe('Ship src only');
  });

  it('deep-copies pattern lists', () => {
    const preset = makePreset();
    const json = serializeRulePresets([preset]);
    preset.exclude.push('**/dist/**');
    const reparsed = JSON.parse(json);
    expect(reparsed.presets[0].exclude).toEqual(['**/*.test.*']);
  });
});

describe('parseRulePresets', () => {
  it('round-trips a serialized file', () => {
    const original = [makePreset(), makePreset({ id: 'rp-2', name: 'Docs only', exclude: [], include: ['docs/**'] })];
    const { presets, invalid } = parseRulePresets(serializeRulePresets(original));
    expect(invalid).toBe(0);
    expect(presets).toHaveLength(2);
    expect(presets[1].include).toEqual(['docs/**']);
  });

  it('rejects invalid JSON with a helpful error', () => {
    expect(() => parseRulePresets('{nope')).toThrow('not valid JSON');
  });

  it('rejects unrelated JSON files', () => {
    expect(() => parseRulePresets('{"hello":"world"}')).toThrow(
      'not a Codice rules export',
    );
  });

  it('rejects arrays as the top-level structure', () => {
    expect(() => parseRulePresets('[]')).toThrow('Unexpected file structure');
  });

  it('rejects unsupported versions', () => {
    const json = JSON.stringify({
      kind: RULE_PRESETS_FILE_KIND,
      version: 99,
      presets: [],
    });
    expect(() => parseRulePresets(json)).toThrow('Unsupported rules file version');
  });

  it('counts invalid entries and keeps valid ones', () => {
    const json = JSON.stringify({
      kind: RULE_PRESETS_FILE_KIND,
      version: RULE_PRESETS_FILE_VERSION,
      exportedAt: 'now',
      presets: [
        makePreset(),
        { name: 'no lists' },
        { name: '', exclude: ['a'], include: [] },
        { name: 'empty rules', exclude: [], include: [] },
        'garbage',
      ],
    });
    const { presets, invalid } = parseRulePresets(json);
    expect(presets).toHaveLength(1);
    expect(invalid).toBe(4);
  });

  it('assigns a fresh id to entries missing one', () => {
    const json = JSON.stringify({
      kind: RULE_PRESETS_FILE_KIND,
      version: RULE_PRESETS_FILE_VERSION,
      exportedAt: 'now',
      presets: [{ name: 'Legacy', exclude: ['x'], include: [] }],
    });
    const { presets } = parseRulePresets(json);
    expect(presets[0].id).toMatch(/^rp-/);
  });
});

describe('mergeRulePresets', () => {
  it('adds fresh presets newest-first and persists', () => {
    const existing = [makePreset({ name: 'Local' })];
    const incoming = [makePreset({ name: 'Imported' })];
    const result = mergeRulePresets(existing, incoming);
    expect(result.added).toBe(1);
    expect(result.duplicates).toBe(0);
    expect(result.presets[0].name).toBe('Imported');
    // Persisted to localStorage too.
    expect(window.localStorage.getItem('codice-rule-presets-v1')).toContain(
      'Imported',
    );
  });

  it('treats same-name same-rules presets as duplicates (id-independent)', () => {
    const existing = [makePreset({ name: 'Ship src only', id: 'local-1' })];
    const incoming = [makePreset({ name: 'Ship src only', id: 'other-guy-9' })];
    const result = mergeRulePresets(existing, incoming);
    expect(result.added).toBe(0);
    expect(result.duplicates).toBe(1);
    expect(result.presets).toHaveLength(1);
  });

  it('allows the same name with different rules', () => {
    const existing = [makePreset({ name: 'Ship src only' })];
    const incoming = [makePreset({ name: 'Ship src only', exclude: ['**/*.png'] })];
    const result = mergeRulePresets(existing, incoming);
    expect(result.added).toBe(1);
  });

  it('dedupes within the incoming batch itself', () => {
    const incoming = [makePreset({ name: 'Dup' }), makePreset({ name: 'Dup' })];
    const result = mergeRulePresets([], incoming);
    expect(result.added).toBe(1);
    expect(result.duplicates).toBe(1);
  });

  it('caps the merged list', () => {
    persistRulePresets(
      Array.from({ length: RULE_PRESETS_CAP }, (_, i) =>
        makePreset({ id: `local-${i}`, name: `Local ${i}` }),
      ),
    );
    const existing = Array.from({ length: RULE_PRESETS_CAP }, (_, i) =>
      makePreset({ id: `local-${i}`, name: `Local ${i}` }),
    );
    const result = mergeRulePresets(existing, [
      makePreset({ name: 'Newest' }),
    ]);
    expect(result.presets).toHaveLength(RULE_PRESETS_CAP);
    expect(result.presets[0].name).toBe('Newest');
  });
});
