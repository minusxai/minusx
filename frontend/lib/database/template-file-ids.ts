/**
 * Canonical file path → ID map, derived directly from workspace-template.json.
 *
 * workspace-template.json is the single source of truth for file IDs.
 * The template defines canonical IDs — id=107 always means /org/database/static.
 *
 * Do NOT hardcode IDs elsewhere. Use this map instead.
 */
import workspaceTemplate from './workspace-template.json';

export const TEMPLATE_FILE_IDS: Record<string, number> = Object.fromEntries(
  (workspaceTemplate.documents as { path: string; id: number }[])
    .map((doc) => [doc.path, doc.id])
);
