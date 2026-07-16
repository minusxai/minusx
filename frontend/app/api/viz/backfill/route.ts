/**
 * POST /api/viz/backfill — the non-destructive Viz V2 migration (Data Management).
 *
 * For every question that still lacks a `viz` envelope, converts its `vizSettings`
 * to a V2 envelope and writes it ALONGSIDE the untouched vizSettings — never
 * removing or altering the V1 settings, which remain the rollback path if the
 * workspace flips the format default back to V1. Idempotent: envelope-bearing
 * files are counted and skipped.
 *
 * Cartesian chart types (bar/line/area/scatter/row/pie) are converted with the
 * question's REAL result columns (executed through the shared query cache) so
 * temporal axes survive; a failing query SKIPS the file rather than writing a
 * degraded envelope — such files keep rendering via the client's JIT bridge.
 * DOM-tier (table/pivot) and recipe types (funnel/trend/geo/…) convert without
 * executing (their envelopes carry no column kinds).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { handleApiError } from '@/lib/http/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { FilesAPI } from '@/lib/data/files.server';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { vizSettingsToEnvelope } from '@/lib/viz/from-vizsettings';
import { isEnvelopeImageViz } from '@/lib/viz/encoding-edit';
import { toVizColumns } from '@/lib/viz/query-data';
import { getCachedResultBounded } from '@/lib/query-cache/execute.server';
import { resolveCachePolicy } from '@/lib/query-cache/policy.server';
import { runQueryStream } from '@/lib/connections/run-query';
import { applyNoneParams } from '@/lib/sql/none-params';
import { buildQueryParamValues } from '@/lib/sql/sql-params';
import { connectionTypeToDialect } from '@/lib/types';
import type { QuestionContent } from '@/lib/types';
import type { VizResultColumn } from '@/lib/viz/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

import { immutableSet } from '@/lib/utils/immutable-collections';

/** Types whose conversion benefits from real column kinds (temporal axes). */
const NEEDS_COLUMNS = immutableSet(['bar', 'line', 'area', 'scatter', 'row', 'pie']);

/** Columns/types of the question's result via the shared query cache (1-row drain). */
async function resultColumns(content: QuestionContent, user: EffectiveUser): Promise<VizResultColumn[]> {
  const params = buildQueryParamValues(content.parameters ?? [], content.parameterValues ?? {}, {});
  const paramsForNone: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === null || typeof v === 'string' || typeof v === 'number') paramsForNone[k] = v;
    else if (v !== undefined) paramsForNone[k] = String(v);
  }
  const raw = await ConnectionsAPI.getRawByName(content.connection_name, user.mode).catch(() => null);
  const dialect = connectionTypeToDialect(raw?.type ?? '');
  const { sql, params: execParams } = await applyNoneParams(content.query, paramsForNone, dialect);
  const { result } = await getCachedResultBounded({
    mode: user.mode,
    connectionName: content.connection_name,
    query: sql,
    params: execParams,
    policy: resolveCachePolicy(content.cachePolicy ?? null),
    execute: async () => runQueryStream(content.connection_name, sql, execParams, user),
  }, { maxRows: 1, maxBytes: 64 * 1024 });
  return toVizColumns(result.columns, result.types);
}

export async function POST(req: NextRequest) {
  try {
    const user = await getEffectiveUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!isAdmin(user.role)) return NextResponse.json({ success: false, error: 'Admin only' }, { status: 403 });

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const dryRun = body?.dryRun === true;
    // Overwrite: re-derive envelopes from vizSettings even when one exists (rerun-safe —
    // vizSettings is never modified, so a rerun converges on the same derivation).
    const overwrite = body?.overwrite === true;

    // Full-depth listing: questions live at arbitrary folder depths.
    const listing = await FilesAPI.getFiles({ type: 'question', depth: 1_000 }, user);
    const ids = listing.data.map(f => f.id);
    const files = ids.length > 0 ? (await FilesAPI.loadFiles(ids, user)).data : [];

    let upgraded = 0;    // envelopes added where none existed
    let overwritten = 0; // envelopes re-derived over an existing one (overwrite mode)
    let alreadyV2 = 0;   // left alone (fill mode)
    const skipped: Array<{ id: number; name: string; reason: string }> = [];

    // Serial on purpose: an explicit admin action; each miss executes a real query.
    for (const file of files) {
      const content = file.content as QuestionContent;
      const existing = content.viz ?? null;
      if (existing != null && !overwrite) { alreadyV2++; continue; }
      const vizType = content.vizSettings?.type;
      if (!vizType) { skipped.push({ id: file.id, name: file.name, reason: 'no vizSettings' }); continue; }
      try {
        let columns: VizResultColumn[] | undefined;
        if (NEEDS_COLUMNS.has(vizType)) {
          if (!content.query || !content.connection_name) {
            skipped.push({ id: file.id, name: file.name, reason: 'no query/connection' });
            continue;
          }
          columns = await resultColumns(content, user);
        }
        const viz = vizSettingsToEnvelope(content.vizSettings, columns);
        // Downgrade guard: never replace a hand-authored CHART envelope with a DOM-tier
        // derivation (post-V2 files carry the template's table vizSettings while the real
        // chart lives only in `viz` — re-deriving would destroy it).
        if (existing != null && isEnvelopeImageViz(existing) && !isEnvelopeImageViz(viz)) {
          skipped.push({ id: file.id, name: file.name, reason: 'existing chart envelope; vizSettings would downgrade it to table/pivot' });
          continue;
        }
        // Additive write: `viz` joins the content; vizSettings stays byte-identical.
        if (!dryRun) {
          await FilesAPI.saveFile(file.id, file.name, file.path, { ...content, viz }, file.references ?? [], user);
        }
        if (existing != null) overwritten++;
        else upgraded++;
      } catch (err) {
        skipped.push({ id: file.id, name: file.name, reason: err instanceof Error ? err.message : 'conversion failed' });
      }
    }

    return NextResponse.json({ success: true, data: { total: files.length, upgraded, overwritten, alreadyV2, skipped, dryRun } });
  } catch (error) {
    return handleApiError(error);
  }
}
