'use client';

/**
 * ReportContainer V2
 * Smart component for report pages
 * Uses the chat API directly for report execution
 */
import { Box } from '@chakra-ui/react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectMergedContent, selectEffectiveName, type FileId } from '@/store/filesSlice';
import { setRuns, setSelectedRun, selectRuns, selectSelectedRunId } from '@/store/reportRunsSlice';
import { selectEffectiveUser } from '@/store/authSlice';
import { resolvePath } from '@/lib/mode/path-resolver';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile, readFilesByCriteria, readFiles } from '@/lib/api/file-state';
import { FilesAPI } from '@/lib/data/files';
import ReportView from '@/components/views/ReportView';
import { ReportContent, ReportRunContent } from '@/lib/types';
import { useContexts } from '@/lib/hooks/useContexts';
import { useCallback, useState, useEffect } from 'react';
import { type FileViewMode } from '@/lib/ui/fileComponents';

interface ReportContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
}

export default function ReportContainerV2({ fileId }: ReportContainerV2Props) {
  const dispatch = useAppDispatch();

  // Use useFile hook for state management
  const { fileState: file } = useFile(fileId) ?? {};
  const fileLoading = !file || file.loading;
  const effectiveName = useAppSelector(state => selectEffectiveName(state, fileId)) || '';
  const effectiveUser = useAppSelector(selectEffectiveUser);
  const userMode = effectiveUser?.mode || 'org';

  // Get contexts for agent
  const { contexts } = useContexts();

  // Get all files from Redux (for building enriched references)
  const allFiles = useAppSelector(state => state.files.files);
  const fullState = useAppSelector(state => state);

  // Report runs from Redux
  const runs = useAppSelector(state => selectRuns(state, typeof fileId === 'number' ? fileId : -1));
  const selectedRunId = useAppSelector(state => selectSelectedRunId(state, typeof fileId === 'number' ? fileId : -1));

  // Local state
  const [isRunning, setIsRunning] = useState(false);

  // Merge content with persistableChanges for preview
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as ReportContent | undefined;

  // Fetch past runs from API (stored at /logs/reports/{reportId}/)
  const [runsLoading, setRunsLoading] = useState(false);

  // Load runs function - extracted so it can be called after execution
  const loadRuns = useCallback(async (selectLatest = false) => {
    if (typeof fileId !== 'number' || fileId < 0) {
      dispatch(setRuns({ reportId: fileId as number, runs: [] }));
      return;
    }

    setRunsLoading(true);
    try {
      // Fetch report_run files using centralized readFilesByCriteria
      const runsPath = resolvePath(userMode, `/logs/reports/${fileId}`);
      console.log('[Report] Loading runs from path:', runsPath);

      const result = await readFilesByCriteria({
        criteria: { type: 'report_run', paths: [runsPath], depth: -1 },
      });

      const runFiles = result.map(a => a.fileState);
      console.log('[Report] Runs loaded:', runFiles.length);

      // Sort by startedAt descending, take latest 10
      const sortedRuns = runFiles
        .filter((f: any) => f.content?.startedAt)
        .map((f: any) => ({
          id: f.id,
          name: f.name,
          content: f.content as ReportRunContent
        }))
        .sort((a: any, b: any) => new Date(b.content.startedAt).getTime() - new Date(a.content.startedAt).getTime())
        .slice(0, 10);

      console.log('[Report] Sorted runs:', sortedRuns);
      dispatch(setRuns({ reportId: fileId, runs: sortedRuns }));

      // Auto-select the latest run if requested
      if (selectLatest && sortedRuns.length > 0) {
        dispatch(setSelectedRun({ reportId: fileId, runId: sortedRuns[0].id }));
      }
    } catch (error) {
      console.error('Error loading runs:', error);
    } finally {
      setRunsLoading(false);
    }
  }, [fileId, userMode, dispatch]);

  // Load runs when fileId changes
  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  // Handlers
  const handleChange = useCallback((updates: Partial<ReportContent>) => {
    editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { content: updates } });
  }, [fileId]);

  // Run Now handler - calls the chat API directly with Report agent
  const handleRunNow = useCallback(async () => {
    if (isRunning || !file || typeof fileId !== 'number' || fileId < 0 || !mergedContent) return;

    setIsRunning(true);

    try {
      // Build enriched references with app_state for each question/dashboard
      // References are loaded when the report loads (via useFile with include=references)
      const enrichedReferences = await Promise.all(
        (mergedContent.references || []).map(async ref => {
          const refFile = allFiles[ref.reference.id];
          // Get the full app state for this reference (includes query, viz, results, etc.)
          const [augmented] = await readFiles([ref.reference.id]);
          const appState = augmented ? { type: 'file' as const, state: augmented } : null;
          const connectionId = (augmented?.fileState.content as { database_name?: string })?.database_name;

          return {
            ...ref,
            file_name: refFile?.name || `Unknown ${ref.reference.type}`,
            file_path: refFile?.path || '',
            app_state: appState,
            connection_id: connectionId,
          };
        })
      );

      // Get primary connection and context (use first reference's connection)
      const primaryConnectionId = enrichedReferences.find(r => r.connection_id)?.connection_id;
      const primaryContext = contexts[0]; // Use first context as primary
      const contextContent = primaryContext?.content as import('@/lib/types').ContextContent | undefined;

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationID: null,  // New conversation
          log_index: 0,
          user_message: 'Execute this report',
          agent: 'ReportAgent',
          agent_args: {
            report_id: fileId,
            report_name: effectiveName,
            references: enrichedReferences,
            report_prompt: mergedContent.reportPrompt,
            emails: mergedContent.emails,
            // Global context for all analyst agents
            connection_id: primaryConnectionId,
            schema: contextContent?.fullSchema || [],
            context: JSON.stringify(contextContent?.fullDocs || []),
          }
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to execute report');
      }

      const result = await response.json();
      console.log('[Report] Execution result:', result);

      // The chat API returns conversationID - load the conversation to get the task result
      const conversationId = result.conversationID;
      if (conversationId) {
        // Load the conversation file using FilesAPI
        const { data: conversation } = await FilesAPI.loadFile(conversationId);
        console.log('[Report] Conversation:', conversation);

        // Find the task_result entry for the ReportAgent task
        const log = (conversation?.content as any)?.log || [];
        const taskResult = log.find((entry: any) =>
          entry._type === 'task_result' && entry.result?.run
        );
        console.log('[Report] Task result:', taskResult);

        const runData = taskResult?.result?.run as ReportRunContent | undefined;
        console.log('[Report] Run data:', runData);

        if (runData) {
          // Save the run as a report_run file (mode-aware path)
          const timestamp = new Date(runData.startedAt).toISOString().replace(/[:.]/g, '-');
          const runPath = resolvePath(userMode, `/logs/reports/${fileId}/${timestamp}`);
          console.log('[Report] Saving run to path:', runPath);

          const saveResult = await FilesAPI.createFile({
            name: timestamp,
            path: runPath,
            type: 'report_run',
            content: runData,
            options: { createPath: true }
          });
          console.log('[Report] Save result:', saveResult);
        } else {
          console.warn('[Report] No run data found in task result');
        }
      } else {
        console.warn('[Report] No conversationID in result');
      }

      // Refresh runs and auto-select the latest one
      await loadRuns(true);

    } catch (error) {
      console.error('Failed to run report:', error);
      // TODO: Show error toast
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, file, fileId, mergedContent, effectiveName, loadRuns, userMode, contexts, allFiles, fullState]);

  const handleSelectRun = useCallback((runId: number | null) => {
    if (typeof fileId === 'number' && fileId >= 0) {
      dispatch(setSelectedRun({ reportId: fileId, runId }));
    }
  }, [fileId, dispatch]);

  // Show loading state while file is loading
  if (fileLoading || !file || !mergedContent) {
    return <Box p={4}>Loading report...</Box>;
  }

  // ReportView requires a numeric fileId
  if (typeof fileId !== 'number') return null;

  return (
    <ReportView
      report={mergedContent}
      fileId={fileId}
      isRunning={isRunning}
      runs={runs}
      selectedRunId={selectedRunId}
      onChange={handleChange}
      onRunNow={handleRunNow}
      onSelectRun={handleSelectRun}
    />
  );
}
