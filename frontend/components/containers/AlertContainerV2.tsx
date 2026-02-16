'use client';

/**
 * AlertContainer V2
 * Smart component for alert pages
 * Executes queries directly via /api/query and evaluates conditions client-side
 */
import { Box } from '@chakra-ui/react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectIsDirty, selectMergedContent, selectEffectiveName, type FileId } from '@/store/filesSlice';
import { setRuns, setSelectedRun, selectAlertRuns, selectSelectedAlertRunId } from '@/store/alertRunsSlice';
import { selectEffectiveUser } from '@/store/authSlice';
import { resolvePath } from '@/lib/mode/path-resolver';
import { useFile } from '@/lib/hooks/useFile';
import { redirectAfterSave } from '@/lib/ui/file-utils';
import { FilesAPI } from '@/lib/data/files';
import AlertView from '@/components/views/AlertView';
import { AlertContent, AlertRunContent, QuestionContent, ComparisonOperator } from '@/lib/types';
import { useCallback, useState, useEffect } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { isUserFacingError } from '@/lib/errors';

interface AlertContainerV2Props {
  fileId: FileId;
  mode?: 'view' | 'create';
}

/** Evaluate a condition against an actual value */
function evaluateCondition(actual: number, operator: ComparisonOperator, threshold: number): boolean {
  switch (operator) {
    case '>': return actual > threshold;
    case '<': return actual < threshold;
    case '=': return actual === threshold;
    case '>=': return actual >= threshold;
    case '<=': return actual <= threshold;
    case '!=': return actual !== threshold;
    default: return false;
  }
}

