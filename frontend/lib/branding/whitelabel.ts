/**
 * Whitelabel branding utilities
 * Default configuration with database override support
 */

import type { FileType } from '@/lib/ui/file-metadata';
import type { UserRole } from '@/lib/types';

/**
 * Per-role file type access override
 * Each field, if specified, completely replaces the default from rules.json
 */
export interface FileTypeAccessOverride {
  allowedTypes?: '*' | FileType[];
  createTypes?: '*' | FileType[];
  viewTypes?: '*' | FileType[];
}

/**
 * Role-keyed map of file type access overrides
 * Only specified roles/fields override the defaults from rules.json
 */
export type AccessRulesOverride = Partial<Record<UserRole, FileTypeAccessOverride>>;

export interface CompanyBranding {
  displayName: string;  // Company display name
  agentName: string;    // Agent name
  favicon: string;      // Favicon URL
}

export interface CompanyLinks {
  docsUrl: string;
  supportUrl: string;
  githubIssuesUrl: string;
}

/**
 * Company configuration structure
 * Parent type containing branding and future config sections
 */
export interface CompanyConfig {
  branding: CompanyBranding;
  links: CompanyLinks;
  messaging?: {
    webhooks: Array<{
      type: 'whatsapp' | 'sms' | 'email';
      url: string;
      method: 'GET' | 'POST' | 'PUT';
      headers?: Record<string, string>;
      body?: Record<string, any>;
    }>;
  };
  city?: string;  // Optional city identifier for agent context
  thinkingPhrases?: string[];  // Optional custom thinking phrases for AI indicator
  accessRules?: AccessRulesOverride;  // Per-company file type access overrides (overrides rules.json)
  // Future: theme, features, etc.
}

/**
 * Default configuration
 * Used as fallback when no config file exists, or for deep merge with partial configs
 */
export const DEFAULT_CONFIG: CompanyConfig = {
  branding: {
    displayName: 'MinusX',
    agentName: 'MinusX',
    favicon: '/favicon.ico'
  },
  links: {
    docsUrl: 'https://docs.minusx.ai',
    supportUrl: 'https://minusx.ai/support',
    githubIssuesUrl: 'https://github.com/minusxai/minusx/issues'
  },
  messaging: {
    webhooks: []
  }
};

/**
 * Default CSS styles for company branding
 * Uses aria-label selectors to style logo elements
 */
export const DEFAULT_STYLES = `
[aria-label="Company logo"] {
  background-image: url('/logox_dark.svg');
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
  display: block;
}

.dark [aria-label="Company logo"] {
  background-image: url('/logox.svg');
}
`.trim();

/**
 * Deep merge two config objects
 * Database values override defaults
 */
export function mergeConfig(
  defaults: CompanyConfig,
  overrides: Partial<CompanyConfig>
): CompanyConfig {
  return {
    branding: {
      ...defaults.branding,
      ...(overrides.branding || {})
    },
    links: {
      ...defaults.links,
      ...(overrides.links || {})
    },
    messaging: overrides.messaging ?? defaults.messaging,
    city: overrides.city ?? defaults.city,
    // Override thinkingPhrases only if present and non-empty array
    thinkingPhrases: (overrides.thinkingPhrases && overrides.thinkingPhrases.length > 0)
      ? overrides.thinkingPhrases
      : defaults.thinkingPhrases,
    accessRules: overrides.accessRules ?? defaults.accessRules,
    // Future: merge other config sections
  };
}

