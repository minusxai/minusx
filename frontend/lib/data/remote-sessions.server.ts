/**
 * Remote Agent Sessions — data layer: session-code codec, nonce hashing, liveness, and the
 * `conversations.meta.remoteSession` record. Pure code + small DB writes only; the orchestration
 * side (root invocation, dispatch driver, cleanup) lives in `lib/chat/remote-session.server.ts`.
 *
 * The code is `<conversationIdBase36>-<nonce>`: the id makes lookup O(1) (no index needed) and
 * the nonce is the only secret. Only sha256(nonce) is stored — a DB leak must not leak live
 * capability URLs. Mirrors `lib/auth/share-tokens.ts`, with a longer nonce and hashed at rest.
 */
import 'server-only';
import crypto from 'crypto';
import { REMOTE_SESSION_TTL_MS, REMOTE_SESSION_IDLE_MS } from '@/lib/config';
import { getModules } from '@/lib/modules/registry';
import type { RemoteSessionDenial, RemoteSessionRecord } from './remote-sessions.types';

const db = () => getModules().db;

const NONCE_BYTES = 16; // 128 bits → ~25 base36 chars; unguessable
const NONCE_RE = /^[0-9a-z]{16,40}$/;
const CONV_ID_RE = /^[0-9a-z]{1,10}$/;

export function generateRemoteSessionNonce(): string {
  return BigInt('0x' + crypto.randomBytes(NONCE_BYTES).toString('hex')).toString(36);
}

export function encodeRemoteSessionCode(conversationId: number, nonce: string): string {
  return `${conversationId.toString(36)}-${nonce}`;
}

/**
 * Split a code into { conversationId, nonce }, or null for anything implausible. This does NOT
 * authorize — callers must load the conversation and verify the nonce against the stored hash.
 */
export function decodeRemoteSessionCode(code: string): { conversationId: number; nonce: string } | null {
  if (!code) return null;
  const i = code.indexOf('-');
  if (i <= 0) return null;
  const idPart = code.slice(0, i);
  const nonce = code.slice(i + 1);
  if (!CONV_ID_RE.test(idPart) || !NONCE_RE.test(nonce)) return null;
  const conversationId = parseInt(idPart, 36);
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;
  return { conversationId, nonce };
}

export function hashRemoteSessionNonce(nonce: string): string {
  return crypto.createHash('sha256').update(nonce).digest('hex');
}

/** Constant-time comparison of sha256(nonce) against the stored hash. Never throws. */
export function verifyRemoteSessionNonce(nonce: string, nonceHash: string): boolean {
  const computed = Buffer.from(hashRemoteSessionNonce(nonce), 'hex');
  const stored = Buffer.from(String(nonceHash ?? ''), 'hex');
  if (computed.length !== stored.length || stored.length === 0) return false;
  return crypto.timingSafeEqual(computed, stored);
}

/** Build a fresh record (+ its plaintext nonce, returned once and never stored). */
export function buildRemoteSessionRecord(
  createdBy: number,
  now = Date.now(),
): { nonce: string; record: RemoteSessionRecord } {
  const nonce = generateRemoteSessionNonce();
  const record: RemoteSessionRecord = {
    nonceHash: hashRemoteSessionNonce(nonce),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + REMOTE_SESSION_TTL_MS).toISOString(),
    lastActivityAt: new Date(now).toISOString(),
    idleTimeoutMs: REMOTE_SESSION_IDLE_MS,
    createdBy,
    toolset: 'remote-session',
  };
  return { nonce, record };
}

/**
 * Liveness check — pure data (expiry + idle timeout live ON the record, so no config reads here).
 * Returns null when the session is live, else why not. Wrong/missing nonce is 'not_found' (callers
 * present all denials uniformly on the wire; the distinction is for lazy-release + logging).
 */
export function remoteSessionDenial(
  record: RemoteSessionRecord | undefined,
  nonce: string,
  now = Date.now(),
): RemoteSessionDenial | null {
  if (!record || !verifyRemoteSessionNonce(nonce, record.nonceHash)) return 'not_found';
  if (record.revoked) return 'revoked';
  if (now > Date.parse(record.expiresAt)) return 'expired';
  if (now - Date.parse(record.lastActivityAt) > record.idleTimeoutMs) return 'idle_expired';
  return null;
}

// ── persistence (conversations.meta.remoteSession) ─────────────────────────────

export async function saveRemoteSession(conversationId: number, record: RemoteSessionRecord): Promise<void> {
  await db().exec(
    `UPDATE conversations
       SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{remoteSession}', $2::jsonb)
     WHERE id = $1`,
    [conversationId, JSON.stringify(record)],
  );
}

/** Bump lastActivityAt (every authenticated remote request). */
export async function touchRemoteSession(conversationId: number, now = Date.now()): Promise<void> {
  await db().exec(
    `UPDATE conversations
       SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{remoteSession,lastActivityAt}', $2::jsonb)
     WHERE id = $1 AND meta->'remoteSession' IS NOT NULL`,
    [conversationId, JSON.stringify(new Date(now).toISOString())],
  );
}

/** Soft-revoke the session record (Stop / agent end / re-mint / lazy expiry release). */
export async function markRemoteSessionRevoked(conversationId: number): Promise<void> {
  await db().exec(
    `UPDATE conversations
       SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{remoteSession,revoked}', 'true'::jsonb)
     WHERE id = $1 AND meta->'remoteSession' IS NOT NULL`,
    [conversationId],
  );
}
