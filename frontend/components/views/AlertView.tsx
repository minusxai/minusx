'use client';

import { AlertContent, JobRun, Test } from '@/lib/types';
import { useState, useCallback, useRef, useEffect } from 'react';
import { LuFlaskConical, LuGripVertical } from 'react-icons/lu';
import { DeliveryCard } from '@/components/shared/DeliveryPicker';
import { SchedulePicker } from '@/components/shared/SchedulePicker';
import { StatusBanner } from '@/components/shared/StatusBanner';
import { RunNowHeader, type RunOptions } from '@/components/shared/RunNowHeader';
import { AlertHistoryEmptyState } from '@/components/views/shared/empty-states';
import { cn } from '@/components/kit/cn';
import AlertRunContainerV2 from '@/components/containers/AlertRunContainerV2';
import TestList from '@/components/evals/TestList';
import SimpleSelect from '@/components/evals/SimpleSelect';

interface AlertViewProps {
  alert: AlertContent;
  alertName: string;
  isRunning: boolean;
  runs?: JobRun[];
  selectedRunId?: number | null;
  editMode: boolean;
  isDirty: boolean;
  onChange: (updates: Partial<AlertContent>) => void;
  onRunNow: (opts: RunOptions) => Promise<void>;
  onSelectRun?: (runId: number | null) => void;
}

