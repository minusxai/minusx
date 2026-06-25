// Pure prompt render engine: resolves
// nested {template.ref}s and substitutes {variables}. Operates on an in-memory
// PromptTree — see ./index.ts, which binds it to the bundled prompts.yaml.

export interface PromptTree {
  templates: Record<string, unknown>;
  prompts: Record<string, unknown>;
}

function getNested(data: unknown, path: string): unknown {
  const keys = path.split('.');
  let cur: unknown = data;
  for (const k of keys) {
    if (cur && typeof cur === 'object' && k in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }
  return cur;
}

const NESTED_REF = /\{([\w]+(?:\.[\w]+)+)\}/g;
const SIMPLE_REF = /\{(\w+)\}/g;

function resolveTemplates(text: string, templates: Record<string, unknown>): string {
  let cur = text;
  for (let i = 0; i < 10; i++) {
    let replaced = false;
    cur = cur.replace(NESTED_REF, (_m, p) => {
      const v = getNested(templates, p);
      if (v === undefined) throw new Error(`Template '${p}' not found`);
      replaced = true;
      return String(v);
    });
    cur = cur.replace(SIMPLE_REF, (m, p) => {
      const v = templates[p];
      if (typeof v === 'string') {
        replaced = true;
        return v;
      }
      return m;
    });
    if (!replaced) break;
  }
  return cur;
}

/** Skills that are preloaded implicitly and never offered in the LoadSkill catalog. */
export const HIDDEN_SKILLS = new Set(['navigation_restricted', 'navigation_unrestricted']);

const SKILL_PREFIX = 'skill_';

/**
 * List available skills as `name → description` (drives the skills catalog
 * prompt_loader.list_skills). Skills are templates whose keys start with
 * `skill_`; the prefix is stripped. With `skipHidden`, the nav skills in
 * HIDDEN_SKILLS are excluded.
 */
export function listSkills(
  tree: PromptTree,
  opts: { skipHidden?: boolean } = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree.templates)) {
    if (!key.startsWith(SKILL_PREFIX) || !value || typeof value !== 'object') continue;
    const name = key.slice(SKILL_PREFIX.length);
    if (opts.skipHidden && HIDDEN_SKILLS.has(name)) continue;
    out[name] = String((value as Record<string, unknown>).description ?? '');
  }
  return out;
}

/**
 * Resolve a skill's content by name.
 * Returns the content with nested template refs resolved — but NOT variable-
 * substituted, so `{{` JSON escapes stay literal (matching how preloaded skill
 * content is injected). Returns null if the skill is missing or has no content.
 */
export function getSkill(tree: PromptTree, name: string): string | null {
  const template = tree.templates[`${SKILL_PREFIX}${name}`];
  if (!template || typeof template !== 'object') return null;
  const content = (template as Record<string, unknown>).content;
  if (typeof content !== 'string' || content === '') return null;
  return resolveTemplates(content, tree.templates);
}

export function pyFormat(text: string, vars: Record<string, unknown>): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '{') {
      if (text[i + 1] === '{') {
        out += '{';
        i += 2;
        continue;
      }
      const end = text.indexOf('}', i + 1);
      if (end === -1) throw new Error("Single '{' encountered in format string");
      const name = text.slice(i + 1, end);
      if (!(name in vars)) throw new Error(`Missing variable '${name}'`);
      out += String(vars[name] ?? '');
      i = end + 1;
    } else if (c === '}') {
      if (text[i + 1] === '}') {
        out += '}';
        i += 2;
        continue;
      }
      throw new Error("Single '}' encountered in format string");
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export function renderPrompt(
  tree: PromptTree,
  promptId: string,
  vars: Record<string, unknown>,
): string {
  const raw = getNested(tree.prompts, promptId);
  if (typeof raw !== 'string') throw new Error(`Prompt '${promptId}' not found`);
  const resolved = resolveTemplates(raw, tree.templates);
  return pyFormat(resolved, vars);
}
