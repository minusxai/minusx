// What the AGENT sees + may edit on a context file.
//
// A context is STORED version-based: { versions: [{ whitelist, docs, metrics, annotations, … }],
// published, skills, evals } plus server-COMPUTED menus the loader re-hydrates each read
// (fullSchema / parentSchema / fullDocs / fullMetrics / fullAnnotations / fullSkills). The version
// machinery and the multi-MB schema cache are noise to the agent. These helpers project the live
// (published) version's KNOWLEDGE LAYER (docs/metrics/annotations) + the content-level evals/skills
// into a single FLAT working view — the surface the agent reads/edits as markup (schema =
// ContextAgentContent) — and fold its edits back into the live version on the way out.
//
// The `whitelist` (which tables/columns are exposed) is intentionally NOT in the agent's view: it's
// a human concern (the Databases-tab picker). The agent instead gets the resolved, already-
// whitelisted schema as read-only app-state context and documents on top of it. The flat view is
// symmetric across read (compressFileState / buildCurrentFileStr) and write (editFileStr) so an
// oldMatch copied from one matches the other.

import { immutableSet } from '@/lib/utils/immutable-collections';
import { getPublishedVersion } from '@/lib/context/context-utils';
import type {
  ContextContent, ContextVersion, DocEntry, MetricDef, TableAnnotation, TableRelationship, SkillEntry, Test,
} from '@/lib/types';

/**
 * The live version for the agent: the published version, falling back to the first version when the
 * published pointer is missing or points at a version that no longer exists ("none or all" → first).
 */
function liveVersion(content: ContextContent): ContextVersion | undefined {
  const versions = content.versions;
  if (!versions || versions.length === 0) return undefined;
  const target = getPublishedVersion(content);
  return versions.find((v) => v.version === target) ?? versions[0];
}

/**
 * Shape a context's stored content into the agent's FLAT working view:
 *   - docs + metrics + annotations from the live version,
 *   - evals + skills from the content level.
 * ALL FIVE authored fields are ALWAYS present (defaulting to `[]` when absent) so the agent always
 * sees the full surface it can author — an empty `metrics`/`annotations`/`skills`/`evals` renders as
 * an empty `<tag/>`, signalling "you may add these" rather than vanishing.
 * Everything else — the whitelist, versions[], published, the schedule/recipient eval-job fields, and
 * the server-computed menus (fullSchema/parentSchema/full*) — is dropped: it's the human-managed
 * whitelist, version bookkeeping, or re-derived on load, none of it agent-authored. Returns a fresh
 * object; never mutates the input. No-op for non-context content (returned unchanged).
 */
export function shapeContextForAgent<T>(content: T): T {
  if (!content || typeof content !== 'object') return content;
  const c = content as unknown as ContextContent;
  // Distinguish "a context" from arbitrary content: a context always carries versions/published.
  if (!Array.isArray(c.versions) && c.published === undefined) return content;

  const live = liveVersion(c);
  const view: Record<string, unknown> = {
    docs: live?.docs ?? [],
    metrics: live?.metrics ?? [],
    annotations: live?.annotations ?? [],
    relationships: live?.relationships ?? [],
    skills: c.skills ?? [],
    evals: c.evals ?? [],
  };
  return view as T;
}

/**
 * Fold an edited flat agent view back into the stored (version-based) content: the live version's
 * authored knowledge fields (docs/metrics/annotations) and the content-level evals/skills are
 * overwritten from `edited`; the version's whitelist, versions[], published, and every other stored
 * field are preserved from `existing` (the whitelist isn't in the agent's view, so it's never
 * touched). Only keys actually present in `edited` are applied, so an edit that touches one field
 * leaves the rest of the live version intact. Mirrors {@link shapeContextForAgent}.
 */
export function foldContextAgentView(existing: unknown, edited: unknown): Record<string, unknown> {
  const base = (existing && typeof existing === 'object' ? existing : {}) as ContextContent;
  const e = (edited && typeof edited === 'object' ? edited : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) };

  const versions = base.versions ?? [];
  if (versions.length > 0) {
    const target = getPublishedVersion(base);
    let liveIdx = versions.findIndex((v) => v.version === target);
    if (liveIdx < 0) liveIdx = 0;
    const v: ContextVersion = { ...versions[liveIdx] };
    if ('docs' in e) v.docs = (e.docs ?? []) as DocEntry[];
    if ('metrics' in e) v.metrics = e.metrics as MetricDef[] | undefined;
    if ('annotations' in e) v.annotations = e.annotations as TableAnnotation[] | undefined;
    if ('relationships' in e) v.relationships = e.relationships as TableRelationship[] | undefined;
    const next = versions.slice();
    next[liveIdx] = v;
    out.versions = next;
  }
  if ('skills' in e) out.skills = e.skills as SkillEntry[];
  if ('evals' in e) out.evals = e.evals as Test[];
  return out;
}

// Server-computed fields: re-derived on load, stripped on save — ignore them when bounding edits.
// `fullSemanticModels` is computed like fullViews. NOTE: `semanticModels` is deliberately NOT in
// EDITABLE_VERSION_FIELDS yet — agent write access lands in M5a together with
// skill_semantic_models and the tier-2/3 save gates (Semantic_Model_v2.md).
const COMPUTED_CONTEXT_FIELDS = immutableSet([
  'fullSchema', 'parentSchema', 'fullDocs', 'fullMetrics', 'fullAnnotations', 'fullRelationships', 'fullViews', 'fullSemanticModels', 'fullSkills',
]);
// Version fields the agent authors (folded into the live version) — ignore when bounding edits.
// `whitelist` is NOT here: it's not in the agent's view, so the guard treats any whitelist change as
// out of bounds (the fold preserves it, so a legitimate edit never trips this).
const EDITABLE_VERSION_FIELDS = immutableSet(['docs', 'metrics', 'annotations', 'relationships']);
// Content-level fields the agent authors — ignore when bounding edits.
const EDITABLE_CONTENT_FIELDS = immutableSet(['evals', 'skills']);

/** Drop the editable + computed fields, leaving only the fields an EditFile must NOT touch. */
function contextEditInvariant(content: unknown): unknown {
  if (!content || typeof content !== 'object') return content;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(content as Record<string, unknown>)) {
    if (COMPUTED_CONTEXT_FIELDS.has(k) || EDITABLE_CONTENT_FIELDS.has(k) || k === 'docs') continue;
    out[k] = val;
  }
  if (Array.isArray(out.versions)) {
    out.versions = (out.versions as Record<string, unknown>[]).map((v) => {
      const vv: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (EDITABLE_VERSION_FIELDS.has(k)) continue;
        vv[k] = val;
      }
      return vv;
    });
  }
  return out;
}

/**
 * True if an EditFile on a context changed ONLY the authored fields — the live version's
 * whitelist/docs/metrics/annotations and the content-level evals/skills. Version identity and the
 * published pointer must be unchanged; the server-computed menus are ignored (re-derived on load, so
 * round-trip noise never false-rejects). Safety net atop the fold, which preserves structure anyway.
 */
export function contextEditWithinBounds(before: unknown, after: unknown): boolean {
  return JSON.stringify(contextEditInvariant(before)) === JSON.stringify(contextEditInvariant(after));
}
