/**
 * The Capitalized component names allowed in a `jsx` body (File Architecture v2) — anything
 * else Capitalized is rejected by the static validator. `<Question/>` embeds in a story body
 * are the only one today; lowercase tags are HTML (sanitized at render via AgentHtml).
 */
export const JSX_COMPONENT_NAMES = ['Question', 'Param'] as const;
