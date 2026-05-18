import 'server-only';

import { Type, type Static } from '@mariozechner/pi-ai';
import { Check } from 'typebox/value';

/**
 * Structured output schema for `AutoContextAgent`. The agent emits a final
 * assistant text block of the form `<AutoContext>{...}</AutoContext>`; the
 * parent parses the tag and validates the JSON against this schema.
 */
export const AutoContextPayloadSchema = Type.Object({
  tables: Type.Array(
    Type.Object({
      connection: Type.String(),
      schema: Type.String(),
      table: Type.String(),
      tableNote: Type.String(),
      columns: Type.Array(
        Type.Object({
          name: Type.String(),
          note: Type.String(),
        }),
      ),
      joins: Type.Array(
        Type.Object({
          fromColumn: Type.String(),
          toTable: Type.String(),
          toColumn: Type.String(),
          evidence: Type.String(),
        }),
      ),
    }),
  ),
  examples: Type.Array(
    Type.Object({
      description: Type.String(),
      connection: Type.String(),
      query: Type.String(),
      rows: Type.Array(Type.Record(Type.String(), Type.Unknown())),
    }),
  ),
});

export type AutoContextPayload = Static<typeof AutoContextPayloadSchema>;

/**
 * Extract the JSON inside `<AutoContext>...</AutoContext>` and validate
 * against the payload schema. Returns the parsed payload or `null` if the
 * tag is missing / JSON is malformed / shape doesn't match.
 */
export function parseAutoContextPayload(text: string): AutoContextPayload | null {
  const match = /<AutoContext>([\s\S]*?)<\/AutoContext>/i.exec(text);
  if (!match) return null;
  const jsonText = match[1].trim();
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!Check(AutoContextPayloadSchema, raw)) return null;
  return raw as AutoContextPayload;
}
