import 'server-only';
import crypto from 'crypto';
import { NEXTAUTH_SECRET } from '@/lib/config';

const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

export interface StatePayload {
  ts: number;
  nonce: string;
  returnUrl: string;
  userEmail: string;
}

/** Build an HMAC-signed state token for the Slack OAuth `state` param. */
export function buildState(payload: StatePayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', NEXTAUTH_SECRET)
    .update(encoded)
    .digest('hex');
  return `${encoded}.${sig}`;
}

/** Verify an HMAC-signed state token; returns the payload or null if invalid/expired. */
export function verifyState(state: string): StatePayload | null {
  const lastDot = state.lastIndexOf('.');
  if (lastDot < 0) return null;
  const encoded = state.slice(0, lastDot);
  const sig = state.slice(lastDot + 1);

  const expectedSig = crypto
    .createHmac('sha256', NEXTAUTH_SECRET)
    .update(encoded)
    .digest('hex');

  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as StatePayload;
  } catch {
    return null;
  }

  if (!Number.isFinite(payload.ts)) return null;
  if (Date.now() - payload.ts > STATE_EXPIRY_MS) return null;

  return payload;
}
