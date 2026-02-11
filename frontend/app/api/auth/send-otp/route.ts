/**
 * POST /api/auth/send-otp
 * Send OTP to user's phone number for 2FA verification
 */

import { NextRequest } from 'next/server';
import { UserDB } from '@/lib/database/user-db';
import { generateOTP, hashOTP, createOTPToken } from '@/lib/auth/otp-utils';
import { getConfigsByCompanyId } from '@/lib/data/configs.server';
import { executeWebhook } from '@/lib/messaging/webhook-executor';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { UserState } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const { email, companyId } = body;

    if (!email || !companyId) {
      return ApiErrors.badRequest('Email and companyId are required');
    }

    // Look up user
    const user = await UserDB.getByEmailAndCompany(email, companyId);
    if (!user) {
      return ApiErrors.notFound('User not found');
    }

    // Check if user has phone number and 2FA enabled
    if (!user.phone) {
      return ApiErrors.badRequest('User does not have a phone number configured');
    }

    const userState: UserState | null = user.state ? JSON.parse(user.state) : null;
    const requires2FA = userState?.twofa_whatsapp_enabled === true;

    if (!requires2FA) {
      return ApiErrors.badRequest('2FA is not enabled for this user');
    }

    // Generate OTP
    const otp = generateOTP();
    const otpHash = hashOTP(otp);
    console.log('[send-otp] Generated OTP:', otp, 'Hash:', otpHash);

    // Create JWT token with OTP hash
    const token = createOTPToken({
      email: user.email,
      phone: user.phone,
      companyId: user.company_id,
      otpHash,
    });
    console.log('[send-otp] Created token for user:', user.email);

    // Load company config with messaging
    const { config } = await getConfigsByCompanyId(companyId);
    if (!config.messaging || !config.messaging.webhooks || config.messaging.webhooks.length === 0) {
      return ApiErrors.internalError('Messaging configuration not found in company config');
    }

    // Send OTP via first configured webhook (WhatsApp)
    const webhook = config.messaging.webhooks.find(w => w.type === 'whatsapp') || config.messaging.webhooks[0];
    const result = await executeWebhook(webhook, {
      USER_NUMBER: user.phone,
      AUTH_OTP: otp,
    });

    if (!result.success) {
      return ApiErrors.internalError(`Failed to send OTP: ${result.error}`);
    }

    // Return success with token
    return successResponse({
      success: true,
      token,
      message: 'OTP sent successfully',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
