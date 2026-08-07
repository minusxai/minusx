/**
 * FILE-BASED viz recipes: workspace `.viz` documents holding an INERT spec template.
 *
 * A recipe file's content is a static Vega/Vega-Lite spec with `{{slot}}` string
 * tokens plus declared binding slots and params — data, never code (the shipped
 * registry in `viz-templates.ts` stays code and is unrelated to this module).
 *
 * File recipes are ALWAYS frozen at use ("materialize-always"): a chart stores the
 * fully substituted spec as a plain `vega`/`vega-lite` source with the recipe's file
 * path in `detachedFrom.recipe`. Shadowing (nearest ancestor wins by basename),
 * rename and delete are therefore authoring-time concerns only — the renderer never
 * resolves a file, and a deleted recipe degrades to custom-spec editing.
 *
 * Token rules (the whole substitution language — no structural branching):
 *  - `"{{slot}}"` as a WHOLE string value → replaced with the bound value verbatim
 *    (string, or array for multi slots — how a fold's field list is expressed).
 *  - `{{slot}}` EMBEDDED in a longer string → string-replaced (arrays are an error).
 *  - `"{{slot.kind}}"` → the bound column's resolved viz kind
 *    (`quantitative|temporal|nominal`) so a multi-kind slot gets the right encoding
 *    `"type"`; falls back to the slot's first `accepts` kind when columns are unknown.
 *  - Params substitute by the same rules; a declared `default` fills an omitted param.
 *  - Any other `{{token}}` is a hard error naming the token.
 */
import {
  VIZ_GRAMMAR_VEGA,
  VIZ_GRAMMAR_VEGA_LITE,
  type ColumnFormatConfig,
  type VizSourceVega,
  type VizSourceVegaLite,
} from '@/lib/validation/atlas-schemas';
import type { VizResultColumn } from './types';

/** Column kinds a slot may accept (drives drop-zone hints and dummy synthesis). */
export type VizRecipeAccepts = 'nominal' | 'quantitative' | 'temporal';

/** A declared binding slot. Every slot is required; `multi` slots take arrays. */
export interface VizRecipeBinding {
  name: string;
  label: string;
  accepts: ReadonlyArray<VizRecipeAccepts>;
  multi?: boolean;
}

/** A declared value-substituted knob. `default` fills an omitted param. */
export interface VizRecipeParam {
  name: string;
  label: string;
  default?: unknown;
}

/** The content of a `.viz` file. Identity is the FILE NAME — no name field here. */
export interface VizRecipeContent {
  /** One-liner advertised to the agent. */
  description: string;
  engine: 'vega-lite' | 'vega';
  bindings: VizRecipeBinding[];
  params?: VizRecipeParam[] | null;
  /** The spec with `{{slot}}` tokens. Everything visual lives here, in the grammar. */
  template: Record<string, unknown>;
}

export type FileRecipeMaterializeResult =
  | { ok: true; spec: Record<string, unknown>; engine: 'vega-lite' | 'vega' }
  | { ok: false; error: string };

/** The reference a chart freezes from: the recipe FILE PATH plus its bindings. */
export interface FileRecipeRef {
  path: string;
  bindings: Record<string, string | string[]>;
  params?: Record<string, unknown> | null;
  columnFormats?: Record<string, ColumnFormatConfig> | null;
}

export type FreezeFileRecipeResult =
  | { ok: true; source: VizSourceVegaLite | VizSourceVega }
  | { ok: false; error: string };

/**
 * Discriminates a file-recipe reference from a shipped registry id: file recipes
 * are addressed by absolute workspace path (`/org/funnel-pro`), shipped ones by
 * registry id (`minusx/funnel@1`).
 */
export function isFileRecipePath(recipe: string): boolean {
  return recipe.startsWith('/');
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const TOKEN_RE = /\{\{(\w+)(\.kind)?\}\}/g;
const WHOLE_TOKEN_RE = /^\{\{(\w+)(\.kind)?\}\}$/;

/** What a token may substitute to: `whole` is used verbatim, `embedded` inside strings. */
interface TokenValue {
  whole: unknown;
  embedded?: string;
}

function substituteNode(node: Json, values: Map<string, TokenValue>): Json {
  if (typeof node === 'string') {
    const whole = node.match(WHOLE_TOKEN_RE);
    if (whole) {
      const v = values.get(whole[1] + (whole[2] ?? ''));
      if (!v) throw new Error(`unknown token "{{${whole[1]}${whole[2] ?? ''}}}"`);
      return v.whole as Json;
    }
    return node.replace(TOKEN_RE, (_, name: string, kind: string | undefined) => {
      const v = values.get(name + (kind ?? ''));
      if (!v) throw new Error(`unknown token "{{${name}${kind ?? ''}}}"`);
      if (v.embedded === undefined) {
        throw new Error(`slot "${name}" holds multiple columns and can only be used as a whole value, not inside "${node}"`);
      }
      return v.embedded;
    });
  }
  if (Array.isArray(node)) return node.map((n) => substituteNode(n, values));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, substituteNode(v, values)]));
  }
  return node;
}

