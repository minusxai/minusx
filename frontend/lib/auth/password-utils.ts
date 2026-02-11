import bcrypt from 'bcryptjs';

/**
 * Get cryptographically secure random integer (browser and Node.js compatible)
 */
function getSecureRandomInt(min: number, max: number): number {
  const range = max - min;
  const randomBuffer = new Uint32Array(1);

  // Use Web Crypto API (works in both browser and Node.js)
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(randomBuffer);
  } else if (typeof global !== 'undefined' && global.crypto) {
    global.crypto.getRandomValues(randomBuffer);
  } else {
    // Fallback to Math.random (less secure, but works everywhere)
    return Math.floor(Math.random() * range) + min;
  }

  return (randomBuffer[0] % range) + min;
}

/**
 * Generate a strong random password using cryptographically secure random numbers
 * @param length - Length of password (default: 16)
 * @returns Generated password string
 */
export function generateStrongPassword(length: number = 16): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';

  const allChars = uppercase + lowercase + numbers + symbols;

  // Helper to get cryptographically secure random character from string
  const getRandomChar = (str: string): string => {
    const randomIndex = getSecureRandomInt(0, str.length);
    return str[randomIndex];
  };

  // Ensure at least one character from each category
  let password = '';
  password += getRandomChar(uppercase);
  password += getRandomChar(lowercase);
  password += getRandomChar(numbers);
  password += getRandomChar(symbols);

  // Fill the rest randomly
  for (let i = password.length; i < length; i++) {
    password += getRandomChar(allChars);
  }

  // Shuffle using Fisher-Yates algorithm with cryptographically secure random
  const chars = password.split('');
  for (let i = chars.length - 1; i > 0; i--) {
    const j = getSecureRandomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

/**
 * Hash a password using bcrypt
 * @param password - Plain text password
 * @returns Hashed password
 */
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10;
  return bcrypt.hash(password, saltRounds);
}

/**
 * Verify a password against a hash
 * @param password - Plain text password
 * @param hash - Bcrypt hash
 * @returns True if password matches hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
