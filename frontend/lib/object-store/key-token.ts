import 'server-only';

import { createHmac, timingSafeEqual } from 'crypto';
import { NEXTAUTH_SECRET } from '@/lib/config';

const TTL_SECONDS = 3600; // 1 hour

/**
 * Sign a storage key into a tamper-proof token.
 * Used by upload-url so the client can echo it back in /api/csv/register
 * without being able to forge a different key.
 */
export function signStorageToken(key: string, companyId: number): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const encoded = Buffer.from(JSON.stringify({ key, companyId, exp })).toString('base64url');
  const sig = createHmac('sha256', NEXTAUTH_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

/**
 * Verify a storage token and return the raw key.
 * Throws if the signature is invalid, the token is expired, or companyId doesn't match.
 */
export function verifyStorageToken(token: string, companyId: number): string {
  const dot = token.lastIndexOf('.');
  if (dot === -1) throw new Error('Invalid storage token');
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = createHmac('sha256', NEXTAUTH_SECRET).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig, 'base64url');
  const expBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid storage token');
  }

  const { key, companyId: cid, exp } = JSON.parse(Buffer.from(encoded, 'base64url').toString());
  if (cid !== companyId) throw new Error('Invalid storage token');
  if (Math.floor(Date.now() / 1000) > exp) throw new Error('Storage token expired');
  return key as string;
}
