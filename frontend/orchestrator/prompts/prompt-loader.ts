import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

export interface PromptTree {
  templates: Record<string, unknown>;
  prompts: Record<string, unknown>;
}

// eslint-disable-next-line no-restricted-syntax -- memoization of immutable YAML file reads keyed by absolute path; no per-request mutation
const cache = new Map<string, PromptTree>();

export function loadPrompts(yamlPath: string): PromptTree {
  const cached = cache.get(yamlPath);
  if (cached) return cached;
  const raw = readFileSync(yamlPath, 'utf-8');
  const parsed = (yaml.load(raw) ?? {}) as Partial<PromptTree>;
  const tree: PromptTree = {
    templates: parsed.templates ?? {},
    prompts: parsed.prompts ?? {},
  };
  cache.set(yamlPath, tree);
  return tree;
}

export function clearPromptCache(): void {
  cache.clear();
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
  yamlPath: string,
  promptId: string,
  vars: Record<string, unknown>,
): string {
  const tree = loadPrompts(yamlPath);
  const raw = getNested(tree.prompts, promptId);
  if (typeof raw !== 'string') throw new Error(`Prompt '${promptId}' not found`);
  const resolved = resolveTemplates(raw, tree.templates);
  return pyFormat(resolved, vars);
}
