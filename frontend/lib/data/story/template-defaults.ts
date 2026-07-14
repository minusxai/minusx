/**
 * Pure, client-safe structural defaults for new files — the single source of
 * truth for "what an empty <type> looks like". Reused by the server `getTemplate`
 * (which layers on dynamic bits: a suggested connection for questions, computed
 * schema for contexts) and by client-side validation, so neither has to fetch a
 * template over the network just to know the shape.
 *
 * `context` is intentionally omitted — its content is fully server-derived
 * (whitelist → schema) and can't be produced purely.
 */
import type {
  FileType, BaseFileContent, QuestionContent, DocumentContent, StoryContent, NotebookContent, ConnectionContent,
} from '@/lib/types';

export function getTemplateDefaults(type: FileType, options?: { query?: string }): BaseFileContent | undefined {
  switch (type) {
    case 'question':
      return {
        description: '',
        query: options?.query || '',
        // Viz Arch V2 §21 item 3: new questions are V2 — an authoritative `viz` envelope
        // (a DOM-tier table) renders + edits through the V2 pipeline. The `vizSettings`
        // placeholder stays only because the schema still requires it (`viz` overrides it);
        // item 5 drops the field and makes `viz` required.
        viz: { version: 2, source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null } },
        vizSettings: { type: 'table' },
        parameters: [],
        connection_name: '',
      } as QuestionContent;
    case 'dashboard':
      return { description: '', assets: [], layout: { columns: 12, items: [] } } as DocumentContent;
    case 'story':
      // Empty body is `''` (not null) so it surfaces as an editable `<story></story>` tag in the
      // agent markup (consistent with `<description></description>`); `assets` is legacy (not in
      // StoryContent — the body is the source of truth) so it's omitted.
      return { description: '', story: '' } as StoryContent;
    case 'notebook':
      return { description: '', cells: [] } as NotebookContent;
    case 'connection':
      return { type: 'bigquery', config: {} } as ConnectionContent;
    case 'folder':
      return { description: '' };
    default:
      return undefined; // context (server-derived) + any unknown type
  }
}
