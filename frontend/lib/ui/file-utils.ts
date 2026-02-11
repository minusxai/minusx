import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SaveResult } from '@/lib/hooks/useFile';
import { FileId, isVirtualFileId } from '@/store/filesSlice';
import { slugify } from '@/lib/slug-utils';

/**
 * Redirect to the file detail page after save if needed
 *
 * Redirects when:
 * - Creating a new file (fileId is virtual)
 * - Name changed (resulting in different slug/URL)
 *
 * @param result - Save result containing id and name
 * @param fileId - Current file ID (to check if virtual)
 * @param router - Next.js router instance
 */
export function redirectAfterSave(
  result: SaveResult | undefined,
  fileId: FileId | undefined,
  router: AppRouterInstance
): void {
  if (!result || !fileId) return;

  // Generate the new URL with id and slugified name
  const slug = slugify(result.name);
  const newUrl = `/f/${result.id}-${slug}`;

  // Check if we need to redirect
  // Redirect if: (1) creating new file, or (2) name/slug changed
  const currentUrl = window.location.pathname;
  const isVirtual = isVirtualFileId(fileId);

  if (isVirtual || currentUrl !== newUrl) {
    router.push(newUrl);
  }
}