export default function AlertView({
  alert,
  alertName,
  isRunning,
  runs = [],
  selectedRunId,
  editMode,
  isDirty,
  onChange,
  onRunNow,
  onSelectRun
}: AlertViewProps) {
  // Resizable panel state
  const [leftPanelWidth, setLeftPanelWidth] = useState(50);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(50);
  const rafRef = useRef<number | null>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!mainContentRef.current) return;
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    resizeObserver.observe(mainContentRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const useCompactLayout = containerWidth > 0 && containerWidth < 700;

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = leftPanelWidth;
  }, [leftPanelWidth]);

  const handleResizeMove = useCallback((clientX: number) => {
    if (!isResizing || !mainContentRef.current) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (!mainContentRef.current) return;
      const containerRect = mainContentRef.current.getBoundingClientRect();
      const deltaX = clientX - resizeStartX.current;
      const deltaPercent = (deltaX / containerRect.width) * 100;
      const newWidth = Math.max(30, Math.min(70, resizeStartWidth.current + deltaPercent));
      setLeftPanelWidth(newWidth);
    });
  }, [isResizing]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => handleResizeMove(e.clientX);
    const handleMouseUp = handleResizeEnd;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  const selectedRun = runs.find(r => r.id === selectedRunId) ?? runs[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden font-mono">
      {/* Status bar: Live/Draft toggle + cron info */}
      <StatusBanner
        status={alert.status ?? 'draft'}
        label="alert"
        runLabel="Check Now"
        editMode={editMode}
        onChange={(s) => onChange({ status: s })}
        suppressUntil={alert.suppressUntil}
        onSuppressChange={(val) => onChange({ suppressUntil: val })}
      />

      {/* Visual View - Two Column Layout (the Code view is rendered upstream by FileView) */}
      {(
        <div
          ref={mainContentRef}
          className={cn(
            'flex min-h-0 flex-1 overflow-hidden',
            !useCompactLayout ? 'flex-row' : 'flex-col',
          )}
        >
          {/* Left Panel: Form */}
          <div
            className={cn(
              'flex shrink-0 flex-col overflow-auto bg-card',
              !useCompactLayout && 'my-2 ml-2 min-w-[300px] rounded-lg border border-border/60',
            )}
            style={{ width: !useCompactLayout ? `calc(${leftPanelWidth}% - 8px)` : '100%' }}
          >
            <div className="flex flex-col gap-3 p-4">
              {/* Tests Card */}
              <div className="relative overflow-hidden rounded-md border border-border/60 bg-muted pt-3 pr-3 pb-2 pl-5">
                <div className="absolute top-0 bottom-0 left-0 w-[3px] rounded-l-md bg-[#f39c12]" />
                <div className="mb-2 flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <LuFlaskConical size={14} color="#f39c12" />
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tests</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">Notify when</p>
                    <div className="w-[180px]">
                      <SimpleSelect
                        value={alert.notifyOn ?? 'any_fail'}
                        onChange={v => onChange({ notifyOn: v as 'any_fail' | 'all_fail' })}
                        options={[
                          { value: 'any_fail', label: 'any test fails' },
                          { value: 'all_fail', label: 'all tests fail' },
                        ]}
                        disabled={!editMode}
                        size="sm"
                      />
                    </div>
                  </div>
                </div>
                <TestList
                  tests={alert.tests || []}
                  onChange={(tests: Test[]) => onChange({ tests })}
                  editMode={editMode}
                />
              </div>

              {/* Schedule Card */}
              <SchedulePicker
                schedule={{ cron: alert.schedule?.cron || '0 9 * * 1', timezone: alert.schedule?.timezone || 'America/New_York' }}
                onChange={(s) => onChange({ schedule: s })}
                editMode={editMode}
              />

              {/* Delivery Card */}
              <DeliveryCard
                recipients={alert.recipients || []}
                onChange={(recipients) => onChange({ recipients })}
                disabled={!editMode}
              />
            </div>
          </div>

          {/* Resize Handle */}
          {!useCompactLayout && (
            <div
              role="group"
              className="group relative z-10 flex w-4 shrink-0 cursor-col-resize select-none items-center justify-center"
              onMouseDown={handleResizeStart}
            >
              <div
                className={cn(
                  'absolute inset-y-0 w-[2px] rounded-full transition-all duration-150 ease-in-out group-hover:bg-[#16a085]',
                  isResizing ? 'bg-[#16a085]' : 'bg-border/60',
                )}
              />
              <div
                className={cn(
                  'absolute top-1/2 flex h-10 w-5 -translate-y-1/2 items-center justify-center rounded-md shadow-sm transition-all duration-150 ease-in-out group-hover:bg-[#16a085]',
                  isResizing ? 'bg-[#16a085]' : 'bg-muted',
                )}
              >
                <LuGripVertical
                  size={14}
                  className={cn(
                    'transition-colors duration-150 ease-in-out group-hover:text-white',
                    isResizing ? 'text-white' : 'text-muted-foreground',
                  )}
                />
              </div>
            </div>
          )}

          {/* Right Panel: Alert Runs */}
          <div
            className={cn(
              'flex min-h-[75vh] flex-1 flex-col overflow-hidden bg-card',
              !useCompactLayout && 'my-2 mr-2 rounded-lg border border-border/60',
            )}
          >
            {/* Run Header */}
            <RunNowHeader
              title="Alert History"
              runs={runs}
              selectedRunId={selectedRunId}
              onSelectRun={onSelectRun}
              isRunning={isRunning}
              disabled={isDirty || !alert.tests?.length}
              onRunNow={onRunNow}
              buttonLabel="Check Now"
              runningLabel="Checking..."
            />

            {/* Run Content */}
            <div className="flex-1 overflow-auto p-4">
              {isRunning ? (
                <div className="flex h-full flex-col items-center justify-center gap-4">
                  <p className="text-muted-foreground">Running alert check...</p>
                </div>
              ) : selectedRun ? (
                selectedRun.output_file_id ? (
                  <AlertRunContainerV2 fileId={selectedRun.output_file_id} inline />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                    <p className="text-sm">Run in progress...</p>
                  </div>
                )
              ) : runs.length === 0 ? (
                <AlertHistoryEmptyState
                  message={
                    isDirty
                      ? 'Save your changes before checking'
                      : !alert.tests?.length
                        ? 'Add tests to monitor'
                        : 'No checks yet. Click "Check Now" to test your alert'
                  }
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
                  <p className="text-sm">Select a run to view details</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
