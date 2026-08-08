/**
 * The agent-facing projection of resolved viz recipes: the compact "Chart
 * Recipes" prompt section. Individual recipes are advertised HERE (per-turn,
 * resolved for the turn anchor's folder) and never hard-coded in prompts.yaml —
 * the skill teaches the mechanism, this carries the live catalog.
 */
import type { VizRecipeBinding, VizRecipeContent, VizRecipeParam } from '@/lib/validation/atlas-schemas';
import type { ResolvedVizRecipe } from './recipe-resolve';

/** One advertised recipe: identity + what the agent needs to bind it. */
export interface AgentVizRecipeInfo {
  /** The name a reference uses (basename / built-in key). */
  name: string;
  /** File path for workspace recipes (ReadFiles/EditFile target); absent for built-ins. */
  path?: string;
  description: string;
  bindings: Array<Pick<VizRecipeBinding, 'name' | 'label' | 'accepts' | 'multi'>>;
  params?: Array<Pick<VizRecipeParam, 'name' | 'label' | 'default'>>;
}

/** Project a resolved recipe + its loaded content into the advertised shape. */
export function toAgentVizRecipeInfo(resolved: ResolvedVizRecipe, content: VizRecipeContent): AgentVizRecipeInfo {
  return {
    name: resolved.name,
    ...(resolved.source === 'file' ? { path: resolved.path } : {}),
    description: content.description,
    bindings: content.bindings.map((b) => ({ name: b.name, label: b.label, accepts: b.accepts, ...(b.multi ? { multi: true } : {}) })),
    ...(content.params?.length ? { params: content.params.map((p) => ({ name: p.name, label: p.label, default: p.default })) } : {}),
  };
}

const slotLine = (b: AgentVizRecipeInfo['bindings'][number]): string =>
  `${b.name} [${b.accepts.join('|')}${b.multi ? ', multi' : ''}]`;

/**
 * Render the prompt section. Substituted as a pyFormat VALUE (never re-scanned),
 * so braces in descriptions are safe. Empty input renders to '' — the section
 * disappears rather than showing an empty header.
 */
export function formatVizRecipesSection(recipes: AgentVizRecipeInfo[]): string {
  if (recipes.length === 0) return '';
  const lines = recipes.map((r) => {
    const slots = r.bindings.map(slotLine).join(', ');
    const params = r.params?.length ? `; params: ${r.params.map((p) => p.name).join(', ')}` : '';
    const path = r.path ? ` (file: ${r.path})` : '';
    return `- **${r.name}**${path} — ${r.description}. Slots: ${slots}${params}`;
  });
  return [
    '## Chart Recipes',
    'Reusable workspace chart templates, resolved for the current folder. Apply one to a question by authoring its viz envelope as a recipe source — `"source": {"kind": "recipe", "recipe": "<name>", "bindings": {"<slot>": "<result column>"}}` — and rendering substitutes the recipe live (recipe edits restyle every referencing chart). Load the `viz_recipes` skill before authoring or editing recipe files.',
    ...lines,
  ].join('\n');
}
