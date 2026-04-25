import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PublishFileResult as SaveResult } from '@/lib/api/file-state';
import { FileId } from '@/store/filesSlice';
import { slugify } from '@/lib/slug-utils';

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
