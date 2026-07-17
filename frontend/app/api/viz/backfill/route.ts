/**
 * POST /api/viz/backfill — the non-destructive Viz V2 re-derivation (Data Management).
 *
 * FILE-LEVEL and executeless: NO query is ever run (a workspace can hold hundreds
 * of questions — see the v37 data migration, which uses the same converter). For
 * every question in the CURRENT MODE, derives a V2 envelope from its `vizSettings`
 * via `vizSettingsToEnvelopeStatic` — column kinds come from the conservative
 * name heuristic plus query-text signals (DATE_TRUNC/casts). `vizSettings` is
 * NEVER modified (the V1 rollback path). Body flags: `dryRun` reports without
 * writing; `overwrite` re-derives over an existing envelope (reruns converge),
 * guarded against downgrading a hand-authored chart to a DOM-tier derivation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { handleApiError } from '@/lib/http/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';
import { FilesAPI } from '@/lib/data/files.server';
import { vizSettingsToEnvelopeStatic } from '@/lib/viz/from-vizsettings';
import { isEnvelopeImageViz } from '@/lib/viz/encoding-edit';
import type { QuestionContent } from '@/lib/types';

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

    // Pure per-file conversion — no query execution, so even hundreds of files are fast.
    for (const file of files) {
      const content = file.content as QuestionContent;
      const existing = content.viz ?? null;
      if (existing != null && !overwrite) { alreadyV2++; continue; }
      const vizType = content.vizSettings?.type;
      if (!vizType) { skipped.push({ id: file.id, name: file.name, reason: 'no vizSettings' }); continue; }
      try {
        const viz = vizSettingsToEnvelopeStatic(content.vizSettings, content.query);
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
