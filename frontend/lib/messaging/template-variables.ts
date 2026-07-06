/**
 * Template variable system for messaging webhooks
 * Supports substituting variables like {{USER_NUMBER}} and {{AUTH_OTP}}
 */

/**
 * Substitute template variables in a string
 * @param template - String containing template variables (e.g., "OTP: {{AUTH_OTP}}")
 * @param variables - Object with variable values (e.g., { USER_NUMBER: '+1234567890', AUTH_OTP: '123456' })
 * @returns String with variables substituted
 */
export function substituteVariables(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    // Replace all occurrences of {{KEY}} with value
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return result;
}

