'use client';

/**
 * AlertContainer V2
 * Smart component for alert pages
 * Executes queries directly via /api/query and evaluates conditions client-side
 */
import { Box } from '@chakra-ui/react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectMergedContent, selectEffectiveName, type FileId } from '@/store/filesSlice';
import { setRuns, setSelectedRun, selectAlertRuns, selectSelectedAlertRunId } from '@/store/alertRunsSlice';
import { selectEffectiveUser } from '@/store/authSlice';
import { resolvePath } from '@/lib/mode/path-resolver';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile, getQueryResult, readFilesByCriteria } from '@/lib/api/file-state';
import { FilesAPI } from '@/lib/data/files';
import AlertView from '@/components/views/AlertView';
import { AlertContent, AlertRunContent, QuestionContent, ComparisonOperator } from '@/lib/types';
import { useCallback, useState, useEffect } from 'react';

interface AlertContainerV2Props {
  fileId: FileId;
  mode?: 'view' | 'create';  // Handled by FileHeader (rendered by FileView)
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

export default function AlertContainerV2({ fileId }: AlertContainerV2Props) {
  const dispatch = useAppDispatch();

  // Use useFile hook for state management
  const { fileState: file } = useFile(fileId) ?? {};
  const fileLoading = !file || file.loading;
  const effectiveName = useAppSelector(state => selectEffectiveName(state, fileId)) || '';
  const effectiveUser = useAppSelector(selectEffectiveUser);
  const userMode = effectiveUser?.mode || 'org';

  // Alert runs from Redux
  const runs = useAppSelector(state => selectAlertRuns(state, typeof fileId === 'number' ? fileId : -1));
  const selectedRunId = useAppSelector(state => selectSelectedAlertRunId(state, typeof fileId === 'number' ? fileId : -1));

  // Local state
  const [isRunning, setIsRunning] = useState(false);

  // Merge content with persistableChanges for preview
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as AlertContent | undefined;

  // Fetch past runs from API
  const loadRuns = useCallback(async (selectLatest = false) => {
    if (typeof fileId !== 'number' || fileId < 0) {
      dispatch(setRuns({ alertId: fileId as number, runs: [] }));
      return;
    }

    try {
      // Fetch alert_run files using centralized readFilesByCriteria
      const runsPath = resolvePath(userMode, `/logs/alerts/${fileId}`);

      const result = await readFilesByCriteria({
        criteria: { type: 'alert_run', paths: [runsPath], depth: -1 },
      });

      const runFiles = result.map(a => a.fileState);

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
    editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { content: updates } });
  }, [fileId]);

