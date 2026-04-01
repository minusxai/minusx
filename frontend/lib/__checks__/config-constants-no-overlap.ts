/**
 * Compile-time guard: lib/config.ts and lib/constants.ts must not export
 * any of the same names. If they do, tsc will error here with a type mismatch.
 *
 * Rule: server-only vars go in config.ts; client-safe vars go in constants.ts.
 * Keeping their exports disjoint makes the split unambiguous.
 *
 * This file uses `import type` so it never triggers the `server-only` runtime guard.
 */

import type * as Config from '../config';
import type * as Constants from '../constants';

type ConfigKeys = keyof typeof Config;
type ConstantsKeys = keyof typeof Constants;

// If any name appears in both files this becomes a non-never type and the
// assignment below fails with a compile error.
type Overlap = ConfigKeys & ConstantsKeys;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _noOverlap: Overlap extends never
  ? true
  : 'ERROR: overlapping exports between lib/config.ts and lib/constants.ts — move the duplicate to exactly one file' = true;
