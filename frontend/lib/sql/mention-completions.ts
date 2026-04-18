/**
 * Mention completions for chat interface.
 * Ported from Python get_mention_completions (backend/sql_utils/autocomplete.py).
 * Pure string matching — no SQL parsing needed.
 */
import type { DatabaseWithSchema } from '@/lib/types';
import type { MentionItem } from '@/lib/data/completions/types';

export interface AvailableQuestion {
  id: number;
  name: string;
  alias: string;
  type: 'question' | 'dashboard';
}

/**
 * Get mention suggestions for chat interface.
 *
 * @param prefix - Text after @ or @@ symbol
 * @param schemaData - Database schema information
 * @param availableQuestions - List of available questions and dashboards
 * @param mentionType - "all" (@ — tables + questions) or "questions" (@@ — questions only)
 */
export function getMentionCompletionsLocal(
  prefix: string,
  schemaData: DatabaseWithSchema[],
  availableQuestions: AvailableQuestion[],
  mentionType: 'all' | 'questions',
): MentionItem[] {
  const suggestions: MentionItem[] = [];
  const prefixLower = prefix.toLowerCase();

  // Table mentions (only when mentionType is "all")
  if (mentionType === 'all' && schemaData.length > 0) {
    for (const db of schemaData) {
      for (const schema of db.schemas ?? []) {
        const schemaName = (schema as any).schema;
        for (const table of (schema as any).tables ?? []) {
          const tableName = table.table;
          const qualifiedName = `${schemaName}.${tableName}`;

          if (prefixLower && !(
            tableName.toLowerCase().startsWith(prefixLower) ||
            qualifiedName.toLowerCase().startsWith(prefixLower)
          )) {
            continue;
          }

          suggestions.push({
            id: undefined,
            name: tableName,
            schema: schemaName,
            type: 'table',
            display_text: tableName,
            insert_text: `@${schemaName}.${tableName}`,
          });
        }
      }
    }
  }

  // Question/dashboard mentions
  for (const q of availableQuestions) {
    if (prefixLower && !(
      q.name.toLowerCase().startsWith(prefixLower) ||
      q.alias.toLowerCase().startsWith(prefixLower)
    )) {
      continue;
    }

    suggestions.push({
      id: q.id,
      name: q.name,
      schema: undefined,
      type: q.type,
      display_text: q.name,
      insert_text: `@@${q.alias}`,
    });
  }

  return suggestions;
}
