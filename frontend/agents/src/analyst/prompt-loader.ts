import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

// Resolve this module's directory in both ESM and CJS contexts. ts-jest runs the
// orchestrator project as ESM (import.meta.url) and the main project as CJS (__dirname).
// We reference import.meta inside a try block so the CJS branch never evaluates it.
function moduleDir(): string {
  // CJS path first — when __dirname exists, import.meta is a syntax error in some runtimes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maybeDirname = (globalThis as any).__dirname ?? (typeof __dirname !== 'undefined' ? __dirname : undefined);
  if (typeof maybeDirname === 'string') return maybeDirname;
  // ESM path — import.meta.url is the URL of this module.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const metaUrl = (import.meta as any)?.url as string | undefined;
  if (metaUrl) return dirname(fileURLToPath(metaUrl));
  throw new Error('Cannot resolve module directory (neither __dirname nor import.meta.url available)');
}

/**
 * Port of `backend/tasks/agents/analyst/prompt_loader.py`.
 *
 * Loads prompts.yaml, resolves nested `{template}` and `{path.to.template}` references,
 * and substitutes `{variable}` placeholders. Mirrors Python `str.format(**vars)` semantics:
 * unsubstituted `{var}` placeholders raise.
 */

export const HIDDEN_SKILLS = new Set(['navigation_restricted', 'navigation_unrestricted']);

interface PromptsFile {
  templates: Record<string, unknown>;
  prompts: Record<string, unknown>;
}

export class PromptLoader {
  readonly templates: Record<string, unknown>;
  readonly prompts: Record<string, unknown>;

  constructor(promptsFile?: string) {
    const path = promptsFile ?? join(moduleDir(), 'prompts.yaml');
    const raw = readFileSync(path, 'utf8');
    const data = yaml.load(raw) as PromptsFile;
    this.templates = data.templates ?? {};
    this.prompts = data.prompts ?? {};
  }

  get(promptId: string, variables: Record<string, unknown> = {}): string {
    const prompt = this.getNested(this.prompts, promptId);
    if (typeof prompt !== 'string') {
      throw new Error(`Prompt '${promptId}' not found or is not a string`);
    }
    const resolved = this.resolveTemplates(prompt);
    return this.formatVariables(resolved, variables);
  }

  listSkills(skipHidden = false): Record<string, string> {
    const skills: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.templates)) {
      if (key.startsWith('skill_') && typeof value === 'object' && value !== null) {
        const name = key.slice('skill_'.length);
        if (skipHidden && HIDDEN_SKILLS.has(name)) continue;
        skills[name] = (value as { description?: string }).description ?? '';
      }
    }
    return skills;
  }

  getSkill(name: string): string | null {
    const key = `skill_${name}`;
    const template = this.templates[key];
    if (!template || typeof template !== 'object') return null;
    const content = (template as { content?: string }).content ?? '';
    if (!content) return null;
    return this.resolveTemplates(content);
  }

  private getNested(data: Record<string, unknown>, path: string): unknown {
    let current: unknown = data;
    for (const key of path.split('.')) {
      if (typeof current === 'object' && current !== null && key in current) {
        current = (current as Record<string, unknown>)[key];
      } else {
        return null;
      }
    }
    return current;
  }

  private resolveTemplates(text: string): string {
    const nestedPattern = /\{(\w+(?:\.\w+)+)\}/g;
    const simplePattern = /\{(\w+)\}/g;

    let current = text;
    for (let i = 0; i < 10; i++) {
      let madeReplacement = false;

      // Resolve nested {a.b.c} first
      current = current.replace(nestedPattern, (match, templatePath: string) => {
        const content = this.getNested(this.templates, templatePath);
        if (content === null) {
          throw new Error(`Template '${templatePath}' not found`);
        }
        madeReplacement = true;
        return String(content);
      });

      // Then resolve simple {name} only if it exists in templates
      current = current.replace(simplePattern, (match, name: string) => {
        if (name in this.templates) {
          const content = this.templates[name];
          if (typeof content === 'string') {
            madeReplacement = true;
            return content;
          }
        }
        return match;
      });

      if (!madeReplacement) break;
    }
    return current;
  }

  private formatVariables(text: string, variables: Record<string, unknown>): string {
    // Python str.format substitutes {name}; we leave non-matching {…} as-is rather than throw.
    return text.replace(/\{(\w+)\}/g, (match, key: string) => {
      if (key in variables) {
        const v = variables[key];
        return v == null ? '' : String(v);
      }
      return match;
    });
  }
}

let cachedLoader: PromptLoader | null = null;
function getLoader(): PromptLoader {
  if (!cachedLoader) cachedLoader = new PromptLoader();
  return cachedLoader;
}

export function getPrompt(promptId: string, variables: Record<string, unknown> = {}): string {
  return getLoader().get(promptId, variables);
}

export function getSkill(name: string): string | null {
  return getLoader().getSkill(name);
}

export function listSkills(skipHidden = false): Record<string, string> {
  return getLoader().listSkills(skipHidden);
}
