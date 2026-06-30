// File-title helpers (shared, pure).
//
// A file's TITLE is its `name` metadata — NOT part of its content/markup. Content-bearing files
// (questions, dashboards, notebooks, stories, reports, alerts) should carry a short human title;
// folders/contexts get sensible default names and system files don't surface a title. These helpers
// decide when a title-bearing file is effectively untitled, so the agent can be told to set one
// (it edits markup, which never contains the title — the only way to set it is EditFile's `name`).

import { immutableSet } from '@/lib/utils/immutable-collections';
import { FILE_TYPE_METADATA, type FileType } from '@/lib/ui/file-metadata';

/** File types that surface a user-facing title the agent is expected to fill. */
const TITLE_BEARING_TYPES = immutableSet<FileType>([
  'question', 'dashboard', 'notebook', 'story', 'report', 'alert',
]);

/** Default placeholder names the UI treats as "no real title yet" (mirror of DocumentHeader). */
const PLACEHOLDER_NAMES = immutableSet([
  'new question', 'new dashboard', 'new notebook', 'new story', 'new story',
  'new report', 'new digest', 'new alert', 'untitled',
]);

export function isTitleBearingType(type: FileType): boolean {
  return TITLE_BEARING_TYPES.has(type);
}

/** True if a title-bearing file is effectively untitled (empty/whitespace or a default placeholder). */
export function isTitleMissing(type: FileType, name: string | null | undefined): boolean {
  if (!isTitleBearingType(type)) return false;
  const normalized = (name ?? '').trim().toLowerCase();
  return normalized === '' || PLACEHOLDER_NAMES.has(normalized);
}

/** Agent-facing feedback: tells it a title is missing AND how to set one (EditFile `name`). */
export function missingTitleFeedback(type: FileType): string {
  const label = FILE_TYPE_METADATA[type]?.label ?? type;
  return (
    `This ${label.toLowerCase()} has no title. Give it a short, descriptive title by calling ` +
    `EditFile with the "name" field (e.g. {"fileId": <id>, "name": "Revenue Overview"}). ` +
    `The title is the file's metadata — it is NOT part of the markup, so EditFile's name is the only way to set it.`
  );
}
