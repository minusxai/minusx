import 'server-only';
import { validateFileState } from './content-validators';
import { getNodeConnector } from '@/lib/connections';
import { resolveConnectionSecrets } from '@/lib/secrets/connection-secrets.server';
import { materializeFileRecipe, synthesizeDummyBindings } from '@/lib/viz/recipe-file';
import { validateVizEnvelope } from '@/lib/viz/validate';
import { formatVizIssues } from '@/lib/viz/types';
import { VIZ_GRAMMAR_VEGA, VIZ_GRAMMAR_VEGA_LITE, type VizRecipeContent } from './atlas-schemas';
import type { FileType } from '@/lib/types';

/**
 * Server-only extension of validateFileState. Runs the same structural checks
 * plus an async live connection test for connection-type files and the deep
 * grammar check for viz recipe files (the Vega-Lite package schema is too large
 * for the client bundle, so the client validator stops at materialization).
 */
export async function validateFileStateServer(file: {
  type: FileType;
  content: unknown;
  name?: string;
  path?: string;
}): Promise<string | null> {
  const error = validateFileState(file);
  if (error) return error;

  if (file.type === 'viz') {
    // validateFileState already proved the recipe materializes with dummy bindings;
    // run the materialized spec through the full envelope pipeline (data policy +
    // package grammar schema). Dummy columns make the field checks self-consistent.
    const recipe = file.content as VizRecipeContent;
    const dummy = synthesizeDummyBindings(recipe);
    const materialized = materializeFileRecipe(recipe, dummy.bindings, null, dummy.columns);
    if (!materialized.ok) return `template does not materialize: ${materialized.error}`;
    const source = materialized.engine === 'vega'
      ? { kind: 'vega', grammar: VIZ_GRAMMAR_VEGA, spec: materialized.spec, assets: null, detachedFrom: null }
      : { kind: 'vega-lite', grammar: VIZ_GRAMMAR_VEGA_LITE, spec: materialized.spec, detachedFrom: null };
    const result = validateVizEnvelope({ version: 2, source }, dummy.columns);
    if (!result.ok) return `template is not a valid ${materialized.engine} spec: ${formatVizIssues(result.issues)}`;
  }

  if (file.type === 'connection') {
    const conn = file.content as any;
    // The persisted config holds @SECRETS/… refs (raw credentials live in the server-only secrets
    // table). Resolve them to real values before the live test — same as every other server-side
    // connector build (run-query, connection-loader, fuzzy-match). Otherwise a connector that parses
    // a credential field (e.g. BigQuery's JSON.parse(service_account_json)) chokes on the ref string.
    const config = await resolveConnectionSecrets(conn.config ?? {});
    const connector = getNodeConnector(file.name || '', conn.type, config);
    if (connector) {
      const result = await connector.testConnection(false);
      if (!result.success) return `Connection test failed: ${result.message}`;
    }
  }

  return null;
}
