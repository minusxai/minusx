/**
 * Template variable system for messaging webhooks
 * Supports substituting variables like {{USER_NUMBER}} and {{AUTH_OTP}}
 */

export const TEMPLATE_VARIABLES = {
  USER_NUMBER: '{{USER_NUMBER}}',
  AUTH_OTP: '{{AUTH_OTP}}',
} as const;

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

/**
 * Validate that a webhook config doesn't use undefined template variables
 * @param config - Webhook configuration object
 * @returns Array of undefined variable names (empty if all valid)
 */
export function validateTemplateVariables(config: any): string[] {
  const configStr = JSON.stringify(config);
  const templateRegex = /{{([A-Z_]+)}}/g;
  const matches = configStr.matchAll(templateRegex);

  const undefinedVars: string[] = [];
  const validVars = Object.keys(TEMPLATE_VARIABLES);

  for (const match of matches) {
    const varName = match[1];
    if (!validVars.includes(varName)) {
      undefinedVars.push(varName);
    }
  }

  return [...new Set(undefinedVars)];  // Remove duplicates
}
