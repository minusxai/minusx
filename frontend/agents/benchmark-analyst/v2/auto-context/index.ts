/**
 * Public surface of the AutoContext module. The implementation lives in
 * `auto-context.ts` (single-file design); this index re-exports the bits
 * outside callers (benchmark registries, integration code) need.
 */
export {
  AutoContextAgent,
  SubmitSchemaInfo,
  ensureAutoContext,
  renderGeneratedContextFromToolThread,
  clearAutoContextCache,
  type AutoContextPayload,
  type Annotation,
  type AutoContextWrapperDetails,
} from './auto-context';
