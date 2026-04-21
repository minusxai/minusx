/**
 * Session token manager for securing internal API calls
 *
 * Uses signed JWTs to encode mode.
 * When Next.js calls Python backend, it generates a JWT token.
 * Python echoes this token back when calling Next.js internal APIs.
 * Next.js verifies the JWT signature to ensure authenticity.
 *
 * Benefits over Map-based approach:
 * - Works across Next.js route boundaries (no shared state needed)
 * - Scales to multiple server instances
 * - Self-contained (no server-side storage)
 */

import jwt from 'jsonwebtoken';
import type { Mode } from '@/lib/mode/mode-types';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';
import { NEXTAUTH_SECRET } from '@/lib/config';
import { IS_DEV } from '@/lib/constants';

interface SessionTokenPayload {
  mode: Mode;
  iat: number;  // Issued at
  exp: number;  // Expiration
}

class SessionTokenManager {
  private readonly TOKEN_LIFETIME_SECONDS = 30; // 30 seconds
  private readonly secret: string;

  constructor() {
    // Use NEXTAUTH_SECRET if available (already in .env), otherwise generate a random secret
    // In production, NEXTAUTH_SECRET should always be set
    this.secret = NEXTAUTH_SECRET || this.generateSecret();

    if (!NEXTAUTH_SECRET && !IS_DEV) {
      console.error('[SessionToken] CRITICAL: NEXTAUTH_SECRET not set in production!');
    }
  }

  /**
   * Generate a random secret for development
   */
  private generateSecret(): string {
    return crypto.randomUUID() + crypto.randomUUID();
  }

  /**
   * Generate a new session token (JWT) for a request
   */
  generate(mode: Mode = DEFAULT_MODE): string {
    const payload: Omit<SessionTokenPayload, 'iat' | 'exp'> = {
      mode,
    };

    const token = jwt.sign(payload, this.secret, {
      expiresIn: this.TOKEN_LIFETIME_SECONDS,
    });

    return token;
  }

  /**
   * Validate a session token (JWT) and return the mode
   * Returns null if token is invalid, expired, or malformed
   */
  validate(token: string): { mode: Mode } | null {
    try {
      const decoded = jwt.verify(token, this.secret) as SessionTokenPayload;
      return {
        mode: decoded.mode,
      };
    } catch (error) {
      // Silent failure for security (don't leak token details)
      return null;
    }
  }
}

// Singleton instance
export const sessionTokenManager = new SessionTokenManager();
