
import { randomBytes } from 'crypto';
import type { Static, TSchema } from 'typebox';
import type { Api, AssistantMessage, ImageContent, TextContent, Usage } from '@/orchestrator/llm';
import { Convert, Default, Errors, Check } from 'typebox/value';

export function gen_id(): string {
  return `mxgen_${randomBytes(12).toString('hex')}`;
}

export const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * Coerce *stringified* tool-call arguments back to their schema's types. Models
 * occasionally emit arguments with every value stringified — even on the native
 * Anthropic API — e.g. `{ fileIds: "[2158]", maxChars: "3000", runQueries:
 * "false" }` instead of `{ fileIds: [2158], maxChars: 3000, runQueries: false }`.
 * Left un-coerced these are stored verbatim in the conversation log and handed to
 * tools, which then crash (e.g. a chat display calling `args.fileIds.map(...)` on
 * a string).
 *
 * Deliberately narrow: only acts when a value is a **string** but its schema
 * expects a non-string type (array, object, number, integer, boolean). Such a
 * value is `JSON.parse`d (`"[2158]"` → `[2158]`, `"3000"` → `3000`, `"false"` →
 * `false`), then `Convert`ed against the property schema to fix nested primitives
 * (`["7","8"]` → `[7, 8]`). Everything else is left untouched — a genuine
 * wrong-type arg (e.g. a number passed to a string field, or a missing required
 * field) still fails validation and surfaces as a recoverable tool error, rather
 * than being silently coerced.
 */
export function coerceParameters<T extends TSchema>(
  schema: T,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const props = (schema as { properties?: Record<string, TSchema> }).properties ?? {};
  const out: Record<string, unknown> = { ...parameters };
  for (const key of Object.keys(out)) {
    const value = out[key];
    const prop = props[key];
    if (typeof value !== 'string' || !prop) continue;
    if (!/"type":"(array|object|number|integer|boolean)"/.test(JSON.stringify(prop))) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      continue; // Not valid JSON — leave the string for validation to reject.
    }
    out[key] = Convert(prop, parsed);
  }
  return out;
}

export function normalizeParameters<T extends TSchema>(
  schema: T,
  parameters: Record<string, unknown>,
): Static<T> {
  return Default(schema, coerceParameters(schema, parameters)) as Static<T>;
}

export type ParameterValidation<T extends TSchema> =
  | { ok: true; value: Static<T> }
  | { ok: false; errors: string[] };

export function validateParameters<T extends TSchema>(
  schema: T,
  parameters: Record<string, unknown>,
): ParameterValidation<T> {
  const withDefaults = Default(schema, coerceParameters(schema, parameters));
  if (Check(schema, withDefaults)) {
    return { ok: true, value: withDefaults as Static<T> };
  }
  const errors: string[] = [];
  for (const e of Errors(schema, withDefaults)) {
    const path = (e as { path?: string }).path;
    const prefix = path && path.length > 0 ? path : '/';
    errors.push(`${prefix}: ${e.message}`);
  }
  return { ok: false, errors };
}

export function synthErrorAssistantMessage(
  errorMessage: string,
  extra?: Partial<AssistantMessage>,
): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: errorMessage }],
    api: 'unknown' as Api,
    provider: 'unknown',
    model: 'unknown',
    usage: EMPTY_USAGE,
    stopReason: 'error',
    errorMessage,
    timestamp: Date.now(),
    ...extra,
  };
}

/**
 * A user-message attachment as stored on an invocation's context — the structural
 * shape of the agents' `AgentAttachment` (the orchestrator stays decoupled from
 * agent modules, so the shape is declared here and agents' type must conform).
 */
export interface UserTurnAttachment {
  type: 'image' | 'text';
  data?: string;
  mimeType?: string;
  url?: string;
  name?: string;
  content?: string;
  pages?: number;
}

/**
 * Build a user turn's content blocks from its message + attachments: text
 * attachments as `<Attachment …>` blocks first, then message images, attachment
 * images, and finally the goal text. The SINGLE builder for both the current
 * turn (agents' `buildUserContent`) and prior turns rebuilt from the log
 * (`projectRootThreadHistory`) — prior turns must render user attachments too,
 * or the model loses access to an image the user sent one turn earlier.
 */
export function buildUserTurnContent(
  userMessage: string | (TextContent | ImageContent)[],
  attachments: UserTurnAttachment[] = [],
): (TextContent | ImageContent)[] {
  const items: (TextContent | ImageContent)[] =
    typeof userMessage === 'string' ? [{ type: 'text', text: userMessage }] : userMessage;

  const msgImages = items.filter((c): c is ImageContent => c.type === 'image');
  const goal = items
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

  const attachmentImages: ImageContent[] = attachments
    .filter((a): a is UserTurnAttachment & { type: 'image' } => a.type === 'image')
    .map((a) => (a.url ? { type: 'image', url: a.url } : { type: 'image', data: a.data ?? '', mimeType: a.mimeType ?? 'image/png' }));
  const textAttachments = attachments
    .filter((a): a is UserTurnAttachment & { type: 'text' } => a.type === 'text')
    .map((a) => {
      const header = `[${a.name ?? 'attachment'}]` + (a.pages ? ` (${a.pages} pages)` : '');
      return `<Attachment ${header}>\n${a.content ?? ''}\n</Attachment>`;
    })
    .join('\n');

  const blocks: (TextContent | ImageContent)[] = [];
  if (textAttachments) blocks.push({ type: 'text', text: textAttachments });
  blocks.push(...msgImages, ...attachmentImages, { type: 'text', text: goal });
  return blocks;
}
