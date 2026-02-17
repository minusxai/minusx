import { useEffect, useMemo, useState } from 'react';
import { createVirtualFile } from '@/lib/api/file-state';
import { FileType } from '@/lib/ui/file-metadata';

/**
 * Options for creating a new file
 */
export interface NewFileOptions {
  /** Folder path override (defaults to user's home_folder) */
  folder?: string;
  /** For questions: pre-populate with this database/connection name */
  databaseName?: string;
  /** For questions: pre-populate with this SQL query */
  query?: string;
  virtualId?: number;
}

/**
 * useNewFile Hook - Phase 3 (Simplified)
 *
 * Creates and initializes a virtual file for "create mode" in the file editor.
 * Uses createVirtualFile from file-state.ts internally.
 *
 * Virtual files use negative IDs (-Date.now()) to distinguish them from real files.
 *
 * @param type - The type of file to create (question, dashboard, etc.)
 * @param options - Optional configuration (folder, connection, query)
 * @returns Virtual file ID (negative number)
 *
 * Example:
 * ```tsx
 * function NewFilePage({ params }: { params: { type: string } }) {
 *   const virtualFileId = useNewFile(params.type as FileType, { folder: '/org/sales' });
 *   return <FileView fileId={virtualFileId} mode="create" />;
 * }
 *
 * // Pre-populate a question with SQL
 * const virtualFileId = useNewFile('question', {
 *   folder: '/org',
 *   databaseName: 'my_db',
 *   query: 'SELECT * FROM users LIMIT 100'
 * });
 * ```
 */
export function useNewFile(type: FileType, options?: NewFileOptions): number {
  // Generate stable virtual ID
  const virtualId = useMemo(() => {
    if (options?.virtualId && options.virtualId < 0) {
      return options.virtualId;
    }
    return -Date.now();
  }, [options?.virtualId]);

  // Track initialization state
  const [initialized, setInitialized] = useState(false);

  // Create virtual file on mount
  useEffect(() => {
    if (initialized) return;
    setInitialized(true);

    createVirtualFile(type, {
      folder: options?.folder,
      databaseName: options?.databaseName,
      query: options?.query,
      virtualId
    }).catch(err => {
      console.error('[useNewFile] Failed to create virtual file:', err);
    });
  }, [initialized, type, options?.folder, options?.databaseName, options?.query, virtualId]);

  return virtualId;
}
