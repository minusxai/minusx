/**
 * CONTEXT BUDGETS — one place for every tuning knob that controls how much of a
 * context is rendered into the agent prompt (and the docs sidebar).
 *
 * The *logic* that applies these lives in the modules that own each concern
 * (schema TOC → `lib/chat/render-schema-prompt.ts`; schema notes + doc inlining
 * → `lib/sql/schema-filter.ts`). Only the *numbers* live here, so there's a
 * single dashboard to review/adjust them without hunting across files.
 *
 * Client-safe (plain constants, no `server-only`) — imported by both the
 * server-side prompt builders and the client `useContext` hook.
 *
 * When the agent hits one of these caps it is told what was dropped and how to
 * recover it (SearchDBSchema for schema/annotations, LoadContext for docs), so
 * raising/lowering a budget trades prompt size for upfront completeness, never
 * correctness.
 */
export const CONTEXT_BUDGETS = {
  /**
   * Max characters of the schema table-of-contents (schema → table names, no
   * columns) injected into the prompt before truncating with a "use
   * SearchDBSchema" pointer. Caps a rogue/large DB from filling the context.
   * Applied by `renderSchemaForPrompt`.
   */
  schemaTocChars: 6000,

  /**
   * Max characters of the context-authored "Tables & Columns" description block
   * in Schema Notes before truncating (whole-table blocks included greedily).
   * Applied by `budgetAnnotationNotes`.
   */
  schemaNotesChars: 20000,

  /**
   * Inline EVERY context doc when there are fewer than this many; at/above it,
   * non-`alwaysInclude` docs move to the lazy "Context Library" catalog (fetched
   * on demand via LoadContext). Applied by `formatContextDocsSection`.
   */
  inlineAllDocsThreshold: 1,
} as const;
