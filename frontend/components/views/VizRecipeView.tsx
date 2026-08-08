'use client';

/**
 * Read + edit surface for a `viz` recipe file: a live preview rendered from
 * SAMPLE data shaped by the declared slots (no query runs here), the binding
 * slots and params, and the template. In EDIT mode the description and the
 * template JSON are directly editable — commits go through the container's
 * validated full-replace path (the same gate as the File tab), so an invalid
 * template or undeclared token is rejected with the reason shown inline.
 * Kit/Tailwind, no Redux; the page owns scrolling (the file type is full-flow).
 */
import { useMemo, useState } from 'react';
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
  /** Edit mode: description + template become editable, committed on blur. */
  editable?: boolean;
  /** Validated full-replace commit of the whole content JSON (File-tab path). */
  onCommitContent?: (jsonString: string) => { success: boolean; error?: string };
}

export default function VizRecipeView({ content, colorMode, editable = false, onCommitContent }: VizRecipeViewProps) {
  // Drafts live only while the field is focused; null = mirror the stored value.
  const [templateDraft, setTemplateDraft] = useState<string | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const preview = useMemo(() => {
    const sample = sampleDataForRecipe(content);
    const materialized = materializeFileRecipe(content, sample.bindings, null, sample.columns);
    if (!materialized.ok) return { error: materialized.error, envelope: null, rows: [] as Record<string, unknown>[] };
    const source = materialized.engine === 'vega'
      ? { kind: 'vega', grammar: VIZ_GRAMMAR_VEGA, spec: materialized.spec, assets: null, detachedFrom: null }
      : { kind: 'vega-lite', grammar: VIZ_GRAMMAR_VEGA_LITE, spec: materialized.spec, detachedFrom: null };
    return { error: null, envelope: { version: 2, source } as unknown as VizEnvelope, rows: sample.rows };
  }, [content]);

  const commit = (next: Partial<VizRecipeContent>) => {
    if (!onCommitContent) return;
    const result = onCommitContent(JSON.stringify({ ...content, ...next }));
    setEditError(result.success ? null : (result.error ?? 'Save failed'));
    if (result.success) { setTemplateDraft(null); setDescriptionDraft(null); }
  };

  const commitTemplate = () => {
    if (templateDraft == null) return;
    try {
      commit({ template: JSON.parse(templateDraft) });
    } catch (e) {
      setEditError(`Template is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div aria-label="Chart recipe" className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      {editable ? (
        <input
          aria-label="Recipe description editor"
          className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring"
          value={descriptionDraft ?? content.description}
          onChange={(e) => setDescriptionDraft(e.target.value)}
          onBlur={() => { if (descriptionDraft != null && descriptionDraft !== content.description) commit({ description: descriptionDraft }); }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{content.description}</p>
      )}

      {editError && (
        <p aria-label="Recipe editor error" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          {editError}
        </p>
      )}

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
          Template ({content.engine}){editable ? ' — edits commit when you click away' : ''}
        </div>
        {editable ? (
          <textarea
            aria-label="Recipe template editor"
            spellCheck={false}
            className="min-h-[360px] w-full resize-y rounded bg-muted/50 p-2 font-mono text-xs leading-relaxed text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={templateDraft ?? JSON.stringify(content.template, null, 2)}
            onChange={(e) => setTemplateDraft(e.target.value)}
            onBlur={commitTemplate}
          />
        ) : (
          <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-xs leading-relaxed">
            {JSON.stringify(content.template, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