/** Resolve a bound column's viz kind for `{{slot.kind}}` — encoding-type vocabulary only. */
function kindOf(
  binding: VizRecipeBinding,
  bound: string | string[],
  columns: VizResultColumn[] | undefined,
): VizRecipeAccepts {
  const first = Array.isArray(bound) ? bound[0] : bound;
  const col = columns?.find((c) => c.name === first);
  if (col && (col.kind === 'quantitative' || col.kind === 'temporal' || col.kind === 'nominal')) return col.kind;
  if (col) return 'nominal'; // boolean/unknown render as discrete
  return binding.accepts[0] ?? 'nominal';
}

/**
 * Substitute bindings + params into the template. Pure; never mutates the input.
 * Returns the materialized spec or a message naming every problem slot/token.
 */
export function materializeFileRecipe(
  content: VizRecipeContent,
  bindings: Record<string, string | string[]>,
  params?: Record<string, unknown> | null,
  columns?: VizResultColumn[],
): FileRecipeMaterializeResult {
  const declaredParams = content.params ?? [];

  const names = new Set<string>();
  const dupes = [...content.bindings.map((b) => b.name), ...declaredParams.map((p) => p.name)]
    .filter((n) => (names.has(n) ? true : (names.add(n), false)));
  if (dupes.length > 0) {
    return { ok: false, error: `duplicate slot name${dupes.length > 1 ? 's' : ''}: ${dupes.join(', ')}` };
  }

  const empty = (v: string | string[] | undefined) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
  const missing = content.bindings.filter((b) => empty(bindings[b.name]));
  if (missing.length > 0) {
    return { ok: false, error: `missing binding${missing.length > 1 ? 's' : ''}: ${missing.map((b) => b.name).join(', ')}` };
  }
  const badMulti = content.bindings.find((b) => !b.multi && Array.isArray(bindings[b.name]));
  if (badMulti) {
    return { ok: false, error: `binding "${badMulti.name}" takes a single column, not an array` };
  }

  const unknownParams = Object.keys(params ?? {}).filter((n) => !declaredParams.some((p) => p.name === n));
  if (unknownParams.length > 0) {
    return {
      ok: false,
      error: `unknown param${unknownParams.length > 1 ? 's' : ''}: ${unknownParams.join(', ')}` +
        (declaredParams.length > 0 ? ` — declared: ${declaredParams.map((p) => p.name).join(', ')}` : ' — this recipe declares no params'),
    };
  }

  const values = new Map<string, TokenValue>();
  for (const b of content.bindings) {
    const bound = bindings[b.name]!;
    if (b.multi) {
      const list = Array.isArray(bound) ? bound : [bound];
      values.set(b.name, { whole: list }); // arrays never embed
    } else {
      values.set(b.name, { whole: bound, embedded: String(bound) });
    }
    values.set(`${b.name}.kind`, { whole: kindOf(b, bound, columns), embedded: kindOf(b, bound, columns) });
  }
  for (const p of declaredParams) {
    const v = params && p.name in params ? params[p.name] : p.default;
    values.set(p.name, { whole: (v ?? null) as Json, embedded: v == null ? '' : String(v) });
  }

  try {
    const spec = substituteNode(content.template as Json, values) as Record<string, unknown>;
    return { ok: true, spec, engine: content.engine };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Materialize and wrap as the frozen source a chart stores: `kind` from the
 * engine, pinned grammar, the substituted spec, and `detachedFrom` carrying the
 * full reference (recipe = file path) for re-materialization and panel binding.
 */
export function freezeFileRecipe(
  content: VizRecipeContent,
  ref: FileRecipeRef,
  columns?: VizResultColumn[],
): FreezeFileRecipeResult {
  const materialized = materializeFileRecipe(content, ref.bindings, ref.params, columns);
  if (!materialized.ok) return materialized;
  const detachedFrom = {
    kind: 'recipe' as const,
    recipe: ref.path,
    bindings: ref.bindings,
    params: ref.params ?? null,
    columnFormats: ref.columnFormats ?? null,
  };
  if (materialized.engine === 'vega') {
    return {
      ok: true,
      source: { kind: 'vega', grammar: VIZ_GRAMMAR_VEGA, spec: materialized.spec, assets: null, detachedFrom },
    };
  }
  return {
    ok: true,
    source: { kind: 'vega-lite', grammar: VIZ_GRAMMAR_VEGA_LITE, spec: materialized.spec, detachedFrom },
  };
}

/**
 * Synthesize placeholder bindings + matching columns from the declared slots, so
 * save-time validation can materialize a recipe with no real query in hand.
 */
export function synthesizeDummyBindings(content: VizRecipeContent): {
  bindings: Record<string, string | string[]>;
  columns: VizResultColumn[];
} {
  const bindings: Record<string, string | string[]> = {};
  const columns: VizResultColumn[] = [];
  const add = (slot: string, kind: VizRecipeAccepts, n?: number): string => {
    const name = `__dummy_${slot}${n != null ? `_${n}` : ''}`;
    columns.push({ name, kind });
    return name;
  };
  for (const b of content.bindings) {
    const kind = b.accepts[0] ?? 'nominal';
    bindings[b.name] = b.multi ? [add(b.name, kind, 1), add(b.name, kind, 2)] : add(b.name, kind);
  }
  return { bindings, columns };
}
