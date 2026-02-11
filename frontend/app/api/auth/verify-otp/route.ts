/**
 * POST /api/auth/verify-otp
 * Verify OTP submitted by user against JWT token
 * Fully stateless - no cache needed
 */

import { NextRequest } from 'next/server';
import { verifyOTPToken, validateOTP } from '@/lib/auth/otp-utils';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const { token, otp } = body;

    console.log('[verify-otp] Received request with OTP length:', otp?.length);

    if (!token || !otp) {
      return ApiErrors.badRequest('Token and OTP are required');
    }

    // Verify JWT token
    const payload = verifyOTPToken(token);
    if (!payload) {
      console.error('[verify-otp] Token verification failed');
      return ApiErrors.unauthorized('Invalid or expired OTP token');
    }

    console.log('[verify-otp] Token verified, validating OTP for user:', payload.email);

    // Validate OTP
    const isValid = validateOTP(otp, payload.otpHash);
    if (!isValid) {
      console.error('[verify-otp] OTP validation failed for user:', payload.email);
      return ApiErrors.unauthorized('Invalid OTP');
    }

    console.log('[verify-otp] OTP verified successfully for user:', payload.email);

    // Return success - frontend can now proceed with signIn()
    return successResponse({
      success: true,
      email: payload.email,
      message: 'OTP verified successfully',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
