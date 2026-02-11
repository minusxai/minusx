/**
 * OTP (One-Time Password) utilities for 2FA
 * Handles OTP generation, hashing, and JWT token creation/validation
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';

/**
 * Generate a random 6-digit OTP
 */
export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Hash an OTP using SHA-256
 * Used to securely store OTP in JWT token
 */
export function hashOTP(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

/**
 * OTP payload structure stored in JWT
 */
export interface OTPPayload {
  email: string;
  phone: string;
  companyId: number;
  otpHash: string;
  exp: number;  // Unix timestamp (expiry)
  nonce: string;  // Random string to prevent reuse
}

/**
 * Create a JWT token containing OTP hash
 * Token expires in 5 minutes
 */
export function createOTPToken(payload: Omit<OTPPayload, 'exp' | 'nonce'>): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is not configured');
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const exp = Math.floor(Date.now() / 1000) + 300;  // 5 minutes from now

  return jwt.sign(
    { ...payload, exp, nonce },
    secret
  );
}

/**
 * Verify and decode an OTP JWT token
 * Returns null if token is invalid or expired
 */
export function verifyOTPToken(token: string): OTPPayload | null {
  try {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      console.error('[verifyOTPToken] NEXTAUTH_SECRET is not configured');
      throw new Error('NEXTAUTH_SECRET is not configured');
    }

    const payload = jwt.verify(token, secret) as OTPPayload;
    console.log('[verifyOTPToken] Token verified successfully:', { email: payload.email, exp: payload.exp, now: Math.floor(Date.now() / 1000) });
    return payload;
  } catch (err: any) {
    // Token is invalid or expired
    console.error('[verifyOTPToken] Token verification failed:', err.message);
    return null;
  }
}

/**
 * Validate a submitted OTP against the hashed OTP in the token
 */
export function validateOTP(submittedOTP: string, otpHash: string): boolean {
  return hashOTP(submittedOTP) === otpHash;
}