  // Check Now handler - executes the referenced question's query and evaluates the condition
  const handleCheckNow = useCallback(async () => {
    if (isRunning || !file || typeof fileId !== 'number' || fileId < 0 || !mergedContent) return;
    if (!mergedContent.questionId || mergedContent.questionId <= 0) return;

    setIsRunning(true);
    const startedAt = new Date().toISOString();
    const condition = mergedContent.condition;

    try {
      // 1. Load the referenced question to get SQL and connection
      const loadResult = await FilesAPI.loadFile(mergedContent.questionId);
      const questionFile = loadResult?.data || loadResult;
      if (!questionFile || !(questionFile as any).content) {
        throw new Error('Referenced question not found');
      }

      const questionContent = (questionFile as any).content as QuestionContent;

      // 2. Execute the query using centralized getQueryResult
      const params = (questionContent.parameters || []).reduce<Record<string, any>>((acc, p) => {
        acc[p.name] = p.value ?? '';
        return acc;
      }, {});

      const queryResult = await getQueryResult({
        query: questionContent.query,
        params,
        database: questionContent.database_name,
      });

      const rows = queryResult.rows || [];

      // 3. Extract metric value based on selector + function
      let actualValue: number;
      const col = condition.column || '';
      const fn = condition.function;
      const selector = condition.selector;

      if (fn === 'count') {
        // Row count — no column needed
        actualValue = rows.length;
      } else if (fn === 'sum' || fn === 'avg' || fn === 'min' || fn === 'max') {
        // Aggregates over all rows
        if (rows.length === 0) throw new Error('Query returned no rows');
        const vals = rows.map((r: any) => {
          const v = typeof r[col] === 'number' ? r[col] : Number(r[col]);
          if (isNaN(v)) throw new Error(`Column "${col}" contains non-numeric value: ${r[col]}`);
          return v;
        });
        if (fn === 'sum') actualValue = vals.reduce((a: number, b: number) => a + b, 0);
        else if (fn === 'avg') actualValue = vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
        else if (fn === 'min') actualValue = Math.min(...vals);
        else actualValue = Math.max(...vals);
      } else {
        // Single-row functions (first/last selector)
        if (rows.length === 0) throw new Error('Query returned no rows');
        const rowIdx = selector === 'last' ? rows.length - 1 : 0;

        if (fn === 'value') {
          const raw = rows[rowIdx][col];
          actualValue = typeof raw === 'number' ? raw : Number(raw);
          if (isNaN(actualValue)) throw new Error(`Column "${col}" value is not a number: ${raw}`);
        } else if (fn === 'diff' || fn === 'pct_change') {
          // Compare selected row vs adjacent row
          if (rows.length < 2) throw new Error('Need at least 2 rows for diff/pct_change');
          const adjIdx = selector === 'last' ? rows.length - 2 : 1;
          const selected = typeof rows[rowIdx][col] === 'number' ? rows[rowIdx][col] : Number(rows[rowIdx][col]);
          const adjacent = typeof rows[adjIdx][col] === 'number' ? rows[adjIdx][col] : Number(rows[adjIdx][col]);
          if (isNaN(selected) || isNaN(adjacent)) throw new Error(`Column "${col}" contains non-numeric values`);
          if (fn === 'diff') {
            actualValue = selected - adjacent;
          } else {
            if (adjacent === 0) throw new Error('Cannot compute % change: adjacent value is 0');
            actualValue = ((selected - adjacent) / Math.abs(adjacent)) * 100;
          }
        } else if (fn === 'months_ago' || fn === 'days_ago' || fn === 'years_ago') {
          const raw = rows[rowIdx][col];
          const d = new Date(raw);
          if (isNaN(d.getTime())) throw new Error(`Column "${col}" contains invalid date: ${raw}`);
          const now = new Date();
          if (fn === 'days_ago') {
            actualValue = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
          } else if (fn === 'months_ago') {
            actualValue = (now.getFullYear() * 12 + now.getMonth()) - (d.getFullYear() * 12 + d.getMonth());
          } else {
            actualValue = now.getFullYear() - d.getFullYear();
          }
        } else {
          throw new Error(`Unknown function: ${fn}`);
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
        selector: condition.selector,
        function: condition.function,
        column: condition.column,
      };

      // 6. Save as alert_run file
      const timestamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
      const runPath = resolvePath(userMode, `/logs/alerts/${fileId}/${timestamp}`);

      await FilesAPI.createFile({
        name: timestamp,
        path: runPath,
        type: 'alert_run',
        content: runContent,
        options: { createPath: true }
      });

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
        selector: condition.selector,
        function: condition.function,
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
  }, [isRunning, file, fileId, mergedContent, effectiveName, loadRuns, userMode]);

  const handleSelectRun = useCallback((runId: number | null) => {
    if (typeof fileId === 'number' && fileId >= 0) {
      dispatch(setSelectedRun({ alertId: fileId, runId }));
    }
  }, [fileId, dispatch]);

  // Show loading state while file is loading
  if (fileLoading || !file || !mergedContent) {
    return <Box p={4}>Loading alert...</Box>;
  }

  // AlertView requires a numeric fileId
  if (typeof fileId !== 'number') return null;

  return (
    <AlertView
      alert={mergedContent}
      fileId={fileId}
      isRunning={isRunning}
      runs={runs}
      selectedRunId={selectedRunId}
      onChange={handleChange}
      onCheckNow={handleCheckNow}
      onSelectRun={handleSelectRun}
    />
  );
}
