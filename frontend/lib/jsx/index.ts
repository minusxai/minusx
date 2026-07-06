/**
 * Static-JSX-as-data engine (File Architecture v2) — parse → static-validate → serialize,
 * shared by server (validate-on-save) and the content⇄jsx converter. Defining "what `jsx`
 * means" once keeps save-validation and the agent's markup surface from drifting.
 */
import { parseJsx } from './parse';
import { validateJsx } from './validate';
import type { ValidationError } from './types';

export * from './types';
export { parseJsx } from './parse';
export { serializeJsx } from './serialize';
export { sanitizeLooseJsx } from './lenient';

/**
 * Parse → validate a `jsx` source against the static-JSX security rules (registered
 * components only, no <script>/event-handlers/dangerous URLs). Returns [] when valid.
 */
export function validateJsxSource(
  source: string,
  components: Iterable<string>,
  allowedHtmlTags?: Iterable<string>,
): ValidationError[] {
  const parsed = parseJsx(source);
  if (!parsed.ok) return [{ message: `JSX syntax error: ${parsed.error}` }];
  return validateJsx(parsed.nodes, { components, allowedHtmlTags });
}
