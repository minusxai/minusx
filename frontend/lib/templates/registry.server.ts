import 'server-only';

/**
 * The deployment's template registry: loaded once, at boot, from the app's own
 * template directory with `TEMPLATE_DIR` overlaid on top.
 *
 * Boot-time rather than per-request is a deliberate trade. Templates change
 * when an operator changes a mounted directory, which is a deployment event —
 * paying an `fs` walk on every request to notice it sooner would be a worse
 * deal than restarting to pick it up. The cost is stated plainly in the docs.
 *
 * Nothing here throws: `loadTemplateRegistry` degrades a bad file to a `skipped`
 * entry, and this module's job is to make those visible in the boot log. A
 * deployment whose whole `TEMPLATE_DIR` is missing gets a warning and the
 * built-ins, not a boot failure.
 */
import { join } from 'node:path';
import { TEMPLATE_DIR } from '@/lib/config';
import { loadTemplateRegistry } from './template-loader.server';
import { setBuiltinVizTemplates } from '@/lib/viz/builtin-recipes';
import { EMPTY_TEMPLATE_REGISTRY, vizTemplateEntries, type TemplateDir, type TemplateRegistry } from './types';

/**
 * The app's own templates, shipped in the image. Resolved from the process CWD,
 * which is the app root both under `next dev` and in the standalone server —
 * the Dockerfile copies `templates/` alongside `lib/` for exactly this reason.
 */
export function appTemplateDir(): string {
  return join(process.cwd(), 'templates');
}

/** The directories to read, weakest first. `TEMPLATE_DIR` shadows by name. */
export function templateDirs(): TemplateDir[] {
  const dirs: TemplateDir[] = [{ dir: appTemplateDir(), origin: 'builtin' }];
  if (TEMPLATE_DIR) dirs.push({ dir: TEMPLATE_DIR, origin: 'deployment' });
  return dirs;
}

// eslint-disable-next-line no-restricted-syntax -- deployment-wide, set once at
// boot and read-only after; never per-request state.
let cached: TemplateRegistry | null = null;

/**
 * The loaded registry, loading it on first call. Installs the `viz` set into the
 * built-in recipe registry as a side effect, because every resolution path —
 * the save gate, the agent's advertisement, the browser's selector — reads that
 * one registry rather than threading templates through a dozen signatures.
 */
export function getTemplateRegistry(): TemplateRegistry {
  if (cached) return cached;
  let registry: TemplateRegistry;
  try {
    registry = loadTemplateRegistry(templateDirs());
  } catch (e) {
    // The loader is written not to throw; if it somehow does, a deployment with
    // no built-in recipes is still a working deployment.
    console.error('[templates] registry load failed, continuing with none:', e);
    registry = EMPTY_TEMPLATE_REGISTRY;
  }
  for (const skip of registry.skipped) {
    console.warn(`[templates] skipped ${skip.path}: ${skip.reason}`);
  }
  setBuiltinVizTemplates(vizTemplateEntries(registry));
  cached = registry;
  return registry;
}

/** Test seam: forget the cache so the next call re-reads the directories. */
export function resetTemplateRegistryForTests(): void {
  cached = null;
}
