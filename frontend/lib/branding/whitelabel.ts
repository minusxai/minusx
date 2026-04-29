/**
 * Whitelabel branding utilities
 * Default configuration with database override support
 */

import type { FileType } from '@/lib/ui/file-metadata';
import type { UserRole, ConfigChannel, MessagingWebhook, AlertRecipient, ConfigBot, VisualizationType } from '@/lib/types';

export interface SetupWizard {
  status: 'pending' | 'complete';
  step?: 'welcome' | 'connection' | 'context' | 'generating';
  connectionId?: number;
  connectionName?: string;
  contextFileId?: number;
}

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

export interface OrgBranding {
  displayName: string;  // Workspace display name
  agentName: string;    // Agent name
  favicon: string;      // Favicon URL
  logoLight?: string;   // Light mode logo URL
  logoDark?: string;    // Dark mode logo URL
}

export interface OrgLinks {
  docsUrl: string;
  supportUrl: string;
  githubIssuesUrl: string;
}

/**
 * Org configuration structure
 * Parent type containing branding and future config sections
 */
export interface OrgConfig {
  branding: OrgBranding;
  links: OrgLinks;
  messaging?: {
    webhooks: MessagingWebhook[];
  };
  channels?: ConfigChannel[];
  error_delivery?: AlertRecipient[];
  city?: string;  // Optional city identifier for agent context
  thinkingPhrases?: string[];  // Optional custom thinking phrases for AI indicator
  accessRules?: AccessRulesOverride;  // Per-org file type access overrides (overrides rules.json)
  setupWizard?: SetupWizard;
  bots?: ConfigBot[];
  allowedVizTypes?: VisualizationType[];  // Restrict available visualization types (default: all)
  chartColorPalette?: string[];  // Custom color palette for charts (hex values, e.g. ['#16a085', '#2980b9'])
  // Future: theme, features, etc.
}

/**
 * Default configuration
 * Used as fallback when no config file exists, or for deep merge with partial configs
 */
export const DEFAULT_CONFIG: OrgConfig = {
  branding: {
    displayName: 'MinusX',
    agentName: 'MinusX',
    favicon: '/favicon.ico',
    logoLight: '/logox_dark.svg',
    logoDark: '/logox.svg',
  },
  links: {
    docsUrl: 'https://docsv2.minusx.ai',
    supportUrl: 'https://minusx.ai/support',
    githubIssuesUrl: 'https://github.com/minusxai/minusx/issues'
  },
  messaging: {
    webhooks: [
      { type: 'email_alert', keyword: 'EMAIL_DEFAULT' },
      { type: 'slack_alert', keyword: 'SLACK_DEFAULT' },
    ]
  },
  setupWizard: { status: 'pending' },
};

/**
 * Default CSS styles for org branding
 * Uses aria-label selectors to style logo elements
 */
export const DEFAULT_STYLES = `
[aria-label="Workspace logo"] {
  background-image: url('/logox_dark.svg');
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
  display: block;
}

.dark [aria-label="Workspace logo"] {
  background-image: url('/logox.svg');
}
`.trim();

/**
 * Deep merge two config objects
 * Database values override defaults
 */
export function mergeConfig(
  defaults: OrgConfig,
  overrides: Partial<OrgConfig>
): OrgConfig {
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
    channels: overrides.channels ?? defaults.channels,
    error_delivery: overrides.error_delivery ?? defaults.error_delivery,
    city: overrides.city ?? defaults.city,
    // Override thinkingPhrases only if present and non-empty array
    thinkingPhrases: (overrides.thinkingPhrases && overrides.thinkingPhrases.length > 0)
      ? overrides.thinkingPhrases
      : defaults.thinkingPhrases,
    accessRules: overrides.accessRules ?? defaults.accessRules,
    setupWizard: overrides.setupWizard ?? defaults.setupWizard,
    bots: overrides.bots ?? defaults.bots,
    allowedVizTypes: overrides.allowedVizTypes ?? defaults.allowedVizTypes,
    chartColorPalette: (overrides.chartColorPalette && overrides.chartColorPalette.length > 0)
      ? overrides.chartColorPalette
      : defaults.chartColorPalette,
    // Future: merge other config sections
  };
}

export function getBrandLogoUrl(
  branding: Partial<OrgBranding> | undefined,
  colorMode: 'light' | 'dark',
): string {
  if (colorMode === 'dark') {
    return branding?.logoDark || branding?.logoLight || DEFAULT_CONFIG.branding.logoDark || '/logox.svg';
  }

  return branding?.logoLight || branding?.logoDark || DEFAULT_CONFIG.branding.logoLight || '/logox_dark.svg';
}
