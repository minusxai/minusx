/**
 * Spec normalization: inject the reserved named dataset before schema validation and
 * rendering. (The official VL top-level schema requires `data`, so injection MUST run
 * before validation — pipeline order is prepare → validate → compile.)
 */
import { VIZ_DATASET_MAIN } from './types';

/**
 * Return a copy of the spec with `data: {name: 'main'}` injected at the top level when
 * absent. An existing `data` is left untouched (the validator flags disallowed forms).
 * Never mutates the input.
 */
export function prepareVegaLiteSpec(spec: Record<string, unknown>): Record<string, unknown> {
  if ('data' in spec) return { ...spec };
  return { ...spec, data: { name: VIZ_DATASET_MAIN } };
}
