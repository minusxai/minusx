/**
 * The built-in viz recipes, as a registry populated at BOOT rather than authored
 * in TypeScript. The definitions live on disk (`frontend/templates/viz/*.viz`,
 * plus whatever `TEMPLATE_DIR` overlays) so a deployment can ship its own
 * defaults without forking the repo — see `lib/templates/`.
 *
 * A module-level mutable registry is deliberate, and safe for the same reason
 * `VIZ_TEMPLATES` is: this is deployment-wide vocabulary, identical for every
 * request and read-only once set. It is written exactly twice — by the server's
 * boot tasks, and by the browser once the SSR-hydrated set reaches Redux.
 *
 * Reading it before either write yields `{}`, which degrades to "no built-in
 * recipes" (workspace files and shipped `minusx/…` recipes still resolve) rather
 * than throwing. `lib/templates/__tests__/builtin-registry.test.ts` pins that.
 */
import type { VizRecipeContent } from '@/lib/validation/atlas-schemas';
import type { TemplateOrigin } from '@/lib/templates/types';

/** A built-in recipe plus where it came from — the app, or `TEMPLATE_DIR`. */
export interface BuiltinVizTemplate {
  content: VizRecipeContent;
  origin: TemplateOrigin;
}

// eslint-disable-next-line no-restricted-syntax -- deployment-wide vocabulary, set
// once at boot and read-only after; never per-request state. See the header.
let registry: Record<string, BuiltinVizTemplate> = {};

/** Install the loaded template set. Boot (server) and hydration (client) only. */
export function setBuiltinVizTemplates(next: Record<string, BuiltinVizTemplate>): void {
  registry = next;
}

/**
 * The built-in recipes by name — the shape RESOLUTION wants, which cares what a
 * recipe is and not where it came from.
 */
export function getBuiltinVizRecipes(): Record<string, VizRecipeContent> {
  return Object.fromEntries(Object.entries(registry).map(([name, t]) => [name, t.content]));
}

/**
 * Where each built-in came from. Display only: an operator who mounts
 * `TEMPLATE_DIR` has to be able to tell their templates from the app's, or a
 * mount that silently failed looks exactly like one that worked.
 */
export function getBuiltinVizOrigin(name: string): TemplateOrigin | undefined {
  return registry[name]?.origin;
}