export default function AlertContainerV2({
  fileId,
  mode = 'view',
}: AlertContainerV2Props) {
  const router = useRouter();
  const dispatch = useAppDispatch();

  // Use useFile hook for state management
  const { file, loading: fileLoading, saving, edit, editMetadata, save, cancel } = useFile(fileId);
  const isDirty = useAppSelector(state => selectIsDirty(state, fileId));
  const effectiveName = useAppSelector(state => selectEffectiveName(state, fileId)) || '';
  const effectiveUser = useAppSelector(selectEffectiveUser);
  const userMode = effectiveUser?.mode || 'org';

  // Alert runs from Redux
  const runs = useAppSelector(state => selectAlertRuns(state, typeof fileId === 'number' ? fileId : -1));
  const selectedRunId = useAppSelector(state => selectSelectedAlertRunId(state, typeof fileId === 'number' ? fileId : -1));

  // Local state
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(mode === 'create');
  const [isRunning, setIsRunning] = useState(false);

  // Initialize edit mode for create mode
  useEffect(() => {
    if (mode === 'create' && !editMode) {
      setEditMode(true);
    }
  }, [mode, editMode]);

  // Auto-enter edit mode when changes are made
  useEffect(() => {
    if (isDirty && !editMode) {
      setEditMode(true);
    }
  }, [isDirty, editMode]);

  // Merge content with persistableChanges for preview
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as AlertContent | undefined;

  // Fetch past runs from API
  const loadRuns = useCallback(async (selectLatest = false) => {
    if (typeof fileId !== 'number' || fileId < 0) {
      dispatch(setRuns({ alertId: fileId as number, runs: [] }));
      return;
    }

    try {
      const runsPath = resolvePath(userMode, `/logs/alerts/${fileId}`);
      const response = await fetch(`/api/files?paths=${encodeURIComponent(runsPath)}&type=alert_run&depth=-1&includeContent=true`);
      if (!response.ok) {
        console.error('Failed to load alert runs:', response.status);
        return;
      }

      const result = await response.json();
      const runFiles = result.data || [];

      const sortedRuns = runFiles
        .filter((f: any) => f.content?.startedAt)
        .map((f: any) => ({
          id: f.id,
          name: f.name,
          content: f.content as AlertRunContent
        }))
        .sort((a: any, b: any) => new Date(b.content.startedAt).getTime() - new Date(a.content.startedAt).getTime())
        .slice(0, 10);

      dispatch(setRuns({ alertId: fileId, runs: sortedRuns }));

      if (selectLatest && sortedRuns.length > 0) {
        dispatch(setSelectedRun({ alertId: fileId, runId: sortedRuns[0].id }));
      }
    } catch (error) {
      console.error('Error loading alert runs:', error);
    }
  }, [fileId, userMode, dispatch]);

  // Load runs when fileId changes - auto-select latest
  useEffect(() => {
    loadRuns(true);
  }, [loadRuns]);

  // Handlers
  const handleChange = useCallback((updates: Partial<AlertContent>) => {
    edit(updates);
  }, [edit]);

  const handleMetadataChange = useCallback((changes: { name?: string }) => {
    editMetadata(changes);
  }, [editMetadata]);

  const handleSave = useCallback(async () => {
    if (!mergedContent) return;

    setSaveError(null);

    try {
      const result = await save();
      redirectAfterSave(result, fileId, router);
    } catch (error) {
      if (isUserFacingError(error)) {
        setSaveError(error.message);
        return;
      }
      console.error('Failed to save alert:', error);
      setSaveError('An unexpected error occurred. Please try again.');
    }
  }, [mergedContent, fileId, router, save]);

  const handleRevert = useCallback(() => {
    cancel();
    setEditMode(false);
    setSaveError(null);
  }, [cancel]);

  const handleEditModeChange = useCallback((newEditMode: boolean) => {
    setEditMode(newEditMode);
  }, []);

  // Check Now handler - executes the referenced question's query and evaluates the condition
  const handleCheckNow = useCallback(async () => {
    console.log('[Alert] Check Now clicked', { isRunning, fileId, questionId: mergedContent?.questionId, isDirty });
    if (isRunning || !file || typeof fileId !== 'number' || fileId < 0 || !mergedContent) return;
    if (!mergedContent.questionId || mergedContent.questionId <= 0) return;

    setIsRunning(true);
    const startedAt = new Date().toISOString();
    const condition = mergedContent.condition;

    try {
      // 1. Load the referenced question to get SQL and connection
      const loadResult = await FilesAPI.loadFile(mergedContent.questionId);
      console.log('[Alert] Loaded question file:', loadResult);
      // loadFile returns { data: DbFile, metadata } via json.data from API
      const questionFile = loadResult?.data || loadResult;
      if (!questionFile || !(questionFile as any).content) {
        throw new Error('Referenced question not found');
      }

      const questionContent = (questionFile as any).content as QuestionContent;
      console.log('[Alert] Question content:', { query: questionContent.query, db: questionContent.database_name });

      // 2. Execute the query
      const queryResponse = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: questionContent.query,
          database_name: questionContent.database_name,
          parameters: questionContent.parameters,
        })
      });

      if (!queryResponse.ok) {
        const error = await queryResponse.json();
        throw new Error(error.message || 'Query execution failed');
      }

      const queryResult = await queryResponse.json();
      console.log('[Alert] Query result:', { rowCount: queryResult.data?.rows?.length });
      const rows = queryResult.data?.rows || [];

      // 3. Extract metric value
      let actualValue: number;
      if (condition.metric === 'row_count') {
        actualValue = rows.length;
      } else {
        // first_column_value or last_column_value
        if (rows.length === 0) {
          throw new Error('Query returned no rows');
        }
        const col = condition.column || '';
        const row = condition.metric === 'last_column_value' ? rows[rows.length - 1] : rows[0];
        const raw = row[col];
        actualValue = typeof raw === 'number' ? raw : Number(raw);
        if (isNaN(actualValue)) {
          throw new Error(`Column "${col}" value is not a number: ${raw}`);
        }
      }

      // 4. Evaluate condition
      const triggered = evaluateCondition(actualValue, condition.operator, condition.threshold);

      // 5. Create run content
      const runContent: AlertRunContent = {
        alertId: fileId,
        alertName: effectiveName,
        startedAt,
        completedAt: new Date().toISOString(),
        status: triggered ? 'triggered' : 'not_triggered',
        actualValue,
        threshold: condition.threshold,
        operator: condition.operator,
        metric: condition.metric,
        column: condition.column,
      };

      // 6. Save as alert_run file
      const timestamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
      const runPath = resolvePath(userMode, `/logs/alerts/${fileId}/${timestamp}`);

      console.log('[Alert] Saving run to:', runPath, 'status:', runContent.status);
      const saveResult = await FilesAPI.createFile({
        name: timestamp,
        path: runPath,
        type: 'alert_run',
        content: runContent,
        options: { createPath: true }
      });
      console.log('[Alert] Save result:', saveResult);

      // 7. Refresh runs
      await loadRuns(true);

    } catch (error) {
      console.error('Alert check failed:', error);

      // Save failed run
      const runContent: AlertRunContent = {
        alertId: fileId,
        alertName: effectiveName,
        startedAt,
        completedAt: new Date().toISOString(),
        status: 'failed',
        actualValue: null,
        threshold: condition.threshold,
        operator: condition.operator,
        metric: condition.metric,
        column: condition.column,
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      const timestamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
      const runPath = resolvePath(userMode, `/logs/alerts/${fileId}/${timestamp}`);

      try {
        await FilesAPI.createFile({
          name: timestamp,
          path: runPath,
          type: 'alert_run',
          content: runContent,
          options: { createPath: true }
        });
      } catch {
        // Ignore save failure for error runs
      }

      await loadRuns(true);
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, file, fileId, mergedContent, effectiveName, loadRuns, userMode, isDirty]);

  const handleSelectRun = useCallback((runId: number | null) => {
    if (typeof fileId === 'number' && fileId >= 0) {
      dispatch(setSelectedRun({ alertId: fileId, runId }));
    }
  }, [fileId, dispatch]);

  // Show loading state while file is loading
  if (fileLoading || !file || !mergedContent) {
    return <Box p={4}>Loading alert...</Box>;
  }

  return (
    <AlertView
      alert={mergedContent}
      fileName={effectiveName}
      isDirty={isDirty}
      isSaving={saving}
      saveError={saveError}
      editMode={editMode}
      isRunning={isRunning}
      runs={runs}
      selectedRunId={selectedRunId}
      onChange={handleChange}
      onMetadataChange={handleMetadataChange}
      onSave={handleSave}
      onRevert={handleRevert}
      onEditModeChange={handleEditModeChange}
      onCheckNow={handleCheckNow}
      onSelectRun={handleSelectRun}
    />
  );
}
