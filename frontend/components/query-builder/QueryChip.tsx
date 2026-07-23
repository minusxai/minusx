/**
 * QueryChip - Reusable pill/chip component for query builder
 * compact, dismissible chips with color variants
 */

'use client';

import { LuX, LuHash, LuCalendar, LuType, LuLock } from 'react-icons/lu';
import { ReactNode } from 'react';
import { useAppSelector } from '@/store/hooks';
import { cn } from '@/components/kit/cn';

export type ChipVariant = 'metric' | 'dimension' | 'filter' | 'table' | 'sort' | 'neutral';

interface QueryChipProps {
  children: ReactNode;
  variant?: ChipVariant;
  icon?: ReactNode;
  onRemove?: () => void;
  onClick?: () => void;
  isActive?: boolean;
  isLocked?: boolean;
  size?: 'sm' | 'md';
}

type VariantStyle = { bg: string; border: string; color: string; hoverBg: string };

const variantStylesDark: Record<ChipVariant, VariantStyle> = {
  metric: {
    bg: 'rgba(134, 239, 172, 0.12)',
    border: 'rgba(134, 239, 172, 0.3)',
    color: '#86efac',
    hoverBg: 'rgba(134, 239, 172, 0.2)',
  },
  dimension: {
    bg: 'rgba(251, 191, 36, 0.1)',
    border: 'rgba(251, 191, 36, 0.28)',
    color: '#fbbf24',
    hoverBg: 'rgba(251, 191, 36, 0.18)',
  },
  filter: {
    bg: 'rgba(147, 197, 253, 0.1)',
    border: 'rgba(147, 197, 253, 0.28)',
    color: '#93c5fd',
    hoverBg: 'rgba(147, 197, 253, 0.18)',
  },
  table: {
    bg: 'rgba(99, 102, 241, 0.12)',
    border: 'rgba(99, 102, 241, 0.3)',
    color: '#a5b4fc',
    hoverBg: 'rgba(99, 102, 241, 0.2)',
  },
  sort: {
    bg: 'rgba(192, 132, 252, 0.1)',
    border: 'rgba(192, 132, 252, 0.28)',
    color: '#c084fc',
    hoverBg: 'rgba(192, 132, 252, 0.18)',
  },
  neutral: {
    bg: 'rgba(148, 163, 184, 0.08)',
    border: 'rgba(148, 163, 184, 0.2)',
    color: '#94a3b8',
    hoverBg: 'rgba(148, 163, 184, 0.15)',
  },
};

const variantStylesLight: Record<ChipVariant, VariantStyle> = {
  metric: {
    bg: 'rgba(22, 163, 74, 0.08)',
    border: 'rgba(22, 163, 74, 0.25)',
    color: '#16a34a',
    hoverBg: 'rgba(22, 163, 74, 0.15)',
  },
  dimension: {
    bg: 'rgba(217, 119, 6, 0.08)',
    border: 'rgba(217, 119, 6, 0.25)',
    color: '#d97706',
    hoverBg: 'rgba(217, 119, 6, 0.15)',
  },
  filter: {
    bg: 'rgba(37, 99, 235, 0.08)',
    border: 'rgba(37, 99, 235, 0.25)',
    color: '#2563eb',
    hoverBg: 'rgba(37, 99, 235, 0.15)',
  },
  table: {
    bg: 'rgba(79, 70, 229, 0.08)',
    border: 'rgba(79, 70, 229, 0.25)',
    color: '#4f46e5',
    hoverBg: 'rgba(79, 70, 229, 0.15)',
  },
  sort: {
    bg: 'rgba(124, 58, 237, 0.08)',
    border: 'rgba(124, 58, 237, 0.25)',
    color: '#7c3aed',
    hoverBg: 'rgba(124, 58, 237, 0.15)',
  },
  neutral: {
    bg: 'rgba(100, 116, 139, 0.08)',
    border: 'rgba(100, 116, 139, 0.2)',
    color: '#64748b',
    hoverBg: 'rgba(100, 116, 139, 0.15)',
  },
};

