/**
 * POST /api/auth/send-otp
 * Send OTP to user for authentication.
 *
 * Supports two channels via the `channel` body field:
 *   - "phone" (default): sends OTP to user's phone for 2FA after password login
 *   - "email": sends OTP to user's email for passwordless login
 */

import { NextRequest } from 'next/server';
import { UserDB } from '@/lib/database/user-db';
import { CompanyDB } from '@/lib/database/company-db';
import { generateOTP, hashOTP, createOTPToken } from '@/lib/auth/otp-utils';
import { getConfigsByCompanyId } from '@/lib/data/configs.server';
import { executeWebhook, sendEmailViaWebhook } from '@/lib/messaging/webhook-executor';
import { resolveWebhook } from '@/lib/messaging/webhook-resolver.server';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { UserState } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, channel = 'phone' } = body;
    let { companyId } = body;

    if (!email) {
      return ApiErrors.badRequest('Email is required');
    }

    // Resolve companyId from company name if not provided directly
    if (!companyId) {
      const company = body.company
        ? await CompanyDB.getByName(body.company)
        : await CompanyDB.getDefaultCompany();
      if (!company) {
        return ApiErrors.badRequest('Company not found');
      }
      companyId = company.id;
    }

    // Look up user
    const user = await UserDB.getByEmailAndCompany(email, companyId);
    if (!user) {
      // Return generic error to avoid user enumeration
      return ApiErrors.badRequest('Invalid email or company');
    }

    if (channel === 'email') {
      // --- Passwordless email OTP ---
      const { config } = await getConfigsByCompanyId(companyId);
      const _emailOtpRaw = config.messaging?.webhooks?.find(w => w.type === 'email_otp');
      const webhook = _emailOtpRaw ? resolveWebhook(_emailOtpRaw) : null;
      if (!webhook) {
        return ApiErrors.badRequest('Email OTP is not configured for this company');
      }

      const otp = generateOTP();
      const otpHash = hashOTP(otp);
      console.log('[send-otp/email] Generated OTP for user:', user.email);

      const token = createOTPToken({
        email: user.email,
        companyId: user.company_id,
        otpHash,
      });

      const result = await sendEmailViaWebhook(
        webhook,
        user.email,
        'Your login code',
        `Your login code is: ${otp}`
      );

      if (!result.success) {
        return ApiErrors.internalError(`Failed to send OTP email: ${result.error}`);
      }

      return successResponse({ success: true, token, message: 'OTP sent to email' });
    }

    // --- Phone 2FA OTP (existing flow) ---
    if (!user.phone) {
      return ApiErrors.badRequest('User does not have a phone number configured');
    }

    const userState: UserState | null = user.state ? JSON.parse(user.state) : null;
    const requires2FA = userState?.twofa_phone_otp_enabled === true || (userState as any)?.twofa_whatsapp_enabled === true;

    if (!requires2FA) {
      return ApiErrors.badRequest('2FA is not enabled for this user');
    }

    const otp = generateOTP();
    const otpHash = hashOTP(otp);
    console.log('[send-otp/phone] Generated OTP:', otp, 'Hash:', otpHash);

    const token = createOTPToken({
      email: user.email,
      phone: user.phone,
      companyId: user.company_id,
      otpHash,
    });
    console.log('[send-otp/phone] Created token for user:', user.email);

    const { config } = await getConfigsByCompanyId(companyId);
    if (!config.messaging?.webhooks?.length) {
      return ApiErrors.internalError('Messaging configuration not found in company config');
    }

    const _phoneOtpRaw = config.messaging.webhooks.find(w => w.type === 'phone_otp') || config.messaging.webhooks[0];
    const webhook = _phoneOtpRaw ? resolveWebhook(_phoneOtpRaw) : null;
    if (!webhook) {
      return ApiErrors.internalError('Phone OTP webhook could not be resolved');
    }
    const result = await executeWebhook(webhook, {
      USER_NUMBER: user.phone,
      AUTH_OTP: otp,
    });

    if (!result.success) {
      return ApiErrors.internalError(`Failed to send OTP: ${result.error}`);
    }

    return successResponse({ success: true, token, message: 'OTP sent successfully' });
  } catch (error) {
    return handleApiError(error);
  }
}
