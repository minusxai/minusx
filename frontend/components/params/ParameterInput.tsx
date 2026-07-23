'use client';

import React from 'react';
import { LuBan } from 'react-icons/lu';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/kit/tooltip';
import { QuestionParameter } from '@/lib/types';
import type { QuestionParameterSource, SqlParameterSource } from '@/lib/validation/atlas-schemas';
import { getTypeColor, getTypeIcon } from '@/lib/sql/param-type-display';
import { getParameterDisplayName } from '@/lib/sql/sql-params';
import DatePicker from '../selectors/DatePicker';
import { SourceDropdownWidget } from './SourceDropdownWidget';
import { InlineSqlDropdownWidget } from './InlineSqlDropdownWidget';
import { SourceConfigPopover } from './SourceConfigPopover';
import { ROW_H } from './paramInputShared';

// Re-exported so existing consumers (e.g. StoryParamControl) can keep importing
// `SourceDropdownWidget` from '@/components/params/ParameterInput' unchanged.
export { SourceDropdownWidget } from './SourceDropdownWidget';

// ─── ParameterInput ───────────────────────────────────────────────────────────

interface ParameterInputProps {
  parameter: QuestionParameter;
  value: string | number | null | undefined;
  onChange: (value: string | number | null) => void;
  onTypeChange: (type: 'text' | 'number' | 'date') => void;
  onParameterChange?: (updated: QuestionParameter) => void;
  onSubmit?: (paramName?: string, value?: string | number) => void;
  disableTypeChange?: boolean;
  disableSourceConfig?: boolean;
  onHoverParam?: (key: string | null) => void;
  database?: string;
}

export default function ParameterInput({
  parameter,
  value,
  onChange,
  onTypeChange,
  onParameterChange,
  onSubmit,
  disableTypeChange = false,
  disableSourceConfig = false,
  onHoverParam,
  database,
}: ParameterInputProps) {
  const paramKey = `${parameter.name}-${parameter.type}`;
  const hasQuestionSource = parameter.source?.type === 'question' && !!parameter.source.column;
  const hasSqlSource = parameter.source?.type === 'sql' && !!parameter.source.query;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parameter.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;
    onChange(newValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) && onSubmit) {
      e.preventDefault();
      e.stopPropagation();
      const currentValue = parameter.type === 'number'
        ? parseFloat(e.currentTarget.value) || 0
        : e.currentTarget.value;
      onSubmit(parameter.name, currentValue);
    }
  };

  const handleDateChange = (newValue: string) => {
    onChange(newValue);
    if (onSubmit) {
      onSubmit(parameter.name, newValue);
    }
  };

  const isNone = value === null;


  return (
    <div
      className="flex items-center overflow-hidden rounded-md border border-border bg-muted"
      style={{ height: ROW_H }}
      onMouseEnter={() => onHoverParam?.(paramKey)}
      onMouseLeave={() => onHoverParam?.(null)}
    >
      {/* Param label — shows the friendly display name; tooltip reveals the raw :name binding */}
      <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild={false} className="h-full shrink-0 outline-none">
          <span
            className="flex h-full items-center gap-1 px-2 font-mono text-xs font-semibold text-foreground"
            style={{ borderLeft: `3px solid ${getTypeColor(parameter.type)}`, background: `color-mix(in srgb, ${getTypeColor(parameter.type)} 20%, transparent)` }}
          >
            {React.createElement(getTypeIcon(parameter.type), { size: 11 })}
            <span aria-label={`Parameter ${parameter.name}`} className="font-mono text-xs font-semibold">{getParameterDisplayName(parameter)}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="start">{`:${parameter.name}`}</TooltipContent>
      </Tooltip>
      </TooltipProvider>

      {/* Value area */}
      {isNone ? (
        <div
          className="flex h-full cursor-pointer items-center gap-1 px-2 text-destructive transition-colors duration-100 hover:bg-destructive/10"
          onClick={() => onChange('')}
        >
          <LuBan style={{ width: 10, height: 10 }} />
          <span className="font-mono text-xs font-semibold">Skipped</span>
        </div>
      ) : (
        hasQuestionSource && parameter.type !== 'date' ? (
          <SourceDropdownWidget
            key={String(value ?? '')}
            source={parameter.source as QuestionParameterSource}
            paramType={parameter.type as 'text' | 'number'}
            currentValue={value ?? undefined}
            paramName={parameter.name}
            onChange={onChange}
            onSubmit={onSubmit}
          />
        ) : hasSqlSource && parameter.type !== 'date' ? (
          <InlineSqlDropdownWidget
            key={String(value ?? '')}
            source={parameter.source as SqlParameterSource}
            paramType={parameter.type as 'text' | 'number'}
            currentValue={value ?? undefined}
            paramName={parameter.name}
            database={database}
            onChange={onChange}
            onSubmit={onSubmit}
          />
        ) : parameter.type === 'date' ? (
          <DatePicker
            value={typeof value === 'string' ? value : ''}
            onChange={handleDateChange}
            placeholder="YYYY-MM-DD"
            ariaLabel={parameter.name}
          />
        ) : (
          <input
            value={value ?? ''}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            type={parameter.type === 'number' ? 'number' : 'text'}
            className="h-full w-[100px] border-none bg-transparent px-2 font-mono text-xs outline-none placeholder:text-muted-foreground"
            placeholder={parameter.type === 'number' ? '0' : 'value'}
            aria-label={parameter.name}
          />
        )
      )}

      {/* Actions */}
      {!isNone && (
        <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger
            className="flex h-full cursor-pointer items-center px-1.5 text-muted-foreground outline-none transition-colors duration-100 hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onChange(null)}
            aria-label="Skip this filter"
          >
            <LuBan style={{ width: 11, height: 11 }} />
          </TooltipTrigger>
          <TooltipContent>Skip this filter</TooltipContent>
        </Tooltip>
        </TooltipProvider>
      )}

      {!disableSourceConfig && onParameterChange && (
        <SourceConfigPopover
          parameter={parameter}
          onParameterChange={onParameterChange}
          onTypeChange={disableTypeChange ? undefined : onTypeChange}
          disableTypeChange={disableTypeChange}
        />
      )}
    </div>
  );
}
