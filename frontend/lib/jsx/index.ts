/**
 * Static-JSX-as-data engine (File Architecture v2) — isomorphic parse → validate →
 * render, shared by server (validate-on-save, public-share render) and client (GUI).
 * Defining "what `jsx` means" once keeps save-validation and rendering from drifting.
 */
import type { ReactNode } from 'react';
import { parseJsx } from './parse';
import { validateJsx } from './validate';
import { renderJsx, type JsxComponentRegistry } from './render';
import type { ValidationError } from './types';

export * from './types';
export { parseJsx } from './parse';
export { validateJsx } from './validate';
export { renderJsx, type JsxComponentRegistry } from './render';
export { serializeJsx } from './serialize';

export type CompileResult =
  | { ok: true; node: ReactNode[] }
  | { ok: false; errors: ValidationError[] };

/**
 * Parse → validate → render a `jsx` source against a component registry. The
 * registry's keys are the allowed components. Use on the client to render.
 */
export function compileJsx(
  source: string,
  registry: JsxComponentRegistry,
  allowedHtmlTags?: Iterable<string>,
): CompileResult {
  const parsed = parseJsx(source);
  if (!parsed.ok) return { ok: false, errors: [{ message: `JSX syntax error: ${parsed.error}` }] };
  const errors = validateJsx(parsed.nodes, { components: Object.keys(registry), allowedHtmlTags });
  if (errors.length) return { ok: false, errors };
  return { ok: true, node: renderJsx(parsed.nodes, registry) };
}

/**
 * Parse → validate a `jsx` source WITHOUT rendering (no React). Use server-side to
 * validate on save. Returns [] when valid.
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
