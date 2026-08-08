/**
 * Templates: the vocabulary a DEPLOYMENT ships, as data on disk.
 *
 * A template is not a document. It has no owner, no context file, no place in
 * the file tree and no version history — it is what the app (or the operator)
 * hands every workspace to start from. The file system is where a workspace
 * OVERRIDES or EXTENDS it: a `.viz` file of the same name in a folder shadows
 * the template for that subtree, by exactly the rules that already govern
 * recipe resolution.
 *
 * Two directories feed the registry, in precedence order:
 *   1. `builtin`    — shipped in the image (`frontend/templates/`)
 *   2. `deployment` — `TEMPLATE_DIR`, mounted per deployment
 *
 * They OVERLAY by name rather than replacing: an operator adding one template
 * must not lose the other ten. This deliberately differs from the full-replace
 * rule that `supportedFileTypes` and `accessRules` use, because shadow-by-name
 * is the rule recipes already follow — one mental model, not two.
 */
import type { VizRecipeContent } from '@/lib/validation/atlas-schemas';

/** Template families. `viz` today; story components are the intended second. */
export type TemplateKind = 'viz';

/** Where a template came from — shown in the UI and used for precedence. */
export type TemplateOrigin = 'builtin' | 'deployment';

/** Later origins win. */
export const TEMPLATE_ORIGIN_PRECEDENCE: readonly TemplateOrigin[] = ['builtin', 'deployment'];

/**
 * File extensions a template may use. Order is the tie-break when one name is
 * present twice in a directory, so it must stay deterministic.
 */
export const TEMPLATE_FILE_EXTENSIONS = ['.viz', '.json'] as const;

/**
 * A template NAME is the shadowing key, and must be something a workspace file
 * could also be called — otherwise a template could exist that no `.viz` file
 * can ever override. Bare, no path separators, no `@` version suffixes, no
 * leading dot (so `.DS_Store` can never become a template).
 */
export const TEMPLATE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export interface LoadedTemplate<TContent> {
  /** Basename without extension — the key everything shadows on. */
  name: string;
  origin: TemplateOrigin;
  /** Absolute path it was read from. Diagnostics only; never shown to users. */
  sourcePath: string;
  content: TContent;
}

/** A file that could not become a template, and why. Logged, never fatal. */
export interface SkippedTemplate {
  path: string;
  reason: string;
}

/**
 * The loaded set. `viz` is already shadowed — one entry per name, the winning
 * origin — so consumers never re-implement precedence.
 */
export interface TemplateRegistry {
  viz: Record<string, LoadedTemplate<VizRecipeContent>>;
  /**
   * Everything rejected, in read order. A deployment with a typo'd template
   * gets a specific reason in the boot log rather than a silently missing
   * chart — and, critically, the template it would have shadowed SURVIVES.
   */
  skipped: SkippedTemplate[];
}

/** One directory to read, and the origin its templates are attributed to. */
export interface TemplateDir {
  dir: string;
  origin: TemplateOrigin;
}

export const EMPTY_TEMPLATE_REGISTRY: TemplateRegistry = { viz: {}, skipped: [] };

/**
 * The `viz` templates as the wire/registry shape: content plus origin, keyed by
 * name. Origin travels because an operator has to be able to tell their own
 * templates from the app's — resolution ignores it, the Templates page shows it.
 */
export function vizTemplateEntries(
  registry: TemplateRegistry,
): Record<string, { content: VizRecipeContent; origin: TemplateOrigin }> {
  return Object.fromEntries(
    Object.entries(registry.viz).map(([name, t]) => [name, { content: t.content, origin: t.origin }]),
  );
}
