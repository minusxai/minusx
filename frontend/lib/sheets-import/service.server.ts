import 'server-only';

/**
 * Agentic Sheets import — server orchestration the API routes (and the resync handler) call.
 *
 *  analyze  → download spreadsheet → extract raw grids → agent authors transforms (validated
 *             previews included) — nothing registered yet;
 *  revise   → same agent loop with the current transforms + the user's feedback;
 *  confirm  → materialize the ACCEPTED transforms to Parquet and return connection-ready
 *             CsvFileInfo records (source metadata + the transform itself attached, so the
 *             resync handler can re-run the exact same cleaning on fresh sheet data). Raw
 *             grids are transient and deleted after materialization.
 */

import { downloadSpreadsheetAsXlsx, parseSpreadsheetId, deleteS3File } from '@/lib/csv-processor';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { CsvFileInfo } from '@/lib/types/connections';
import { extractRawGrids } from './raw-grid';
import { materializeTransforms, previewTransform } from './executor';
import { authorSheetTransforms, type AuthoredTransforms } from './analyst.server';
import type { RawGridFile, SheetTransform, TransformPreview } from './types';

export interface AnalyzeResult extends AuthoredTransforms {
  spreadsheet_id: string;
  raw_files: RawGridFile[];
}

/**
 * Raw-file keys always live under the connection's own raw prefix. Enforced on every entry
 * point that accepts client-supplied raw files (revise/confirm round-trip them through the
 * browser) so a tampered key can't point the executor at another connection's data.
 */
function assertRawKeysInPrefix(rawFiles: RawGridFile[], mode: string, connectionName: string): void {
  const prefix = `csvs/${mode}/${connectionName}/raw/`;
  for (const f of rawFiles) {
    if (!f.s3_key.startsWith(prefix)) {
      throw new Error(`Raw grid key "${f.s3_key}" is outside the connection prefix "${prefix}"`);
    }
  }
}

/** Download the spreadsheet, extract raw grids, and have the agent author validated transforms. */
export async function analyzeSpreadsheet(params: {
  spreadsheetUrl: string;
  connectionName: string;
  user: EffectiveUser;
}): Promise<AnalyzeResult> {
  const { spreadsheetUrl, connectionName, user } = params;
  const mode = user.mode;
  const spreadsheetId = parseSpreadsheetId(spreadsheetUrl);
  const xlsx = await downloadSpreadsheetAsXlsx(spreadsheetId);

  const createdKeys: string[] = [];
  try {
    const rawFiles = await extractRawGrids(xlsx, connectionName, mode, createdKeys);
    const authored = await authorSheetTransforms({ rawFiles, user, mode, connectionName });
    return { spreadsheet_id: spreadsheetId, raw_files: rawFiles, ...authored };
  } catch (err) {
    // Analysis failed — don't leave orphaned raw grids behind.
    await Promise.allSettled(createdKeys.map(key => deleteS3File(key)));
    throw err;
  }
}

/**
 * Post-import adjustment, step 1: re-download the live sheet, re-extract raw grids, and preview
 * the STORED transforms against the fresh data — no LLM call. Transforms the live sheet broke
 * go to `dropped` (with the error) so the user sees exactly what no longer runs; the rest pass
 * through untouched, ready for the same revise/confirm loop as a first import.
 */
export async function prepareSheetAdjustment(params: {
  spreadsheetUrl: string;
  transforms: SheetTransform[];
  connectionName: string;
  user: EffectiveUser;
}): Promise<AnalyzeResult> {
  const { spreadsheetUrl, transforms, connectionName, user } = params;
  const mode = user.mode;
  const spreadsheetId = parseSpreadsheetId(spreadsheetUrl);
  const xlsx = await downloadSpreadsheetAsXlsx(spreadsheetId);

  const createdKeys: string[] = [];
  try {
    const rawFiles = await extractRawGrids(xlsx, connectionName, mode, createdKeys);
    const kept: SheetTransform[] = [];
    const previews: Record<string, TransformPreview> = {};
    const dropped: string[] = [];
    for (const t of transforms) {
      try {
        previews[t.output_table] = await previewTransform(rawFiles, t, 50, mode, connectionName);
        kept.push(t);
      } catch (err) {
        dropped.push(`- ${t.output_table}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { spreadsheet_id: spreadsheetId, raw_files: rawFiles, transforms: kept, previews, dropped };
  } catch (err) {
    await Promise.allSettled(createdKeys.map(key => deleteS3File(key)));
    throw err;
  }
}

/** Delete transient raw grids (wizard cancelled). Prefix-guarded like every client round-trip. */
export async function discardRawGrids(params: {
  rawFiles: RawGridFile[];
  connectionName: string;
  user: EffectiveUser;
}): Promise<void> {
  const { rawFiles, connectionName, user } = params;
  assertRawKeysInPrefix(rawFiles, user.mode, connectionName);
  await Promise.allSettled(rawFiles.map(f => deleteS3File(f.s3_key)));
}

/** Re-run the agent over the SAME raw grids with the user's feedback on the current transforms. */
export async function reviseSheetTransforms(params: {
  rawFiles: RawGridFile[];
  transforms: SheetTransform[];
  feedback: string;
  connectionName: string;
  user: EffectiveUser;
}): Promise<AuthoredTransforms> {
  const { rawFiles, transforms, feedback, connectionName, user } = params;
  assertRawKeysInPrefix(rawFiles, user.mode, connectionName);
  return authorSheetTransforms({
    rawFiles,
    user,
    mode: user.mode,
    connectionName,
    previousTransforms: transforms,
    feedback,
  });
}

/**
 * Materialize the accepted transforms and return connection-ready file records. Raw grids are
 * deleted afterwards (best-effort) — resync re-extracts them fresh from the live sheet.
 */
export async function confirmSheetImport(params: {
  spreadsheetUrl: string;
  rawFiles: RawGridFile[];
  transforms: SheetTransform[];
  connectionName: string;
  user: EffectiveUser;
}): Promise<CsvFileInfo[]> {
  const { spreadsheetUrl, rawFiles, transforms, connectionName, user } = params;
  const mode = user.mode;
  assertRawKeysInPrefix(rawFiles, mode, connectionName);
  if (transforms.length === 0) throw new Error('No transforms to import');
  const spreadsheetId = parseSpreadsheetId(spreadsheetUrl);

  const registered = await materializeTransforms(mode, connectionName, rawFiles, transforms);
  const byTable = new Map(transforms.map(t => [t.output_table, t]));
  const files: CsvFileInfo[] = registered.map(f => ({
    ...f,
    source_type: 'google_sheets' as const,
    spreadsheet_url: spreadsheetUrl,
    spreadsheet_id: spreadsheetId,
    transform: byTable.get(f.table_name),
  }));

  // Raw grids are transient — clean up after the outputs are safely written.
  await Promise.allSettled(rawFiles.map(f => deleteS3File(f.s3_key)));
  return files;
}
