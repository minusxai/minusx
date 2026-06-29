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
   * Rough characters-per-token ratio used to convert token budgets to the char
   * budgets the renderers actually measure in. ~4 is the usual English/code
   * approximation for the Anthropic tokenizer. Use `tokensToChars()` rather than
   * multiplying inline.
   */
  charsPerToken: 4,

  /**
   * Per-document cap, in TOKENS, for an inlined context doc's body. Docs longer
   * than this are truncated with a "load the full doc via LoadContext" pointer.
   * Keeps one verbose doc from dominating the prompt. Applied by
   * `renderResolvedDocInline` (converted to chars via `tokensToChars`).
   */
  perDocTokens: 1000,

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
   * Max characters of a context's `parentSchema` (the menu of tables available to
   * whitelist) shown in the agent's edit markup. Graceful degradation by
   * `shapeContextForAgent`: under budget → keep tables WITH columns; over →
   * names only; still over → cap table names + a "use SearchDBSchema" note.
   */
  contextParentSchemaChars: 20000,

  /**
   * Inline EVERY context doc when there are fewer than this many; at/above it,
   * non-`alwaysInclude` docs move to the lazy "Context Library" catalog (fetched
   * on demand via LoadContext). Applied by `formatContextDocsSection`.
   */
  inlineAllDocsThreshold: 1,
} as const;

/** Convert a token budget to its approximate character budget (rounded). */
export const tokensToChars = (tokens: number): number =>
  Math.round(tokens * CONTEXT_BUDGETS.charsPerToken);

/**
 * Per-document content cap in CHARACTERS (derived from `perDocTokens`). Single
 * source for BOTH the editor (which shows the count + blocks save over it) and
 * the prompt renderer (which truncates over it as a safety net). Tweak
 * `perDocTokens` above to move both.
 */
export const PER_DOC_CONTENT_CHARS = tokensToChars(CONTEXT_BUDGETS.perDocTokens);

/** True when a single doc's content exceeds the per-doc character cap. The editor
 *  shows the count + blocks save on this; the renderer truncates on it. */
export const isDocContentOverLimit = (content: string): boolean =>
  content.length > PER_DOC_CONTENT_CHARS;

/**
 * Max characters a pasted blob may have before the chat composer converts it into a
 * text-attachment chip instead of inserting it inline. Pasting 1000s of lines into
 * the Lexical editor bogs the whole app down; chipping large pastes keeps the
 * composer snappy while the content still reaches the agent as an attachment.
 *
 * Applied by the chat input paste handler (`lib/chat/paste-attachment.ts`, wired
 * through `components/chat/LexicalMentionEditor.tsx` PastePlugin →
 * `components/explore/ChatInput.tsx`). Lives here alongside the other char budgets
 * so all the tuning knobs sit in one dashboard.
 */
export const PASTED_TEXT_ATTACHMENT_CHARS = 2000;

/** True when a pasted text blob exceeds the inline limit and should become an attachment. */
export const isPastedTextOverLimit = (text: string): boolean =>
  text.length > PASTED_TEXT_ATTACHMENT_CHARS;
