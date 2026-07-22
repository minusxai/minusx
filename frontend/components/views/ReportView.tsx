'use client';

import { PageMarkerDevOverlay } from '@/components/views/story/PageMarkerDevOverlay';
import { ReportContent, ReportOutput, RunFileContent, JobRun, DatabaseWithSchema } from '@/lib/types';
import LexicalTextEditor, { LexicalTextViewer } from '@/components/lexical/LexicalTextEditor';
import { useState, useCallback, useRef, useEffect } from 'react';
import { LuFileText, LuGripVertical, LuHistory, LuExternalLink } from 'react-icons/lu';
import Link from 'next/link';
import { preserveParams } from '@/lib/navigation/url-utils';
import { DeliveryCard } from '@/components/shared/DeliveryPicker';
import { SchedulePicker } from '@/components/shared/SchedulePicker';
import { StatusBanner } from '@/components/shared/StatusBanner';
import { RunNowHeader, type RunOptions } from '@/components/shared/RunNowHeader';
import Markdown from '@/components/Markdown';
import { Badge } from '@/components/kit/badge';
import { cn } from '@/components/kit/cn';

interface ReportViewProps {
  report: ReportContent;
  fileId: number;
  isRunning: boolean;
  runs?: JobRun[];
  selectedRunId?: number | null;
  /** Run file content (RunFileContent) for the selected run, loaded by the container */
  runFileContent?: RunFileContent | null;
  /** File ID of the selected run file, for navigation link */
  runFileId?: number;
  /** Context databases for the report's path — powers @-mention of tables/columns. */
  whitelistedSchemas?: DatabaseWithSchema[];
  editMode: boolean;
  isDirty: boolean;

  onChange: (updates: Partial<ReportContent>) => void;
  onRunNow: (opts: RunOptions) => Promise<void>;
  onSelectRun?: (runId: number | null) => void;
  /** Dev-only page-marker preview (Renderer_v2 Phase 1): this type is marker-flagged. */
  showDevMarkers?: boolean;
  colorMode?: 'light' | 'dark';
}

/** Status badge tint (Chakra colorPalette subtle-badge equivalent): accent at low opacity + accent text. */
const STATUS_BADGE_CLASS: Record<string, string> = {
  success: 'border-transparent bg-[color-mix(in_srgb,#2ecc71_18%,transparent)] text-[#27ae60]',
  failure: 'border-transparent bg-[color-mix(in_srgb,#c0392b_15%,transparent)] text-[#c0392b]',
  other: 'border-transparent bg-[color-mix(in_srgb,#f39c12_18%,transparent)] text-[#f39c12]',
};

