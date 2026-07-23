'use client';

/**
 * The unified vega-tier field settings popover: alias + d3 format for one field.
 * STORAGE-AGNOSTIC — the caller supplies the current {title, format} and commits
 * changes wherever its source keeps them: native vega-lite specs write surgical
 * spec edits (channel `title` / `axis.format`), recipe sources write
 * source.columnFormats (applied at materialization). One popover, one vocabulary
 * (d3), two storage layers.
 *
 * A format that matches no preset shows as-is in the Custom d3 input — presets
 * are shortcuts, the pattern is always visible and directly editable.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LuSettings2 } from 'react-icons/lu';
import { Input } from '@/components/kit/input';
import { D3_NUMBER_PRESETS, D3_DATE_PRESETS } from '@/lib/chart/chart-format';
import type { VizColumnKind } from '@/lib/viz/types';

export interface VizFieldPopoverProps {
  /** Display key for aria labels (native: the channel, recipes: the column). */
  channel: string;
  kind: VizColumnKind;
  value: { title: string | null; format: string | null };
  onCommit: (next: { title: string | null; format: string | null }) => void;
}

const PANEL_WIDTH = 220;
const TEAL = '#16a085';

export function VizFieldPopover({ channel, kind, value, onCommit }: VizFieldPopoverProps) {
  const [open, setOpen] = useState(false);
  // Anchor position for the portaled panel, computed from the gear's rect when opened.
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [alias, setAlias] = useState(value.title ?? '');
  const [formatDraft, setFormatDraft] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setAlias(value.title ?? ''); setFormatDraft(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync drafts only on open
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const commitAlias = () => {
    onCommit({ title: alias.trim() === '' ? null : alias.trim(), format: value.format });
  };
  const commitFormat = (raw: string) => {
    onCommit({ title: value.title, format: raw.trim() === '' ? null : raw.trim() });
    setFormatDraft(null);
  };

  const presets = kind === 'temporal' ? D3_DATE_PRESETS : kind === 'quantitative' ? D3_NUMBER_PRESETS : null;
  const hasCustomization = value.title != null || value.format != null;

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={`Field settings for ${channel}`}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setPos({ top: rect.bottom + 6, left: Math.max(8, rect.right - PANEL_WIDTH) });
          setOpen(o => !o);
        }}
        className={`shrink-0 transition-colors duration-200 hover:text-[#16a085] ${hasCustomization ? 'text-[#16a085]' : 'text-muted-foreground'}`}
      >
        <LuSettings2 size={12} />
      </button>
      {open && (
        // Portaled to body: the zone chip clips its contents (overflow:hidden for name
        // ellipsis), so an in-chip absolute panel renders invisibly. Fixed-positioned
        // from the gear's rect instead. Carries its own theme host so the kit token
        // classes resolve outside the app-shell host.
        createPortal(
          <div data-mx-theme-host="">
            <div
              ref={panelRef}
              aria-label={`Field settings panel for ${channel}`}
              className="fixed z-[1500] flex flex-col gap-2 rounded-md border border-border bg-popover p-3 shadow-md"
              style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
            >
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  Alias
                </p>
                <Input
                  aria-label={`Alias for ${channel}`}
                  className="h-6 px-2 font-mono text-xs md:text-xs"
                  placeholder="display name"
                  value={alias}
                  onChange={e => setAlias(e.target.value)}
                  onBlur={commitAlias}
                  onKeyDown={e => { if (e.key === 'Enter') { commitAlias(); setOpen(false); } }}
                />
              </div>
              {presets && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                    Format
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {presets.map(({ label, format }) => (
                      <button
                        key={label}
                        type="button"
                        aria-label={`Format ${label}`}
                        onClick={() => onCommit({ title: value.title, format })}
                        className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                          value.format === format
                            ? 'border-transparent text-white'
                            : 'border-border bg-transparent text-foreground hover:bg-accent'
                        }`}
                        style={value.format === format ? { background: TEAL } : undefined}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {/* The pattern itself, always visible & editable — a non-preset value
                      (agent-authored or hand-typed) shows here instead of hiding. */}
                  <Input
                    aria-label={`Custom d3 format for ${channel}`}
                    className="mt-1.5 h-6 px-2 font-mono text-xs md:text-xs"
                    placeholder="custom d3, e.g. .2~s"
                    value={formatDraft ?? value.format ?? ''}
                    onChange={e => setFormatDraft(e.target.value)}
                    onBlur={() => { if (formatDraft != null) commitFormat(formatDraft); }}
                    onKeyDown={e => { if (e.key === 'Enter') { commitFormat((e.target as HTMLInputElement).value); } }}
                  />
                  <p className="mt-1.5 text-[9px] leading-[1.4] text-muted-foreground">
                    d3 format strings — presets fill the pattern; type your own for anything custom.
                  </p>
                </div>
              )}
            </div>
          </div>,
          document.body
        )
      )}
    </div>
  );
}
