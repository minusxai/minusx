import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { resolveShare } from '@/lib/data/files.server';
import {
  GUEST_COOKIE, GUEST_TTL_SECONDS, createGuestToken, verifyGuestToken,
  deriveGuestUid, storyHomeFolder,
} from '@/lib/auth/guest-session';
import { SHARE_GUEST_CHAT_ENABLED, EMBED_ENABLED } from '@/lib/config';
import { IS_DEV } from '@/lib/constants';
import { isValidMode, DEFAULT_MODE, type Mode } from '@/lib/mode/mode-types';
import crypto from 'crypto';

// Public (whitelisted) route: mints/refreshes the anonymous `mx-guest` session for a
// public story share. Viewing always works once minted; chat is gated by `canChat`
// (lead captured or ?skip_lead) AND the SHARE_GUEST_CHAT_ENABLED kill-switch.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Mode is the first path segment of the story (e.g. /org/... → 'org'). */
function modeFromPath(path: string): Mode {
  const seg = path.split('/')[1];
  return isValidMode(seg) ? (seg as Mode) : DEFAULT_MODE;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const shareId = typeof body?.shareId === 'string' ? body.shareId : '';
    if (!shareId) return ApiErrors.validationError('shareId is required');

    const resolved = await resolveShare(shareId);
    if (!resolved) return ApiErrors.notFound('Share link');
    const { file, nonce } = resolved;

    const mode = modeFromPath(file.path);
    const home_folder = storyHomeFolder(file.path, mode);

    // Preserve identity across reloads: reuse the existing cookie's identity when it's
    // for the same share, unless the caller supplies a fresh name/email.
    const existing = verifyGuestToken(request.cookies.get(GUEST_COOKIE)?.value);
    const reuse = existing && existing.fileId === file.id ? existing : null;

    const providedEmail = typeof body?.email === 'string' ? body.email.trim() : '';
    const providedName = typeof body?.name === 'string' ? body.name.trim() : '';
    const skipLead = body?.skipLead === true;
    const hasLead = providedEmail.length > 0;

    let email: string;
    let name: string;
    let uid: number;
    if (hasLead) {
      email = providedEmail;
      name = providedName || 'Guest';
      uid = deriveGuestUid(nonce, email);
    } else if (reuse) {
      email = reuse.email;
      name = reuse.name;
      uid = reuse.uid;
    } else {
      // Anonymous visitor: synthesize a per-visitor identity so conversation folders stay isolated.
      const rand = crypto.randomBytes(6).toString('hex');
      email = `guest-${nonce}-${rand}@anon.share`;
      name = 'Guest';
      uid = deriveGuestUid(nonce, email);
    }

    const canChat = SHARE_GUEST_CHAT_ENABLED && (skipLead || hasLead || reuse?.canChat === true);

    const token = createGuestToken({ fileId: file.id, nonce, home_folder, mode, uid, name, email, canChat });

    const res = NextResponse.json({
      ok: true,
      fileId: file.id,
      // Physical parent folder of the story — the chat context path + the guest's view scope.
      folderPath: file.path.slice(0, file.path.lastIndexOf('/')),
      home_folder,
      mode,
      uid,
      canChat,
      chatEnabled: SHARE_GUEST_CHAT_ENABLED,
      name: hasLead ? name : undefined,
    });
    res.cookies.set(GUEST_COOKIE, token, {
      httpOnly: true,
      // Embeddable shares need SameSite=None;Secure to survive cross-origin iframes.
      sameSite: EMBED_ENABLED ? 'none' : 'lax',
      secure: EMBED_ENABLED || !IS_DEV,
      path: '/',
      maxAge: GUEST_TTL_SECONDS,
    });
    return res;
  } catch (error) {
    return handleApiError(error);
  }
}
