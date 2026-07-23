'use client';

import { cn } from '@/components/kit/cn';

interface SqlEditorResizeHandleProps {
  fillHeight: boolean;
  isResizing: boolean;
  onResizeStart: (e: React.MouseEvent) => void;
}

/**
 * Draggable bottom edge used to resize the SQL editor's fixed pixel height.
 * Hidden entirely in fillHeight mode, where the editor fills its parent instead.
 */
export default function SqlEditorResizeHandle({
  fillHeight,
  isResizing,
  onResizeStart,
}: SqlEditorResizeHandleProps) {
  if (fillHeight) {
    return null;
  }

  return (
    <div
      className={cn(
        'absolute inset-x-0 bottom-0 z-10 flex h-2 cursor-ns-resize items-center justify-center bg-transparent transition-colors duration-200',
        isResizing ? 'hover:bg-[#16a085]' : 'hover:bg-border',
      )}
      onMouseDown={onResizeStart}
    >
      {/* Resize indicator dots */}
      <div className="flex items-center gap-1 py-[2px]">
        <div
          className={cn(
            'size-[3px] rounded-full transition-colors duration-200',
            isResizing ? 'bg-white' : 'bg-border',
          )}
        />
        <div
          className={cn(
            'size-[3px] rounded-full transition-colors duration-200',
            isResizing ? 'bg-white' : 'bg-border',
          )}
        />
        <div
          className={cn(
            'size-[3px] rounded-full transition-colors duration-200',
            isResizing ? 'bg-white' : 'bg-border',
          )}
        />
      </div>
    </div>
  );
}
