/**
 * Whitelabel branding utilities
 * Default configuration with database override support
 */

import type { FileType } from '@/lib/ui/file-metadata';
import type { UserRole, ConfigChannel, MessagingWebhook, AlertRecipient, ConfigBot, VisualizationType } from '@/lib/types';
import type { LlmConfig } from '@/lib/llm/llm-config-types';
import { MINUSX_TAGLINE } from '@/lib/og/og-helpers';

export interface SetupWizard {
  status: 'pending' | 'complete';
  step?: 'welcome' | 'models' | 'connection' | 'questionnaire' | 'context' | 'generating' | 'slack';
  connectionId?: number;
  connectionName?: string;
  contextFileId?: number;
  questionnaireAnswers?: {
    datasetDescription: string;
    keyMetrics: string;
    dashboardPreference: string;
  };
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

/** The engine that renders story files. See {@link CompanyConfig.storyRenderer}. */
export type StoryRenderer = 'dom' | 'canvas' | 'svg';

export const STORY_RENDERERS: readonly StoryRenderer[] = ['dom', 'canvas', 'svg'] as const;

/**
 * The active story renderer for a config. Single source of truth for the choice, including
 * back-compat: workspaces configured before the union stored `useCanvasRenderer: true`, which must
 * keep rendering on canvas rather than silently reverting to DOM.
 */
export function resolveStoryRenderer(
  config: { storyRenderer?: StoryRenderer; useCanvasRenderer?: boolean } | null | undefined,
): StoryRenderer {
  if (config?.storyRenderer) return config.storyRenderer;
  return config?.useCanvasRenderer ? 'canvas' : 'dom';
}

export interface OrgBranding {
  displayName: string;  // Workspace display name
  agentName: string;    // Agent name
  favicon: string;      // Favicon URL
  logoLight?: string;   // Light mode logo (icon) URL
  logoDark?: string;    // Dark mode logo (icon) URL
  logoExpanded?: string;     // Light mode full wordmark URL (e.g. social cards)
  logoExpandedDark?: string; // Dark mode full wordmark URL
  tagline?: string;          // Short product tagline for social/OG cards + meta description
}

export interface OrgLinks {
  docsUrl: string;
  supportUrl: string;
  githubIssuesUrl: string;
  termsUrl: string;
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
  supportedFileTypes?: FileType[];  // Fully replaces the default supported file types when set (see getSupportedFileTypes)
  setupWizard?: SetupWizard;
  bots?: ConfigBot[];
  allowedVizTypes?: VisualizationType[];  // Restrict available visualization types (default: all)
  chartColorPalette?: string[];  // Custom color palette for charts (hex values, e.g. ['#16a085', '#2980b9'])
  analytics?: { enabled: boolean };
  /** Remote Agent Sessions ("Copy to Agent"): lets an external agent drive a chat over HTTP.
   *  OFF by default — enable in Settings → Integrations. Gates minting AND live-session auth. */
  remoteAgentsEnabled?: boolean;
  /** Which engine renders story files (Settings → General). One setting, not a flag per engine:
   *  exactly one renderer is active, so a union has no invalid states (canvas+svg can't both be on).
   *   - 'dom'    — AgentHtml in a same-origin iframe (default). Captured via generic element serialization.
   *   - 'canvas' — Takumi raster + embed islands. Captures straight from its bitmaps.
   *   - 'svg'    — AgentHtml in an iframe, story body inside <svg><foreignObject>. Captures by
   *                serializing that live SVG (browser-rendered, snapdom-free).
   *  'canvas' and 'svg' fall back to DOM per story when rendering fails. */
  storyRenderer?: StoryRenderer;
  /** @deprecated Legacy boolean superseded by {@link storyRenderer}. Still READ for workspaces whose
   *  stored config predates the union (resolveStoryRenderer maps true → 'canvas'); never written. */
  useCanvasRenderer?: boolean;
  /** In-app LLM provider config: providers + per-use-case model assignments
   *  (see lib/llm/llm-config-types.ts). Overrides env model config when set;
   *  `apiKey` values are @SECRETS/… refs at rest. */
  llm?: LlmConfig;
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
    logoExpanded: '/logo_full_dark.png',
    logoExpandedDark: '/logo_full.png',
    tagline: MINUSX_TAGLINE,
  },
  links: {
    docsUrl: 'https://docs.minusx.ai',
    supportUrl: 'https://minusx.ai/support',
    githubIssuesUrl: 'https://github.com/minusxai/minusx/issues',
    termsUrl: 'https://minusx.ai/terms'
  },
  messaging: {
    webhooks: [
      { type: 'email_alert', keyword: 'EMAIL_DEFAULT' },
      { type: 'slack_alert', keyword: 'SLACK_DEFAULT' },
    ]
  },
  setupWizard: { status: 'pending' },
  analytics: { enabled: true },
  // storyRenderer is deliberately NOT defaulted here — resolveStoryRenderer is the single place the
  // 'dom' default lives. Defaulting it here too would shadow the legacy useCanvasRenderer fallback
  // (a stored 'true' would lose to an injected 'dom' and silently revert those workspaces).
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
      ...Object.fromEntries(
        Object.entries(overrides.branding || {}).filter(([, v]) => v !== '')
      ),
    },
    links: {
      ...defaults.links,
      ...Object.fromEntries(
        Object.entries(overrides.links || {}).filter(([, v]) => v !== '')
      ),
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
    supportedFileTypes: (overrides.supportedFileTypes && overrides.supportedFileTypes.length > 0)
      ? overrides.supportedFileTypes
      : defaults.supportedFileTypes,
    setupWizard: overrides.setupWizard ?? defaults.setupWizard,
    bots: overrides.bots ?? defaults.bots,
    allowedVizTypes: overrides.allowedVizTypes ?? defaults.allowedVizTypes,
    chartColorPalette: (overrides.chartColorPalette && overrides.chartColorPalette.length > 0)
      ? overrides.chartColorPalette
      : defaults.chartColorPalette,
    analytics: overrides.analytics ?? defaults.analytics,
    remoteAgentsEnabled: overrides.remoteAgentsEnabled ?? defaults.remoteAgentsEnabled,
    // Both renderer fields pass through UNDEFAULTED: resolveStoryRenderer owns the precedence
    // (storyRenderer → legacy useCanvasRenderer → 'dom'). Injecting a default here would shadow the
    // legacy fallback for workspaces that predate the union.
    ...(overrides.storyRenderer !== undefined ? { storyRenderer: overrides.storyRenderer } : {}),
    ...(overrides.useCanvasRenderer !== undefined ? { useCanvasRenderer: overrides.useCanvasRenderer } : {}),
    llm: overrides.llm ?? defaults.llm,
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

/** Full wordmark logo URL for the given color mode (used by social/OG cards). */
export function getBrandLogoExpandedUrl(
  branding: Partial<OrgBranding> | undefined,
  colorMode: 'light' | 'dark',
): string {
  if (colorMode === 'dark') {
    return branding?.logoExpandedDark || branding?.logoExpanded || DEFAULT_CONFIG.branding.logoExpandedDark || '/logo_full.png';
  }
  return branding?.logoExpanded || branding?.logoExpandedDark || DEFAULT_CONFIG.branding.logoExpanded || '/logo_full_dark.png';
}

/** Product tagline for social/OG cards + meta description; falls back to the product default. */
export function getBrandTagline(branding: Partial<OrgBranding> | undefined): string {
  return branding?.tagline || DEFAULT_CONFIG.branding.tagline || MINUSX_TAGLINE;
}
