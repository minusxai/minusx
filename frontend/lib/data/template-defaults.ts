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
  FileType, BaseFileContent, QuestionContent, DocumentContent, StoryContent, ConnectionContent,
} from '@/lib/types';

export function getTemplateDefaults(type: FileType, options?: { query?: string }): BaseFileContent | undefined {
  switch (type) {
    case 'question':
      return {
        description: '',
        query: options?.query || '',
        vizSettings: { type: 'table' },
        parameters: [],
        connection_name: '',
      } as QuestionContent;
    case 'dashboard':
      return { description: '', assets: [], layout: { columns: 12, items: [] } } as DocumentContent;
    case 'story':
      return { description: '', assets: [], story: null } as StoryContent;
    case 'presentation':
      return {
        description: '',
        assets: [],
        layout: { canvasWidth: 1280, canvasHeight: 720, slides: [{ rectangles: [], arrows: [] }] },
      } as DocumentContent;
    case 'connection':
      return { type: 'bigquery', config: {} } as ConnectionContent;
    case 'folder':
      return { description: '' };
    default:
      return undefined; // context (server-derived) + any unknown type
  }
}
