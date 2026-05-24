// Single source of truth for chat-engine selection.
//
// One number unifies three concepts that used to be coupled to the literal
// string `'2'` scattered across the chat routes:
//   - the URL `?v=` param,
//   - the conversation file's `meta.version`,
//   - the engine itself (1 = legacy, 2 = JS orchestrator).
//
// A request's version comes from `?v=`; explicit `v=1` / `v=2` always win,
// and an absent / empty / unrecognized value falls back to
// `DEFAULT_CHAT_VERSION`. Flip that one constant to change the default engine
// for everyone (or to roll back) — nothing else needs to move.
//
// Pure module: no React / Next imports, so it is safe to use from both client
// hooks and server route handlers.

export type ChatVersion = 1 | 2;

/**
 * The engine used when the URL carries no explicit `?v=` override.
 * 2 = JS orchestrator (default); 1 = legacy.
 */
export const DEFAULT_CHAT_VERSION: ChatVersion = 2;

/**
 * Resolve the chat version for a request from its `?v=` param value.
 * Explicit `'1'` / `'2'` win; anything else falls back to the default.
 */
export function resolveChatVersion(v: string | null | undefined): ChatVersion {
  if (v === '1') return 1;
  if (v === '2') return 2;
  return DEFAULT_CHAT_VERSION;
}

/** Convenience: does this `?v=` value select the v2 (JS orchestrator) engine? */
export function isV2(v: string | null | undefined): boolean {
  return resolveChatVersion(v) === 2;
}
