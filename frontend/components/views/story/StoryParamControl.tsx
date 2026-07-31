'use client';

/**
 * StoryParamControl — the reader-facing filter input a story's `<Param>` renders to (File
 * Architecture v2). It writes to the shared param context (AgentHtml `values`); every
 * embedded `<Question>` re-runs with the new value.
 *
 * A source-less `<Param>` renders a labelled text/number/date input. A `<Param id={N} column>`
 * autocompletes from a saved question column; `<Param query={`…`} connection="…">` does the
 * same from the first column of story-local SQL.
 */
import { useState, type CSSProperties } from 'react';
import { LuCircleSlash2, LuPencil } from 'react-icons/lu';
import {
  isStoryQuestionParamSource,
  isStorySqlParamSource,
  type StoryParam,
} from '@/lib/data/story/story-params';
import { SourceDropdownWidget } from '@/components/params/ParameterInput';
import { InlineSqlDropdownWidget } from '@/components/params/InlineSqlDropdownWidget';
import { generateLabel } from '@/lib/sql/sql-params';

interface Props {
  param: StoryParam;
  value: unknown;
  onChange: (value: string | null) => void;
  /** Hosting story path, forwarded for public-share inline-query authorization. */
  filePath?: string;
  /** Author edit-mode affordance for query-backed autocomplete sources. */
  onRequestEdit?: () => void;
}

export default function StoryParamControl({ param, value, onChange, filePath, onRequestEdit }: Props) {
  // When the param imports a question column (<Param id={N} column="c">), offer autocomplete
  // from that column's distinct values. A query-backed source runs story-local SQL and uses its
  // first result column. Date params remain native date inputs.
  const questionSource = param.source && isStoryQuestionParamSource(param.source) ? param.source : undefined;
  const sqlSource = param.source && isStorySqlParamSource(param.source) ? param.source : undefined;
  const useQuestionDropdown = !!questionSource && param.type !== 'date';
  const useSqlDropdown = !!sqlSource && param.type !== 'date';
  // <Param widget="slider"> on a number param renders a range slider with the declared bounds.
  const useSlider = param.widget === 'slider' && param.type === 'number';
  const displayLabel = param.label?.trim() || generateLabel(param.name);
  const isAny = param.nullable && (value == null || value === '');
  // The autocomplete widgets intentionally own their draft text so live parent updates never
  // steal focus. Remount them only for this explicit external clear action.
  const [clearVersion, setClearVersion] = useState(0);
  const clearToAny = () => {
    setClearVersion((version) => version + 1);
    onChange(null);
  };
  return (
    <div className="inline-flex w-max min-w-[160px] flex-col gap-1">
      {/* Inherit the story's own text color (with slight muting) so the label stays legible on
          any story surface — an app `fg.muted` token would resolve to the host app's color mode
          across the story-iframe boundary and can vanish on a contrasting story background. */}
      {/* The agent can override the label's look via <Param labelStyle={{…}}> — literal CSS wins
          over the inherited default. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center">
          <span className="whitespace-nowrap text-xs font-semibold capitalize opacity-75" style={{ color: 'inherit', ...(param.labelStyle as CSSProperties | undefined) }}>
            {displayLabel}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {param.nullable && (
            <button
              type="button"
              aria-label={`Any ${displayLabel}`}
              aria-pressed={isAny}
              title={isAny ? 'No filter applied' : 'Don’t filter'}
              onClick={clearToAny}
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold leading-none transition-[filter] hover:brightness-95"
              style={{
                background: isAny ? '#ecfdf5' : 'rgba(255, 255, 255, 0.72)',
                borderColor: isAny ? '#16a085' : '#d1d5db',
                color: isAny ? '#0f766e' : '#6b7280',
              }}
            >
              <LuCircleSlash2 aria-hidden="true" size={12} strokeWidth={2.25} />
              Any
            </button>
          )}
          {sqlSource && onRequestEdit && (
            <button
              type="button"
              aria-label={`Edit ${param.name} options query`}
              title="Edit options SQL"
              onClick={onRequestEdit}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium opacity-70 transition-opacity hover:opacity-100"
              style={{ color: 'inherit' }}
            >
              <LuPencil size={11} />
              <span>Edit SQL</span>
            </button>
          )}
        </div>
      </div>
      {useSlider ? (
        // A native range input — iframe-boundary-safe (Chakra's Slider resolves theme tokens
        // against the host app's color mode across the story-iframe boundary, same hazard the
        // source dropdown's native <datalist> avoids). Themeable via <Param style={{accentColor:…}}>.
        <div className="inline-flex w-full items-center gap-2">
          <input
            type="range"
            aria-label={`param ${param.name}`}
            min={param.min ?? 0}
            max={param.max ?? 100}
            step={param.step ?? 1}
            value={value == null ? String(param.min ?? 0) : String(value)}
            onChange={(e) => onChange(e.target.value)}
            title={isAny ? 'Move the slider to set a value' : undefined}
            style={{ accentColor: '#c8781a', cursor: 'pointer', opacity: isAny ? 0.55 : 1, ...(param.style as CSSProperties | undefined), flex: 1, minWidth: 0 }}
          />
          <span className="min-w-[2ch] text-xs opacity-80" style={{ color: 'inherit', fontVariantNumeric: 'tabular-nums' }}>
            {isAny ? '—' : String(value)}
          </span>
        </div>
      ) : useQuestionDropdown && questionSource ? (
        // Do NOT key this on `value`: every keystroke commits live and would remount the field.
        // `clearVersion` changes only when the separate Any action intentionally clears it.
        <SourceDropdownWidget
          key={`question-source-${clearVersion}`}
          source={{ type: 'question', id: questionSource.questionId, column: questionSource.column }}
          paramType={param.type === 'number' ? 'number' : 'text'}
          currentValue={value == null ? undefined : (value as string | number)}
          paramName={param.name}
          inputStyle={{ ...(param.style as CSSProperties | undefined), width: '100%' }}
          onChange={(v) => onChange(v === '' || v == null ? null : String(v))}
        />
      ) : useSqlDropdown && sqlSource ? (
        <InlineSqlDropdownWidget
          key={`sql-source-${clearVersion}`}
          source={{ type: 'sql', query: sqlSource.query }}
          database={sqlSource.connection}
          filePath={filePath}
          paramType={param.type === 'number' ? 'number' : 'text'}
          currentValue={value == null ? undefined : (value as string | number)}
          paramName={param.name}
          inputStyle={{
            minWidth: '120px',
            border: '1px solid #d1d5db',
            borderRadius: '0.375rem',
            background: 'white',
            color: '#111827',
            fontFamily: param.type === 'number' ? 'var(--font-mono, monospace)' : 'inherit',
            ...(param.style as CSSProperties | undefined),
            width: '100%',
          }}
          onChange={(v) => onChange(v === '' || v == null ? null : String(v))}
        />
      ) : (
        <input
          type={param.type === 'number' ? 'number' : param.type === 'date' ? 'date' : 'text'}
          aria-label={`param ${param.name}`}
          value={value == null ? '' : String(value)}
          placeholder={`Enter ${param.name}`}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          // Explicit light colors (not tokens): a self-contained light form control stays legible
          // on any story surface regardless of the surrounding theme/color mode.
          className="h-8 w-full rounded-md border px-2 text-sm outline-none"
          // Agent override (<Param style={{…}}>) — literal CSS, wins over the defaults below.
          style={{ background: 'white', color: '#111827', borderColor: '#d1d5db', ...(param.style as CSSProperties | undefined), width: '100%' }}
        />
      )}
    </div>
  );
}
