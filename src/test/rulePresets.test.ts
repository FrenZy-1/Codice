import { beforeEach, describe, expect, it } from 'vitest';
import {
  createRulePreset,
  loadRulePresets,
  persistRulePresets,
  pushRulePreset,
  removeRulePreset,
  rulePresetMatches,
  RULE_PRESETS_CAP,
  RULE_PRESETS_STORAGE_KEY,
  type RulePreset,
} from '@/lib/rulePresets';

function seed(items: unknown): void {
  localStorage.setItem(RULE_PRESETS_STORAGE_KEY, JSON.stringify(items));
}

beforeEach(() => {
  localStorage.removeItem(RULE_PRESETS_STORAGE_KEY);
});

describe('rulePresets — create', () => {
  it('creates a preset with trimmed name and copied lists', () => {
    const exclude = ['*.test.js'];
    const include = ['src/**'];
    const preset = createRulePreset('  Ship set  ', exclude, include, 1000);
    expect(preset.name).toBe('Ship set');
    expect(preset.exclude).toEqual(['*.test.js']);
    expect(preset.include).toEqual(['src/**']);
    expect(preset.exclude).not.toBe(exclude);
    expect(preset.createdAt).toBe(1000);
    expect(preset.id).toMatch(/^rp-/);
  });

  it('falls back to a default name when blank', () => {
    expect(createRulePreset('   ', [], []).name).toBe('Untitled rules');
  });

  it('generates unique ids', () => {
    const a = createRulePreset('a', [], [], 1000);
    const b = createRulePreset('a', [], [], 1000);
    expect(a.id).not.toBe(b.id);
  });
});

describe('rulePresets — push / remove / cap', () => {
  it('pushes newest first and persists', () => {
    const first = createRulePreset('first', ['a'], [], 1);
    const second = createRulePreset('second', ['b'], ['c'], 2);
    let list = pushRulePreset([], first);
    list = pushRulePreset(list, second);
    expect(list.map((p) => p.name)).toEqual(['second', 'first']);
    expect(loadRulePresets().map((p) => p.name)).toEqual(['second', 'first']);
  });

  it('caps the list and drops the oldest', () => {
    let list: RulePreset[] = [];
    for (let i = 0; i < RULE_PRESETS_CAP + 3; i++) {
      list = pushRulePreset(list, createRulePreset(`p${i}`, [`${i}`], [], i));
    }
    expect(list.length).toBe(RULE_PRESETS_CAP);
    expect(list.some((p) => p.name === 'p0')).toBe(false);
    expect(list[0].name).toBe(`p${RULE_PRESETS_CAP + 2}`);
  });

  it('honors a smaller custom cap', () => {
    let list: RulePreset[] = [];
    for (let i = 0; i < 5; i++) {
      list = pushRulePreset(list, createRulePreset(`p${i}`, [`${i}`], [], i), 3);
    }
    expect(list.length).toBe(3);
  });

  it('removes by id and persists', () => {
    const a = createRulePreset('a', [], []);
    const b = createRulePreset('b', [], []);
    const list = pushRulePreset(pushRulePreset([], a), b);
    const next = removeRulePreset(list, a.id);
    expect(next.map((p) => p.name)).toEqual(['b']);
    expect(loadRulePresets().map((p) => p.name)).toEqual(['b']);
  });
});

describe('rulePresets — loadRulePresets robustness', () => {
  it('returns an empty list when nothing is stored', () => {
    expect(loadRulePresets()).toEqual([]);
  });

  it('drops corrupt entries but keeps valid ones', () => {
    seed([
      { id: 'x', name: 'ok', exclude: ['a', 42], include: ['b'], createdAt: 5 },
      null,
      { name: 'no-id' },
      { id: 'y', name: 'no-lists' },
    ]);
    const presets = loadRulePresets();
    expect(presets.length).toBe(1);
    expect(presets[0].name).toBe('ok');
    expect(presets[0].exclude).toEqual(['a']); // non-strings filtered
    expect(presets[0].createdAt).toBe(5);
  });

  it('survives malformed JSON and non-array payloads', () => {
    localStorage.setItem(RULE_PRESETS_STORAGE_KEY, '{not json');
    expect(loadRulePresets()).toEqual([]);
    seed({ not: 'an array' });
    expect(loadRulePresets()).toEqual([]);
  });
});

describe('rulePresets — persistRulePresets / matching', () => {
  it('persists and round-trips', () => {
    const preset = createRulePreset('rt', ['docs/**'], ['docs/README.md']);
    persistRulePresets([preset]);
    expect(loadRulePresets()[0].name).toBe('rt');
  });

  it('rulePresetMatches compares both lists in order', () => {
    const preset = createRulePreset('m', ['a', 'b'], ['c']);
    expect(rulePresetMatches(preset, ['a', 'b'], ['c'])).toBe(true);
    expect(rulePresetMatches(preset, ['b', 'a'], ['c'])).toBe(false);
    expect(rulePresetMatches(preset, ['a'], ['c'])).toBe(false);
    expect(rulePresetMatches(preset, ['a', 'b'], [])).toBe(false);
  });
});
