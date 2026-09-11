/**
 * Legacy compatibility shim — derives `DocumentOptions` from the default
 * built-in DocumentPreset.
 *
 * New code should use `presetToOptions(getDefaultDocumentPreset())`
 * directly.
 */

import type { DocumentOptions } from '@/types';
import { getDefaultDocumentPreset } from '@/lib/presets/builtInPresets';
import { presetToOptions } from '@/lib/presets/presetToOptions';

export function defaultDocumentOptions(): DocumentOptions {
  return presetToOptions(getDefaultDocumentPreset());
}