export default function ReportView({
  report,
  fileId,
  showDevMarkers,
  colorMode,
  isRunning,
  runs = [],
  selectedRunId,
  runFileContent,
  runFileId,
  whitelistedSchemas,
  editMode,
  isDirty,
  onChange,
  onRunNow,
  onSelectRun
}: ReportViewProps) {
  const reportOutput = runFileContent?.output as ReportOutput | undefined;

  // Resizable panel state
  const [leftPanelWidth, setLeftPanelWidth] = useState(50); // percentage
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(50);
  const rafRef = useRef<number | null>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Track container width for responsive layout
  useEffect(() => {
    if (!mainContentRef.current) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(mainContentRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Use compact layout when container is narrow (< 700px)
  const useCompactLayout = containerWidth > 0 && containerWidth < 700;

  // Handle panel resize
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = leftPanelWidth;
  }, [leftPanelWidth]);

  const handleResizeMove = useCallback((clientX: number) => {
    if (!isResizing || !mainContentRef.current) return;

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

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

  // Global mouse events for resizing
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

  const hasPrompt = !!report.reportPrompt?.trim();

  return (
    // data-file-id → standard FileView capture (useScreenshot / Dev Tools "Download Image").
    // Overlay OUTSIDE the captured [data-file-id] subtree (StoryView contract).
    <div className="relative flex min-h-0 flex-1 flex-col">
      <PageMarkerDevOverlay enabled={!!showDevMarkers} colorMode={colorMode ?? 'light'} />
    <div data-file-id={fileId} className="flex min-h-0 flex-1 flex-col overflow-hidden font-mono">
      {/* Status bar: Live/Draft toggle */}
      <StatusBanner
        status={report.status ?? 'draft'}
        label="report"
        runLabel="Run Now"
        editMode={editMode}
        onChange={(s) => onChange({ status: s })}
        suppressUntil={report.suppressUntil}
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
              {/* Schedule Card */}
              <SchedulePicker
                schedule={{ cron: report.schedule?.cron || '0 9 * * 1', timezone: report.schedule?.timezone || 'America/New_York' }}
                onChange={(s) => onChange({ schedule: s })}
                editMode={editMode}
              />

              {/* Report Instructions Card — single freeform prompt. The agent
                  finds the relevant questions/data itself from this text. */}
              <div className="rounded-md border border-border/60 bg-muted p-3">
                <div className="mb-1 flex items-center gap-1.5">
                  <LuFileText size={14} color="#f39c12" />
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Instructions</p>
                </div>
                <p className="mb-2 text-xs text-muted-foreground">
                </p>

                <div
                  aria-label="Report instructions"
                  className="h-[240px] overflow-hidden rounded-md border border-border bg-card"
                >
                  {editMode ? (
                    <LexicalTextEditor
                      key={`report-prompt-${fileId}`}
                      initialMarkdown={report.reportPrompt || ''}
                      onChange={(markdown) => onChange({ reportPrompt: markdown })}
                      mentions={{ whitelistedSchemas }}
                    />
                  ) : (
                    <LexicalTextViewer markdown={report.reportPrompt || ''} padding="12px 16px" />
                  )}
                </div>
              </div>

              {/* Delivery Card */}
              <DeliveryCard
                recipients={report.recipients || []}
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
              {/* Vertical line */}
              <div
                className={cn(
                  'absolute inset-y-0 w-[2px] rounded-full transition-all duration-150 ease-in-out group-hover:bg-[#16a085]',
                  isResizing ? 'bg-[#16a085]' : 'bg-border/60',
                )}
              />
              {/* Center grip indicator */}
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

          {/* Right Panel: Report Runs */}
          <div
            className={cn(
              'flex min-h-[75vh] flex-1 flex-col overflow-hidden bg-card',
              !useCompactLayout && 'my-2 mr-2 rounded-lg border border-border/60',
            )}
          >
            {/* Run Header */}
            <RunNowHeader
              title="Report Runs"
              runs={runs}
              selectedRunId={selectedRunId}
              onSelectRun={onSelectRun}
              isRunning={isRunning}
              disabled={isDirty || !hasPrompt}
              onRunNow={onRunNow}
              externalLinkId={runFileId}
            />

            {/* Run Content */}
            <div className="flex-1 overflow-auto p-4">
              {isRunning ? (
                <div className="flex h-full flex-col items-center justify-center gap-4">
                  <p className="text-muted-foreground">Running report...</p>
                </div>
              ) : runFileContent ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge
                        className={
                          STATUS_BADGE_CLASS[
                            runFileContent.status === 'success' ? 'success' : runFileContent.status === 'failure' ? 'failure' : 'other'
                          ]
                        }
                      >
                        {runFileContent.status}
                      </Badge>
                      <p className="text-xs text-muted-foreground">
                        {new Date(runFileContent.startedAt).toLocaleString()}
                      </p>
                    </div>
                    {runFileId && (
                      <Link href={preserveParams(`/f/${runFileId}`)} style={{ opacity: 0.5 }}>
                        <LuExternalLink size={14} />
                      </Link>
                    )}
                  </div>
                  {reportOutput?.generatedReport && (
                    <div className="max-h-none overflow-auto rounded-md bg-muted p-4">
                      <Markdown queries={reportOutput.queries}>
                        {reportOutput.generatedReport}
                      </Markdown>
                    </div>
                  )}
                  {runFileContent.error && (
                    <div className="rounded-md bg-[color-mix(in_srgb,#c0392b_10%,transparent)] p-3 text-[#c0392b]">
                      <p className="text-sm">{runFileContent.error}</p>
                    </div>
                  )}
                </div>
              ) : runs.length === 0 ? (
                <div aria-label="No report runs" className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
                  <LuHistory size={48} opacity={0.3} />
                  <p className="text-sm">
                    {isDirty
                      ? 'Save your changes before running'
                      : !hasPrompt
                        ? 'Add report instructions to run the report'
                        : 'No runs yet. Click "Run Now" to test your report'
                    }
                  </p>
                </div>
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
    </div>
  );
}
