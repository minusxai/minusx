/**
 * Validation utilities for form inputs
 * Used by both client-side forms and server-side API validation
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate company name
 * Rules: Alphanumeric + hyphens/underscores only, minimum 3 characters
 */
export function validateCompanyName(name: string): ValidationResult {
  if (!name || name.trim().length === 0) {
    return {
      valid: false,
      error: 'Company name is required',
    };
  }

  const trimmedName = name.trim();

  if (trimmedName.length < 3) {
    return {
      valid: false,
      error: 'Company name must be at least 3 characters',
    };
  }

  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(trimmedName)) {
    return {
      valid: false,
      error: 'Company name can only contain letters, numbers, hyphens, and underscores',
    };
  }

  return { valid: true };
}

/**
 * Validate email address
 * Rules: Standard email format
 */
export function validateEmail(email: string): ValidationResult {
  if (!email || email.trim().length === 0) {
    return {
      valid: false,
      error: 'Email is required',
    };
  }

  const trimmedEmail = email.trim();
  // Use a safer pattern that avoids ReDoS vulnerability
  // Matches: localpart@domain.tld
  const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  if (!emailPattern.test(trimmedEmail)) {
    return {
      valid: false,
      error: 'Please enter a valid email address',
    };
  }

  return { valid: true };
}

/**
 * Validate password
 * Rules: Minimum 8 characters
 */
export function validatePassword(password: string): ValidationResult {
  if (!password || password.length === 0) {
    return {
      valid: false,
      error: 'Password is required',
    };
  }

  if (password.length < 8) {
    return {
      valid: false,
      error: 'Password must be at least 8 characters',
    };
  }

  return { valid: true };
}

/**
 * Validate full name
 * Rules: Not empty, minimum 2 characters
 */
export function validateFullName(name: string): ValidationResult {
  if (!name || name.trim().length === 0) {
    return {
      valid: false,
      error: 'Full name is required',
    };
  }

  const trimmedName = name.trim();

  if (trimmedName.length < 2) {
    return {
      valid: false,
      error: 'Full name must be at least 2 characters',
    };
  }

  return { valid: true };
}
