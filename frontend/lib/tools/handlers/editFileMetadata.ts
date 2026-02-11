/**
 * EditFileMetadata Tool Handler (Phase 5)
 * Handles editing file name/path without modifying content
 */

import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { DocumentDB } from '@/lib/database/documents-db';
import { canAccessFile } from '@/lib/data/helpers/permissions';
import { slugify } from '@/lib/slug-utils';

interface EditFileMetadataArgs {
  file_id: number;
  new_name?: string;
  new_path?: string;
}

/**
 * Handle EditFileMetadata tool execution
 * Updates file name and/or path without touching content
 */
export async function handleEditFileMetadata(
  args: EditFileMetadataArgs,
  user: EffectiveUser
): Promise<string> {
  const { file_id, new_name, new_path } = args;

  // Validate inputs
  if (!new_name && !new_path) {
    return JSON.stringify({
      success: false,
      error: 'Must provide either new_name or new_path (or both)'
    });
  }

  try {
    // Load file (metadata only, no need for content)
    const file = await DocumentDB.getById(file_id, user.companyId, false);

    if (!file) {
      return JSON.stringify({
        success: false,
        error: `File with ID ${file_id} not found`
      });
    }

    // Check permissions
    if (!canAccessFile(file, user)) {
      return JSON.stringify({
        success: false,
        error: 'You do not have permission to edit this file'
      });
    }

    // Determine final name and path
    let finalName = new_name || file.name;
    let finalPath = new_path;

    // If only name is provided (no path), rename in current folder
    if (new_name && !new_path) {
      const folderPath = file.path.substring(0, file.path.lastIndexOf('/'));
      const slugifiedName = slugify(finalName);
      finalPath = `${folderPath}/${slugifiedName}`;
    }

    // If only path is provided (no name), keep current name
    if (!new_name && new_path) {
      finalPath = new_path;
      finalName = file.name;
    }

    // Update metadata
    const success = await DocumentDB.updateMetadata(
      file_id,
      finalName,
      finalPath!,
      user.companyId
    );

    if (!success) {
      return JSON.stringify({
        success: false,
        error: 'Failed to update file metadata'
      });
    }

    return JSON.stringify({
      success: true,
      message: `Updated file: "${finalName}" at ${finalPath}`,
      file_id,
      name: finalName,
      path: finalPath
    });
  } catch (error) {
    console.error('[EditFileMetadata] Error:', error);
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
}
