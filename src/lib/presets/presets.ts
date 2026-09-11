/**
 * Legacy compatibility shim.
 *
 * The original `Preset` type and `BUILT_IN_PRESETS` array have been replaced
 * by the richer `DocumentPreset` model in `documentPreset.ts` and
 * `builtInPresets.ts`. This module forwards to the new system so any
 * external code that still imports from here keeps working.
 */

import type { Preset } from '@/types';
import { BUILT_IN_DOCUMENT_PRESETS, DEFAULT_DOCUMENT_PRESET_ID } from './builtInPresets';
import { presetToOptions } from './presetToOptions';

/** Convert new DocumentPreset to legacy Preset shape. */
function toLegacyPreset(p: typeof BUILT_IN_DOCUMENT_PRESETS[number]): Preset {
  return {
    id: p.id,
    label: p.name,
    description: p.description,
    options: presetToOptions(p),
    metadata: p.metadata,
    syntaxTheme: p.syntaxTheme,
    builtIn: p.builtIn,
  };
}

export const BUILT_IN_PRESETS: Preset[] =
  BUILT_IN_DOCUMENT_PRESETS.map(toLegacyPreset);

export const DEFAULT_PRESET_ID = DEFAULT_DOCUMENT_PRESET_ID;

export function getPreset(id: string): Preset | undefined {
  const found = BUILT_IN_DOCUMENT_PRESETS.find((p) => p.id === id);
  return found ? toLegacyPreset(found) : undefined;
}
