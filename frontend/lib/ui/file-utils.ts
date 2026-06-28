import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PublishFileResult as SaveResult } from '@/lib/api/file-state';
import { FileId } from '@/store/filesSlice';
import { slugify } from '@/lib/slug-utils';
import type { FileType } from '@/lib/ui/file-metadata';

/**
 * Redirect to the file detail page after save if the URL needs updating.
 * All files now have real positive IDs from creation, so we only redirect
 * when the name/slug changes.
 */
export function redirectAfterSave(
  result: SaveResult | undefined,
  fileId: FileId | undefined,
  router: AppRouterInstance
): void {
  if (!result || !fileId) return;

  const slug = slugify(result.name);
  const newUrl = `/f/${result.id}-${slug}`;
  const currentUrl = window.location.pathname;

  if (currentUrl !== newUrl) {
    router.replace(newUrl);
  }
}

/**
 * Whether a file has enough content to auto-generate a title/description from.
 * Used to hide the "✨ Auto" affordance on a blank file (e.g. a new question with
 * no SQL, an empty dashboard) where there's nothing to summarize.
 *
 * Checks the content signals that carry meaning across the user file types:
 *   - question  → a non-empty SQL `query`
 *   - dashboard / report → at least one `asset`
 *   - notebook / report  → at least one `cell`
 */
export function hasGeneratableContent(_fileType: string, content: unknown): boolean {
  const c = content as Record<string, unknown> | undefined | null;
  if (!c) return false;
  if (typeof c.query === 'string' && c.query.trim() !== '') return true;
  if (Array.isArray(c.assets) && c.assets.length > 0) return true;
  if (Array.isArray(c.cells) && c.cells.length > 0) return true;
  return false;
}

/**
 * Edit-mode breadcrumb banner.
 *
 * Some file types have a *distinct* edit state worth signalling with a colored
 * breadcrumb banner (a dashboard's canvas / a story's document switch into an
 * editing mode). Others — questions, notebooks — are effectively always in an
 * editing state, so a banner would be noise. To add a type, extend the label map.
 */
const EDIT_BANNER_COLOR = 'accent.primary/90'; // Belize Hole blue @ 90%
const EDIT_BANNER_LABELS = {
  dashboard: 'Editing Dashboard',
  story: 'Editing Story',
  context: 'Editing Knowledge Base',
} as const satisfies Partial<Record<FileType, string>>;

/** File types that show an edit-mode banner (single source of truth). */
export const EDIT_BANNER_TYPES: ReadonlySet<FileType> = new Set(
  Object.keys(EDIT_BANNER_LABELS) as FileType[]
);

export interface EditModeBanner {
  color: string;
  label: string;
}

/**
 * Returns the breadcrumb banner for a file in edit mode, or null when the file
 * isn't editing or its type doesn't warrant a banner.
 */
export function getEditModeBanner(
  fileType: FileType | string,
  isEditing: boolean
): EditModeBanner | null {
  if (!isEditing) return null;
  const label = (EDIT_BANNER_LABELS as Record<string, string>)[fileType];
  if (!label) return null;
  return { color: EDIT_BANNER_COLOR, label };
}
