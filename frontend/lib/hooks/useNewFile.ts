import { useEffect, useMemo, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setFile } from '@/store/filesSlice';
import { FileType } from '@/lib/ui/file-metadata';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { FilesAPI } from '@/lib/data/files';

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
 * useNewFile Hook
 *
 * Creates and initializes a virtual file for "create mode" in the file editor.
 * Virtual files use negative IDs (-Date.now()) to distinguish them from real files.
 *
 * Behavior:
 * 1. Generates a unique virtual ID using negative timestamp
 * 2. Fetches template from backend API (FilesAPI.getTemplate)
 * 3. Pre-populates Redux with the virtual file
 * 4. Returns the virtual file ID for use with FileView
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
  const dispatch = useAppDispatch();

  // Get user's home folder from Redux (resolve with mode)
  const user = useAppSelector(state => state.auth.user);
  const folder = useMemo(() => {
    if (options?.folder) return options.folder;
    if (!user) return '/org';
    return resolveHomeFolderSync(user.mode, user.home_folder || '');
  }, [options?.folder, user]);

  // Generate virtual ID once (stable across re-renders)
  const virtualId = useMemo(() => {
    if (options?.virtualId && options.virtualId < 0) {
      return options.virtualId;
    }
    return -Date.now();
  }, [options?.virtualId]);

  // Track if template was fetched to prevent duplicate calls
  const templateFetched = useRef(false);

  // Fetch template from backend and create virtual file
  useEffect(() => {
    // Only fetch once
    if (templateFetched.current) return;
    templateFetched.current = true;

    // Fetch template from backend
    FilesAPI.getTemplate(type, {
      path: folder,
      databaseName: options?.databaseName,
      query: options?.query
    })
      .then(template => {
        // Create virtual file in Redux
        const virtualFile = {
          id: virtualId,
          name: template.fileName,
          path: `${folder}/${template.fileName}`,
          type: type as FileType,
          references: [],
          content: template.content,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          company_id: user?.companyId ?? 0
        };

        dispatch(setFile({ file: virtualFile, references: [] }));
      })
      .catch(err => {
        console.error('[useNewFile] Failed to fetch template:', err);
        // Could dispatch error state here if needed
      });
  }, [virtualId, type, folder, options?.databaseName, options?.query, dispatch]);

  return virtualId;
}