function useChipVariantStyles(variant: ChipVariant): VariantStyle {
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  return (colorMode === 'light' ? variantStylesLight : variantStylesDark)[variant];
}

export function QueryChip({
  children,
  variant = 'neutral',
  icon,
  onRemove,
  onClick,
  isActive = false,
  isLocked = false,
  size = 'sm',
}: QueryChipProps) {
  const styles = useChipVariantStyles(variant);
  const isClickable = !!onClick && !isLocked;

  return (
    <div
      className={cn(
        'flex shrink-0 items-center rounded-md border transition-all duration-150 ease-in-out',
        'bg-[var(--chip-bg)] border-[var(--chip-border)]',
        size === 'sm' ? 'gap-1.5 px-2 py-1' : 'gap-1.5 px-2.5 py-1.5',
        isLocked ? 'border-dashed opacity-65' : 'border-solid',
        isClickable
          ? 'cursor-pointer hover:bg-[var(--chip-hover)] hover:border-[var(--chip-color)]'
          : 'cursor-default',
      )}
      style={{
        '--chip-bg': isActive ? styles.hoverBg : styles.bg,
        '--chip-border': styles.border,
        '--chip-hover': styles.hoverBg,
        '--chip-color': styles.color,
      } as React.CSSProperties}
      onClick={isClickable ? onClick : undefined}
    >
      {icon && (
        <span
          className={cn('flex items-center', size === 'sm' ? 'text-xs' : 'text-sm')}
          style={{ color: styles.color }}
        >
          {icon}
        </span>
      )}
      <span
        className={cn(
          'whitespace-nowrap font-mono font-medium leading-[1.2]',
          size === 'sm' ? 'text-xs' : 'text-sm',
        )}
        style={{ color: styles.color }}
      >
        {children}
      </span>
      {isLocked && (
        <span className="flex items-center opacity-60" style={{ color: styles.color }}>
          <LuLock size={10} />
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          className="ml-0.5 flex items-center justify-center rounded-sm p-0.5 opacity-50 hover:bg-muted hover:opacity-100"
          style={{ color: styles.color }}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <LuX size={12} />
        </button>
      )}
    </div>
  );
}

// Add button styled as chip
interface AddChipButtonProps {
  onClick: () => void;
  variant?: ChipVariant;
  size?: 'sm' | 'md';
}

export function AddChipButton({ onClick, variant = 'neutral', size = 'sm' }: AddChipButtonProps) {
  const styles = useChipVariantStyles(variant);

  return (
    <button
      type="button"
      className={cn(
        'flex cursor-pointer items-center justify-center rounded-md border border-dashed bg-transparent transition-all duration-150 ease-in-out',
        'border-[var(--chip-border)] hover:border-solid hover:border-[var(--chip-color)] hover:bg-[var(--chip-bg)]',
        size === 'sm' ? 'px-2 py-1' : 'px-2.5 py-1.5',
      )}
      style={{
        '--chip-bg': styles.bg,
        '--chip-border': styles.border,
        '--chip-color': styles.color,
      } as React.CSSProperties}
      onClick={onClick}
    >
      <span
        className={cn('font-mono font-medium leading-none', size === 'sm' ? 'text-sm' : 'text-base')}
        style={{ color: styles.color }}
      >
        +
      </span>
    </button>
  );
}

// Column type icon helper
export function getColumnIcon(type?: string) {
  if (!type) return <LuType size={12} />;
  const t = type.toLowerCase();
  if (t.includes('int') || t.includes('float') || t.includes('decimal') || t.includes('numeric')) {
    return <LuHash size={12} />;
  }
  if (t.includes('date') || t.includes('time')) {
    return <LuCalendar size={12} />;
  }
  return <LuType size={12} />;
}
