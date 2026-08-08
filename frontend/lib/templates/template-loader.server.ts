import 'server-only';

/**
 * Read template files off disk into the registry, once at boot.
 *
 * Everything here is best-effort by design: this runs over a directory an
 * OPERATOR mounts, and a mistake in one file must cost exactly that file. So a
 * bad template is recorded in `skipped` with a reason and skipped — it never
 * throws, never aborts the directory, and above all never removes the template
 * it would have shadowed. A typo in `bullet.viz` must not delete `bullet` from
 * every workspace in the deployment.
 *
 * Validation is the SAME gate an authored `.viz` file passes, not a lookalike:
 * the Ajv content validator, then a dry-run materialization with synthesized
 * bindings. A template with an undeclared `{{token}}` fails at boot, in a log
 * line that names the token, rather than at render in someone's dashboard.
 */
import { readdirSync, readFileSync, statSync, lstatSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { validateFileState } from '@/lib/validation/content-validators';
import { immutableMap } from '@/lib/utils/immutable-collections';
import type { VizRecipeContent } from '@/lib/validation/atlas-schemas';
import {
  TEMPLATE_FILE_EXTENSIONS,
  TEMPLATE_NAME_PATTERN,
  type LoadedTemplate,
  type SkippedTemplate,
  type TemplateDir,
  type TemplateRegistry,
} from './types';

/** Extension precedence for a same-name collision inside one directory. */
const EXTENSION_RANK = immutableMap<string, number>(TEMPLATE_FILE_EXTENSIONS.map((ext, i) => [ext, i]));

interface Candidate {
  name: string;
  path: string;
  ext: string;
}

/**
 * The template files directly inside `<dir>/viz`, sorted so a collision resolves
 * the same way on every boot and every filesystem (readdir order is not
 * guaranteed). Returns null when the kind directory is simply absent — an
 * unused template kind is not an error.
 */
function candidates(dir: string, kind: string): Candidate[] | null {
  const kindDir = join(dir, kind);
  let entries: string[];
  try {
    if (!statSync(kindDir).isDirectory()) return null;
    entries = readdirSync(kindDir);
  } catch {
    return null;
  }
  return entries
    .filter((f) => !f.startsWith('.'))                                  // .DS_Store, .gitkeep
    .filter((f) => EXTENSION_RANK.has(extname(f)))
    .map((f) => ({ name: f.slice(0, f.length - extname(f).length), path: join(kindDir, f), ext: extname(f) }))
    .sort((a, b) => a.name.localeCompare(b.name) || EXTENSION_RANK.get(a.ext)! - EXTENSION_RANK.get(b.ext)!);
}

/** Parse + validate one file into recipe content, or explain why not. */
function readVizTemplate(path: string): { ok: true; content: VizRecipeContent } | { ok: false; reason: string } {
  // A symlink can point anywhere the server process can read; templates are a
  // directory of data, not a way to address the filesystem.
  try {
    if (lstatSync(path).isSymbolicLink()) return { ok: false, reason: 'is a symlink, which templates may not use' };
  } catch {
    return { ok: false, reason: 'could not be read' };
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    return { ok: false, reason: `could not be read: ${(e as Error).message}` };
  }
  if (raw.trim() === '') return { ok: false, reason: 'is empty' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: `is not valid JSON: ${(e as Error).message}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'must be a JSON object' };
  }

  // Exactly the gate an authored `.viz` file passes: the Ajv schema, and then
  // the dry-run materialization it already performs — so a token nothing
  // declares is a boot-time error naming the token, not a broken chart later.
  const invalid = validateFileState({ type: 'viz', content: parsed });
  if (invalid) return { ok: false, reason: invalid };

  return { ok: true, content: parsed as VizRecipeContent };
}

/**
 * Load every configured directory in order, overlaying by name — a later
 * directory's template replaces an earlier one's, and anything it does not
 * name is left alone.
 */
export function loadTemplateRegistry(dirs: TemplateDir[]): TemplateRegistry {
  const viz: Record<string, LoadedTemplate<VizRecipeContent>> = {};
  const skipped: SkippedTemplate[] = [];
  const seenDirs = new Set<string>();

  for (const { dir, origin } of dirs) {
    const resolved = resolve(dir);
    if (seenDirs.has(resolved)) continue;   // TEMPLATE_DIR may point at the built-in dir
    seenDirs.add(resolved);

    try {
      if (!statSync(resolved).isDirectory()) {
        skipped.push({ path: resolved, reason: 'is not a directory' });
        continue;
      }
    } catch {
      skipped.push({ path: resolved, reason: 'not found' });
      continue;
    }

    const files = candidates(resolved, 'viz');
    if (!files) continue;                   // no viz/ subdirectory: nothing to do

    let previousName: string | null = null;
    for (const file of files) {
      if (previousName === file.name) {
        // Sorted, so the winner was the previous entry; say so rather than
        // letting one of two identically-named files vanish silently.
        skipped.push({ path: file.path, reason: `duplicate name "${file.name}" — collides with a higher-precedence extension` });
        continue;
      }
      previousName = file.name;

      if (!TEMPLATE_NAME_PATTERN.test(file.name)) {
        skipped.push({ path: file.path, reason: `invalid template name "${file.name}" — a template must be nameable as a workspace file` });
        continue;
      }

      const read = readVizTemplate(file.path);
      if (!read.ok) {
        // The built-in this file would have shadowed stays exactly as it is.
        skipped.push({ path: file.path, reason: read.reason });
        continue;
      }
      viz[file.name] = { name: file.name, origin, sourcePath: file.path, content: read.content };
    }
  }

  return { viz, skipped };
}
