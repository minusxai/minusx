/**
 * Chat Architecture v3 — backfill core (shared by the CLI script and the in-process admin endpoint).
 *
 * Ports conversation FILES (type='conversation') into the v3 tables, preserving each id. v=2 files
 * already hold the pi log; v=1 (legacy task-log) files are converted via legacyLogToPi. errors[] →
 * the error stream (kind='error' rows in messages). Idempotent: an id already present in `conversations` is skipped, and source
 * files are left intact (safe to re-run). See docs/chat-architecture-v3.md §11.
 */
import { getModules } from '@/lib/modules/registry';
import { legacyLogToPi } from '@/lib/chat-translator';
import { createConversation, appendMessages, appendError, getConversation } from '@/lib/data/conversations.server';
import type { ConversationLog } from '@/orchestrator/types';

export interface MigrationReport {
  found: number;
  migrated: number;
  skipped: number;
  emptyLog: number;
  failed: number;
  dry: boolean;
  failures: Array<{ id: number; error: string }>;
}

interface FileRow {
  id: number; name: string; path: string; content: unknown; meta: unknown;
}

function asObj<T = Record<string, unknown>>(v: unknown): T {
  return (typeof v === 'string' ? JSON.parse(v) : v) as T;
}

/** Mode is the first path segment: /org/... | /tutorial/... */
function modeFromPath(path: string): string {
  const seg = (path ?? '').replace(/^\/+/, '').split('/')[0];
  return seg || 'org';
}

export async function migrateConversationsToV3(opts: { dry?: boolean } = {}): Promise<MigrationReport> {
  const dry = !!opts.dry;
  const db = getModules().db;
  const { rows } = await db.exec<FileRow>(
    `SELECT id, name, path, content, meta FROM files WHERE type = 'conversation' ORDER BY id`,
  );

  const report: MigrationReport = { found: rows.length, migrated: 0, skipped: 0, emptyLog: 0, failed: 0, dry, failures: [] };

  for (const file of rows) {
    try {
      if (await getConversation(file.id)) { report.skipped++; continue; }

      const content = asObj<{ log?: unknown[]; metadata?: { userId?: unknown }; errors?: unknown[] }>(file.content) ?? {};
      const meta = asObj<{ version?: number; firstMessage?: string; forkedFrom?: number }>(file.meta) ?? {};
      const rawLog = Array.isArray(content.log) ? content.log : [];
      const piLog: ConversationLog = (meta.version === 2 ? rawLog : legacyLogToPi(rawLog as never)) as unknown as ConversationLog;

      const ownerId = Number.parseInt(String(content.metadata?.userId ?? '1'), 10) || 1;
      const mode = modeFromPath(file.path);
      const title = meta.firstMessage || file.name || 'Conversation';

      if (dry) { report.migrated++; continue; }

      await createConversation({
        ownerUserId: ownerId, mode, agent: 'WebAnalystAgent', title, explicitId: file.id,
        meta: { version: 3, migratedFromFileId: file.id, originalVersion: meta.version ?? 1, ...(meta.forkedFrom ? { forkedFrom: meta.forkedFrom } : {}) },
      });
      if (piLog.length > 0) await appendMessages(file.id, piLog, 0);
      else report.emptyLog++;

      for (const e of (Array.isArray(content.errors) ? content.errors : [])) {
        const err = e as { source?: string; message?: string; parent_id?: string; details?: Record<string, unknown> };
        await appendError(file.id, { source: err.source ?? 'unhandled', message: err.message ?? '', parentPiId: err.parent_id ?? null, details: err.details ?? null });
      }
      report.migrated++;
    } catch (e) {
      report.failed++;
      report.failures.push({ id: file.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return report;
}
