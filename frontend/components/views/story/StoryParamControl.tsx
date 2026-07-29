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
import type { CSSProperties } from 'react';
import { LuPencil } from 'react-icons/lu';
import {
  isStoryQuestionParamSource,
  isStorySqlParamSource,
  type StoryParam,
} from '@/lib/data/story/story-params';
import { SourceDropdownWidget } from '@/components/params/ParameterInput';
import { InlineSqlDropdownWidget } from '@/components/params/InlineSqlDropdownWidget';

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
  return (
    <div className="inline-flex min-w-[160px] flex-col gap-1">
      {/* Inherit the story's own text color (with slight muting) so the label stays legible on
          any story surface — an app `fg.muted` token would resolve to the host app's color mode
          across the shadow boundary and can vanish on a contrasting story background. */}
      {/* The agent can override the label's look via <Param labelStyle={{…}}> — literal CSS wins
          over the inherited default. */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold capitalize opacity-70" style={{ color: 'inherit', ...(param.labelStyle as CSSProperties | undefined) }}>
          {param.name}
        </span>
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
      {useSlider ? (
        // A native range input — shadow-boundary-safe (Chakra's Slider resolves theme tokens
        // against the host app's color mode across the shadow root, same hazard the source
        // dropdown's native <datalist> avoids). Themeable via <Param style={{accentColor:…}}>.
        <div className="inline-flex items-center gap-2">
          <input
            type="range"
            aria-label={`param ${param.name}`}
            min={param.min ?? 0}
            max={param.max ?? 100}
            step={param.step ?? 1}
            value={value == null ? String(param.min ?? 0) : String(value)}
            onChange={(e) => onChange(e.target.value)}
            style={{ accentColor: '#c8781a', cursor: 'pointer', ...(param.style as CSSProperties | undefined) }}
          />
          <span className="min-w-[2ch] text-xs opacity-80" style={{ color: 'inherit', fontVariantNumeric: 'tabular-nums' }}>
            {value == null ? (param.min ?? 0) : String(value)}
          </span>
        </div>
      ) : useQuestionDropdown && questionSource ? (
        // NOTE: do NOT key this on `value`. Each keystroke commits the value (so embeds re-run
        // live), which would change the key and REMOUNT the input mid-type — the field loses
        // focus on every character and on backspace. The widget syncs to external value changes
        // internally instead (it stays mounted, so focus is preserved while typing).
        <SourceDropdownWidget
          source={{ type: 'question', id: questionSource.questionId, column: questionSource.column }}
          paramType={param.type === 'number' ? 'number' : 'text'}
          currentValue={value == null ? undefined : (value as string | number)}
          paramName={param.name}
          inputStyle={param.style as CSSProperties | undefined}
          onChange={(v) => onChange(v === '' || v == null ? null : String(v))}
        />
      ) : useSqlDropdown && sqlSource ? (
        <InlineSqlDropdownWidget
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
          }}
          onChange={(v) => onChange(v === '' || v == null ? null : String(v))}
        />
      ) : (
        <input
          type={param.type === 'number' ? 'number' : param.type === 'date' ? 'date' : 'text'}
          aria-label={`param ${param.name}`}
          value={value == null ? '' : String(value)}
          placeholder={param.nullable ? 'Any' : `Enter ${param.name}`}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          // Explicit light colors (not tokens): a self-contained light form control stays legible
          // on any story surface regardless of the surrounding theme/color mode.
          className="h-8 rounded-md border px-2 text-sm outline-none"
          // Agent override (<Param style={{…}}>) — literal CSS, wins over the defaults below.
          style={{ background: 'white', color: '#111827', borderColor: '#d1d5db', ...(param.style as CSSProperties | undefined) }}
        />
      )}
    </div>
  );
}
