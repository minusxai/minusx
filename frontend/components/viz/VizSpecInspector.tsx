'use client';

/**
 * Read-only inspector for a question's Viz V2 envelope — shows exactly the JSON the
 * agent authors/edits (the envelope; query data is bound at render, never stored).
 * Pure view: envelope in, no Redux. Lives in the question page's Viz settings panel
 * when a V2 envelope is present (the classic drop-zone panels are bypassed then).
 */
import { useState } from 'react';
import { LuChevronDown, LuChevronRight, LuCopy, LuCheck, LuUnlink, LuRotateCcw } from 'react-icons/lu';
import { Button } from '@/components/kit/button';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

export function VizSpecInspector({ envelope, onDetach, onReattach }: { envelope: VizEnvelope; onDetach?: () => void; onReattach?: () => void }) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(envelope, null, 2);
  const source = envelope.source as unknown as { kind?: string; detachedFrom?: unknown };
  const kind = source.kind;
  const isRecipe = kind === 'recipe';
  const canReattach = source.detachedFrom != null;
  const label = kind === 'recipe' ? 'recipe' : kind === 'vega' ? 'Vega spec' : 'Vega-Lite spec';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="flex items-center justify-between">
        <Button
          aria-label={open ? 'Collapse Vega spec' : 'Expand Vega spec'}
          size="xs"
          variant="ghost"
          className="px-1 font-semibold text-muted-foreground"
          onClick={() => setOpen(o => !o)}
        >
          {open ? <LuChevronDown size={14} /> : <LuChevronRight size={14} />}
          Advanced — {label}
        </Button>
        {open && (
          <Button aria-label="Copy Vega spec JSON" size="xs" variant="ghost" className="px-1 text-muted-foreground" onClick={handleCopy}>
            {copied ? <LuCheck size={13} /> : <LuCopy size={13} />}
          </Button>
        )}
      </div>
      {isRecipe && onDetach && (
        <div className="mt-1 mb-2">
          <Button
            aria-label="Customize freely"
            size="xs"
            variant="outline"
            className="border-[#16a085] text-[#16a085] hover:bg-[#16a085]/10 hover:text-[#16a085]"
            onClick={onDetach}
          >
            <LuUnlink size={13} /> Customize freely
          </Button>
          <p className="mt-1 text-[10px] leading-normal text-muted-foreground">
            Detach this recipe into its full editable spec — then ask the agent to change anything
            (colors, layers, labels…), no preset knob needed. Reversible.
          </p>
        </div>
      )}
      {canReattach && onReattach && (
        <div className="mt-1 mb-2">
          <Button aria-label="Reset to recipe" size="xs" variant="outline" onClick={onReattach}>
            <LuRotateCcw size={13} /> Reset to recipe
          </Button>
          <p className="mt-1 text-[10px] leading-normal text-muted-foreground">
            Re-attach to the original recipe — restores the preset controls and upgrades,
            discarding your custom spec edits.
          </p>
        </div>
      )}
      {open && (
        <pre
          aria-label="Vega spec JSON"
          className="mt-1 max-h-[60vh] overflow-auto whitespace-pre rounded-md border border-border bg-background p-2 font-mono text-[10.5px] leading-[1.55] text-muted-foreground"
        >
          {json}
        </pre>
      )}
      <p className="mt-1 text-[10px] leading-normal text-muted-foreground">
        This is the exact content the agent reads and edits (data is bound at render time,
        never stored in the spec). Edit via chat; the classic viz settings are bypassed
        while this spec is present.
      </p>
    </div>
  );
}
