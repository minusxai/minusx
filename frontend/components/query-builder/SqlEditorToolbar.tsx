'use client';

import { LuAlignLeft, LuPlay } from 'react-icons/lu';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/kit/tooltip';

interface SqlEditorToolbarProps {
  readOnly: boolean;
  showFormatButton: boolean;
  showRunButton: boolean;
  onFormat: () => void;
  onRun?: () => void;
  isRunning: boolean;
}

/**
 * Vertical column of Format / Run action buttons alongside the SQL editor.
 */
export default function SqlEditorToolbar({
  readOnly,
  showFormatButton,
  showRunButton,
  onFormat,
  onRun,
  isRunning,
}: SqlEditorToolbarProps) {
  if (readOnly || !(showFormatButton || showRunButton)) {
    return null;
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col items-center justify-start gap-2 py-2">
        {showFormatButton && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onFormat}
                aria-label="Format SQL"
                className="flex size-8 cursor-pointer items-center justify-center rounded-md text-[#16a085] transition-colors hover:bg-[#16a085] hover:text-white"
              >
                <LuAlignLeft size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Format SQL</TooltipContent>
          </Tooltip>
        )}
        {showRunButton && onRun && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onRun}
                aria-label="Run query"
                disabled={isRunning}
                className="flex size-8 cursor-pointer items-center justify-center rounded-md bg-[#16a085] text-white transition-colors hover:bg-[#16a085]/90 disabled:pointer-events-none disabled:opacity-60"
              >
                {isRunning ? (
                  <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <LuPlay size={16} fill="white" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Run Query (Cmd+Enter)</TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
