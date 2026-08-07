'use client';

/**
 * Read surface for a `viz` recipe file: what the recipe looks like (a live
 * preview rendered from SAMPLE data shaped by the declared slots — no query
 * runs here), its binding slots and params, and the raw template. Editing goes
 * through the shared File/Markup tabs (CodeView) or the agent — this view is
 * pure presentation. Kit/Tailwind, no Redux.
 */
import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { VizEnvelope, VizRecipeContent } from '@/lib/validation/atlas-schemas';
import { materializeFileRecipe, sampleDataForRecipe } from '@/lib/viz/recipe-file';
import { VIZ_GRAMMAR_VEGA, VIZ_GRAMMAR_VEGA_LITE } from '@/lib/validation/atlas-schemas';

// Lazy chunk — vega/vega-lite only load on pages that render a chart (the same
// sanctioned pattern as QuestionVisualization's VegaChart).
// eslint-disable-next-line no-restricted-syntax
const VegaChart = dynamic(() => import('@/components/viz/VegaChart'), { ssr: false });

export interface VizRecipeViewProps {
  content: VizRecipeContent;
  colorMode: 'light' | 'dark';
}

export default function VizRecipeView({ content, colorMode }: VizRecipeViewProps) {
  const preview = useMemo(() => {
    const sample = sampleDataForRecipe(content);
    const materialized = materializeFileRecipe(content, sample.bindings, null, sample.columns);
    if (!materialized.ok) return { error: materialized.error, envelope: null, rows: [] as Record<string, unknown>[] };
    const source = materialized.engine === 'vega'
      ? { kind: 'vega', grammar: VIZ_GRAMMAR_VEGA, spec: materialized.spec, assets: null, detachedFrom: null }
      : { kind: 'vega-lite', grammar: VIZ_GRAMMAR_VEGA_LITE, spec: materialized.spec, detachedFrom: null };
    return { error: null, envelope: { version: 2, source } as unknown as VizEnvelope, rows: sample.rows };
  }, [content]);

  return (
    <div aria-label="Chart recipe" className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <p className="text-sm text-muted-foreground">{content.description}</p>

      <div aria-label="Recipe preview" className="rounded-md border border-border bg-card p-3">
        <div className="pb-2 text-[10px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
          Preview (sample data)
        </div>
        {preview.error ? (
          <p className="py-6 text-center text-sm text-destructive">{preview.error}</p>
        ) : (
          <div className="flex h-[320px]">
            {/* VegaChart's root is flex-1 — it sizes from a FLEX parent with a definite height. */}
            <VegaChart envelope={preview.envelope!} rows={preview.rows} colorMode={colorMode} />
          </div>
        )}
      </div>

      <div aria-label="Recipe slots" className="rounded-md border border-border bg-card p-3">
        <div className="pb-2 text-[10px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
          Binding slots
        </div>
        <ul className="flex flex-col gap-1">
          {content.bindings.map((b) => (
            <li key={b.name} className="flex items-baseline gap-2 text-sm">
              <span className="font-mono font-semibold">{b.name}</span>
              <span className="text-muted-foreground">{b.label}</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {b.accepts.join(' | ')}{b.multi ? ' (multi)' : ''}
              </span>
            </li>
          ))}
        </ul>
        {content.params?.length ? (
          <>
            <div className="pb-2 pt-3 text-[10px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
              Params
            </div>
            <ul className="flex flex-col gap-1">
              {content.params.map((p) => (
                <li key={p.name} className="flex items-baseline gap-2 text-sm">
                  <span className="font-mono font-semibold">{p.name}</span>
                  <span className="text-muted-foreground">{p.label}</span>
                  {p.default !== undefined && (
                    <span className="ml-auto font-mono text-xs text-muted-foreground">default: {String(p.default)}</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <div aria-label="Recipe template" className="rounded-md border border-border bg-card p-3">
        <div className="pb-2 text-[10px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
          Template ({content.engine})
        </div>
        <pre className="max-h-[400px] overflow-auto rounded bg-muted/50 p-2 font-mono text-xs leading-relaxed">
          {JSON.stringify(content.template, null, 2)}
        </pre>
      </div>
    </div>
  );
}
