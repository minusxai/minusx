/**
 * POST /api/auth/send-otp
 * Issue a login code and dispatch it.
 *
 * Two channels via the `channel` body field:
 *   - "phone" (default): the second factor, after a password
 *   - "email": passwordless login
 *
 * This endpoint is unauthenticated — anyone can name an address — so it is built to
 * give away as little as possible. The code lives in `auth_codes` and only an opaque
 * handle comes back (`lib/database/auth-codes-db.ts` explains why). An address that is
 * unknown or ineligible gets a decoy issued against the same throttle and the same
 * response, so the reply does not answer "does this account exist".
 */

import { NextRequest } from 'next/server';
import { UserDB } from '@/lib/database/user-db';
import { generateOTP } from '@/lib/auth/otp-utils';
import { AuthCodesDB, type OtpChannel } from '@/lib/database/auth-codes-db';
import { requiresTwoFactor } from '@/lib/auth/two-factor';
import { getConfigsForMode } from '@/lib/data/configs.server';
import { executeWebhook, sendEmailViaWebhook } from '@/lib/messaging/webhook-executor';
import { resolveWebhook } from '@/lib/messaging/webhook-resolver.server';
import { successResponse, ApiErrors, handleApiError } from '@/lib/http/api-responses';
import { buildOTPEmailHtml } from '@/lib/messaging/otp-email-html';
import { IS_DEV } from '@/lib/constants';

/**
 * One reply for every address. Deliberately does not say whether anything was sent —
 * the caller may be someone typing in a stranger's address.
 */
const NEUTRAL_MESSAGE = 'If that address can receive a login code, one has been sent';

/** Absolute, raster logo URL for the email — Gmail and Outlook will not render SVG. */
function emailLogoUrl(request: NextRequest, logoExpanded: string | undefined): string | undefined {
  if (!logoExpanded || !/\.(png|jpe?g|gif|webp)(\?|$)/i.test(logoExpanded)) return undefined;
  if (/^https?:\/\//.test(logoExpanded)) return logoExpanded;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
  const proto = (request.headers.get('x-forwarded-proto') ?? 'https').split(',')[0].trim();
  return host ? `${proto}://${host}${logoExpanded}` : undefined;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, channel = 'phone' } = body as { email?: string; channel?: string };

    if (!email || typeof email !== 'string') {
      return ApiErrors.badRequest('Email is required');
    }
    if (channel !== 'email' && channel !== 'phone') {
      return ApiErrors.badRequest('Unsupported channel');
    }

    // Whether a channel is configured at all is a property of the DEPLOYMENT, not of the
    // address, so answering it plainly reveals nothing about any account. Resolved
    // before the user lookup so the answer cannot vary per address.
    const { config } = await getConfigsForMode();
    const rawWebhook = channel === 'email'
      ? config.messaging?.webhooks?.find(w => w.type === 'email_otp')
      : (config.messaging?.webhooks?.find(w => w.type === 'phone_otp') ?? config.messaging?.webhooks?.[0]);
    const webhook = rawWebhook ? resolveWebhook(rawWebhook) : null;
    if (!webhook) {
      return channel === 'email'
        ? ApiErrors.badRequest('Email OTP is not configured')
        : ApiErrors.internalError('Phone OTP webhook could not be resolved');
    }

    const now = Date.now();
    const user = await UserDB.getByEmail(email);
    // Email codes are a login method available to any account; phone codes only make
    // sense for an account that has the second factor turned on and a number to reach.
    const eligible = !!user && (channel === 'email' || requiresTwoFactor(user));
    const code = eligible ? generateOTP() : null;

    const issued = await AuthCodesDB.issue({ email, channel: channel as OtpChannel, code, now });
    if ('throttled' in issued) {
      // Per address, so one attacker cannot lock the whole deployment out of logging in.
      // It does let someone burn a specific address's send budget; that is the accepted
      // cost of not letting them mint unlimited guessing budget or unlimited email.
      return ApiErrors.tooManyRequests('Too many login codes requested. Please try again later.');
    }

    if (eligible && code) {
      if (channel === 'email') {
        const agentName = config.branding.agentName;
        const result = await sendEmailViaWebhook(
          webhook,
          user!.email,
          `Your ${agentName} Login Code`,
          buildOTPEmailHtml({ otp: code, agentName, logoUrl: emailLogoUrl(request, config.branding.logoExpanded) }),
        );
        if (!result.success) {
          return ApiErrors.internalError(`Failed to send OTP email: ${result.error}`);
        }
      } else {
        if (IS_DEV) console.log('[send-otp/phone] Generated OTP:', code);
        const result = await executeWebhook(webhook, { USER_NUMBER: user!.phone!, AUTH_OTP: code });
        if (!result.success) {
          return ApiErrors.internalError(`Failed to send OTP: ${result.error}`);
        }
      }
    }

    // The response body is identical for a real recipient and a decoy. The send itself
    // is awaited, so DISPATCH LATENCY still distinguishes the two — a real address costs
    // a webhook round-trip and a decoy returns at once. Closing that would mean not
    // awaiting the send, which would also mean never being able to tell a user their
    // code failed to go out. The body-level uniformity here is what removes the trivial
    // status-code oracle; it does not make the endpoint a black box.
    return successResponse({ success: true, token: issued.handle, message: NEUTRAL_MESSAGE });
  } catch (error) {
    return handleApiError(error);
  }
}
