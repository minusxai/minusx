/**
 * Single source of truth for "what queries does this file run directly".
 *
 * Returns every INLINE (query, connection) pair a file executes itself — its own
 * SQL, with NO file id of its own. Saved CROSS-FILE references are intentionally
 * NOT here: those live in the file's `references` column (populated by
 * `extractReferencesFromContent`) and are resolved by loading the referenced
 * question files. Together, `extractInlineFileQueries` + `references` describe
 * the complete set of queries a page can run — which is exactly the allowlist a
 * public-share guest is confined to (see lib/query-cache/guest-query.server.ts).
 *
 * Pure + client-safe (no DB, no Redux). Per-type unit tests in
 * lib/data/__tests__/file-queries.test.ts.
 */
import type { FileType, QuestionContent, NotebookContent } from '@/lib/types';
import { extractInlineQuestions } from '@/lib/data/story/story-question';
import { extractInlineNumbers } from '@/lib/data/story/story-number';

export interface FileQueryRef {
  query: string;
  connection: string;
}

export function extractInlineFileQueries(type: FileType, content: unknown): FileQueryRef[] {
  if (!content || typeof content !== 'object') return [];

  switch (type) {
    case 'question': {
      const c = content as QuestionContent;
      return c.query && typeof c.connection_name === 'string'
        ? [{ query: c.query, connection: c.connection_name }]
        : [];
    }

    case 'story': {
      const html = (content as { story?: string | null }).story ?? null;
      const out: FileQueryRef[] = [];
      // Inline <Question query> + <Number query> embeds carry their own SQL.
      for (const e of extractInlineQuestions(html)) {
        if (e.query && e.connection) out.push({ query: e.query, connection: e.connection });
      }
      for (const e of extractInlineNumbers(html)) {
        if (e.query && e.connection) out.push({ query: e.query, connection: e.connection });
      }
      return out;
    }

    case 'notebook': {
      const cells = (content as NotebookContent).cells ?? [];
      const out: FileQueryRef[] = [];
      for (const cell of cells) {
        if (cell.type === 'sql' && cell.query && typeof cell.connection_name === 'string') {
          out.push({ query: cell.query, connection: cell.connection_name });
        }
      }
      return out;
    }

    // dashboard: no inline SQL — its tiles are SAVED question references (handled
    // via `references`). Other types (folder/connection/context/…) run no query.
    default:
      return [];
  }
}
