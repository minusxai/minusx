/**
 * Public surface of the AutoContext module. `auto-context.ts` is the module's
 * aggregator — it owns the ensureAutoContext orchestration and re-exports the
 * pieces from `agent.ts` / `generation.ts` / `catalog-render.ts`; this index
 * narrows that to the bits outside callers (benchmark registries, integration
 * code) need.
 */
export {
  AutoContextAgent,
  SubmitSchemaInfo,
  runAutoContextForSlot,
  type AutoContextRunResult,
  type AutoContextPayload,
  type Annotation,
} from './auto-context';
