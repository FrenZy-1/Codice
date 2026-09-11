import { describe, expect, it, beforeEach } from 'vitest';
import {
  BUILT_IN_DOCUMENT_PRESETS,
  getBuiltInPreset,
  getDefaultDocumentPreset,
} from '../lib/presets/builtInPresets';
import {
  loadCustomPresets,
  saveCustomPreset,
  updateCustomPreset,
  deleteCustomPreset,
  duplicatePreset,
  findPreset,
  getAllPresets,
  exportPreset,
  importPreset,
} from '../lib/presets/customPresets';
import type { DocumentPreset } from '../lib/presets/documentPreset';

describe('built-in presets', () => {
  it('includes University, Developer, Minimal, Dark Code', () => {
    const ids = BUILT_IN_DOCUMENT_PRESETS.map((p) => p.id);
    expect(ids).toContain('university');
    expect(ids).toContain('developer');
    expect(ids).toContain('minimal');
    expect(ids).toContain('dark-code');
  });

  it('all built-in presets are marked builtIn', () => {
    for (const p of BUILT_IN_DOCUMENT_PRESETS) {
      expect(p.builtIn).toBe(true);
    }
  });

  it('all built-in presets have a complete structure', () => {
    for (const p of BUILT_IN_DOCUMENT_PRESETS) {
      expect(p.page).toBeDefined();
      expect(p.typography).toBeDefined();
      expect(p.headings).toBeDefined();
      expect(p.headings.title).toBeDefined();
      expect(p.headings.h1).toBeDefined();
      expect(p.headings.h2).toBeDefined();
      expect(p.headings.h3).toBeDefined();
      expect(p.headings.h4).toBeDefined();
      expect(p.code).toBeDefined();
      expect(p.fileHeaders).toBeDefined();
      expect(p.projectHeaders).toBeDefined();
      expect(p.titlePage).toBeDefined();
      expect(p.colors).toBeDefined();
    }
  });

  it('getBuiltInPreset finds by id', () => {
    expect(getBuiltInPreset('university')?.name).toBe('University');
    expect(getBuiltInPreset('nonexistent')).toBeUndefined();
  });

  it('getDefaultDocumentPreset returns a valid preset', () => {
    const p = getDefaultDocumentPreset();
    expect(p).toBeDefined();
    expect(p.id).toBeTruthy();
  });
});

describe('custom presets', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty', () => {
    expect(loadCustomPresets()).toEqual([]);
  });

  it('saveCustomPreset creates a new preset with a unique id', () => {
    const base = getBuiltInPreset('university')!;
    const saved = saveCustomPreset({ ...base, name: 'My Custom' });
    expect(saved.id).not.toBe(base.id);
    expect(saved.builtIn).toBe(false);
    expect(saved.name).toBe('My Custom');
    expect(loadCustomPresets()).toHaveLength(1);
  });

  it('updateCustomPreset updates an existing custom preset', () => {
    const base = getBuiltInPreset('university')!;
    const saved = saveCustomPreset({ ...base, name: 'Original' });
    const updated = updateCustomPreset({ ...saved, name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
    expect(loadCustomPresets()[0].name).toBe('Renamed');
  });

  it('updateCustomPreset on a built-in creates a new custom preset', () => {
    const base = getBuiltInPreset('university')!;
    const result = updateCustomPreset({ ...base, name: 'Modified' });
    expect(result.id).not.toBe(base.id);
    expect(result.builtIn).toBe(false);
  });

  it('deleteCustomPreset removes by id', () => {
    const base = getBuiltInPreset('university')!;
    const saved = saveCustomPreset({ ...base, name: 'To Delete' });
    expect(loadCustomPresets()).toHaveLength(1);
    deleteCustomPreset(saved.id);
    expect(loadCustomPresets()).toHaveLength(0);
  });

  it('deleteCustomPreset does not throw on unknown id', () => {
    expect(() => deleteCustomPreset('does-not-exist')).not.toThrow();
  });

  it('duplicatePreset creates a copy with a new id', () => {
    const base = getBuiltInPreset('university')!;
    const dup = duplicatePreset(base, 'My Copy');
    expect(dup.id).not.toBe(base.id);
    expect(dup.name).toBe('My Copy');
    expect(dup.builtIn).toBe(false);
    expect(loadCustomPresets()).toHaveLength(1);
  });

  it('findPreset finds both built-in and custom', () => {
    expect(findPreset('university')?.builtIn).toBe(true);
    const base = getBuiltInPreset('university')!;
    const saved = saveCustomPreset({ ...base, name: 'My Custom' });
    expect(findPreset(saved.id)?.builtIn).toBe(false);
  });

  it('getAllPresets returns built-in + custom', () => {
    const base = getBuiltInPreset('university')!;
    saveCustomPreset({ ...base, name: 'My Custom' });
    const all = getAllPresets();
    expect(all.length).toBe(BUILT_IN_DOCUMENT_PRESETS.length + 1);
  });

  it('exportPreset produces valid JSON', () => {
    const base = getBuiltInPreset('university')!;
    const json = exportPreset(base);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe('University');
    expect(parsed.version).toBe(1);
    expect(parsed.page).toBeDefined();
    expect(parsed.typography).toBeDefined();
    expect(parsed.headings).toBeDefined();
    expect(parsed.code).toBeDefined();
  });

  it('importPreset creates a new custom preset from JSON', () => {
    const base = getBuiltInPreset('university')!;
    const json = exportPreset(base);
    // The imported preset keeps the name from the JSON ('University').
    const imported = importPreset(json);
    expect(imported.builtIn).toBe(false);
    expect(imported.name).toBe('University');
    expect(imported.id).not.toBe(base.id);
    expect(loadCustomPresets()).toHaveLength(1);
  });

  it('importPreset uses fallback name when JSON has none', () => {
    const base = getBuiltInPreset('university')!;
    const json = exportPreset(base);
    // Strip the name to exercise the fallback.
    const stripped = JSON.parse(json);
    delete stripped.name;
    const imported = importPreset(JSON.stringify(stripped), 'Fallback Name');
    expect(imported.name).toBe('Fallback Name');
  });

  it('importPreset throws on invalid JSON', () => {
    expect(() => importPreset('not json at all')).toThrow();
  });
});
