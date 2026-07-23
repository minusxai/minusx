/**
 * PickerPopover - Shared popover components for query builder dropdowns
 * Composable building blocks: PickerPopover, PickerHeader, PickerList, PickerItem
 */

'use client';

import React, { useState } from 'react';
import { LuSearch } from 'react-icons/lu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/kit/popover';
import { Input } from '@/components/kit/input';
import { cn } from '@/components/kit/cn';

/* ─── PickerPopover ─── */

/** Chakra-style positioning hints (kept for interface compatibility). */
interface PickerPositioning {
  placement?: string;
  [key: string]: unknown;
}

interface PickerPopoverProps {
  open: boolean;
  onOpenChange: (details: { open: boolean }) => void;
  trigger: React.ReactNode;
  width?: string;
  padding?: number;
  positioning?: PickerPositioning;
  children: React.ReactNode;
}

/** Map a Chakra placement ("bottom-start") to Radix side/align. */
function toSideAlign(placement?: string): { side?: 'top' | 'bottom' | 'left' | 'right'; align?: 'start' | 'center' | 'end' } {
  if (!placement) return {};
  const [side, align] = placement.split('-');
  return {
    side: (['top', 'bottom', 'left', 'right'] as const).find((s) => s === side),
    align: align === 'start' || align === 'end' ? align : undefined,
  };
}

export function PickerPopover({
  open,
  onOpenChange,
  trigger,
  width = '350px',
  padding = 2,
  positioning,
  children,
}: PickerPopoverProps) {
  const { side, align } = toSideAlign(positioning?.placement);
  return (
    <Popover open={open} onOpenChange={(o) => onOpenChange({ open: o })}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className="overflow-hidden rounded-lg bg-popover p-0"
        style={{ width }}
      >
        <div style={{ padding: `${padding * 4}px` }}>
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ─── PickerHeader ─── */

export function PickerHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 py-1.5 font-mono text-xs font-semibold uppercase text-muted-foreground">
      {children}
    </p>
  );
}

/* ─── PickerList ─── */

/**
 * PickerList - Scrollable list container with optional search.
 *
 * When `searchable` is true, pass children as a render function:
 *   <PickerList searchable>{(query) => items.filter(...).map(...)}</PickerList>
 *
 * Otherwise, pass children normally:
 *   <PickerList><PickerItem>...</PickerItem></PickerList>
 */
export function PickerList({
  children,
  maxH,
  searchable,
  searchPlaceholder = 'Search...',
}: {
  children: React.ReactNode | ((searchQuery: string) => React.ReactNode);
  maxH?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const [searchQuery, setSearchQuery] = useState('');

  const rendered = typeof children === 'function' ? children(searchQuery) : children;

  // Check if render function returned empty (null, empty array, etc.)
  const isEmpty = Array.isArray(rendered)
    ? rendered.filter(Boolean).length === 0
    : !rendered;

  return (
    <>
      {searchable && (
        <div className="px-1 pb-1.5">
          <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-muted px-3 transition-all duration-200 focus-within:border-[#16a085] focus-within:shadow-[0_0_0_1px_#16a085]">
            <span className="shrink-0 text-muted-foreground">
              <LuSearch size={14} />
            </span>
            <Input
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              className="h-auto min-w-0 border-none bg-transparent px-0 font-mono text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0"
            />
          </div>
        </div>
      )}
      <div
        className={cn('flex flex-col gap-0.5', maxH && 'overflow-y-auto')}
        style={maxH ? { maxHeight: maxH } : undefined}
      >
        {isEmpty && searchQuery ? (
          <p className="px-2 py-2 text-center font-mono text-xs text-muted-foreground">
            No results for &ldquo;{searchQuery}&rdquo;
          </p>
        ) : (
          rendered
        )}
      </div>
    </>
  );
}

/* ─── PickerItem ─── */

interface PickerItemProps {
  icon?: React.ReactNode;
  children: React.ReactNode;
  selected?: boolean;
  selectedBg?: string;
  onClick?: (e: React.MouseEvent) => void;
  rightElement?: React.ReactNode;
  'aria-label'?: string;
}

export function PickerItem({
  icon,
  children,
  selected,
  selectedBg = 'rgba(99, 102, 241, 0.15)',
  onClick,
  rightElement,
  'aria-label': ariaLabel,
}: PickerItemProps) {
  const content =
    typeof children === 'string' ? (
      <span className="font-mono text-sm">{children}</span>
    ) : (
      children
    );

  return (
    <div
      className={cn('cursor-pointer rounded-md px-2 py-1.5', !selected && 'hover:bg-muted')}
      style={selected ? { background: selectedBg } : undefined}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {icon || rightElement ? (
        <div className={cn('flex items-center gap-2', rightElement && 'justify-between')}>
          <div className="flex items-center gap-2">
            {icon && <span className="text-muted-foreground">{icon}</span>}
            {content}
          </div>
          {rightElement}
        </div>
      ) : (
        content
      )}
    </div>
  );
}
