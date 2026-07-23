import type { OrgConfig, AccessRulesOverride } from '@/lib/branding/whitelabel';
import { validateWebhook } from '@/lib/messaging/webhook-executor';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import { immutableSet } from '@/lib/utils/immutable-collections';
import type { VisualizationType } from '@/lib/types';
import { LLM_AGENT_KEYS, LLM_GRADES } from '@/lib/llm/llm-config-types';

const VALID_VIZ_TYPES: readonly VisualizationType[] = [
  'table', 'bar', 'row', 'line', 'scatter', 'area', 'funnel', 'pie', 'pivot', 'trend', 'waterfall', 'combo', 'radar', 'geo'
];

function validateAllowedVizTypes(value: unknown): value is VisualizationType[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(item => typeof item === 'string' && (VALID_VIZ_TYPES as readonly string[]).includes(item));
}

const VALID_ROLES = ['admin', 'editor', 'viewer'] as const;
const VALID_ACCESS_FIELDS = ['allowedTypes', 'createTypes', 'viewTypes'] as const;
const VALID_FILE_TYPES = immutableSet(Object.keys(FILE_TYPE_METADATA));

function validateFileTypeArray(value: unknown): boolean {
  if (value === '*') return true;
  if (!Array.isArray(value)) return false;
  return value.every(item => typeof item === 'string' && VALID_FILE_TYPES.has(item));
}

function validateSupportedFileTypes(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(item => typeof item === 'string' && VALID_FILE_TYPES.has(item));
}

function validateAccessRulesOverride(accessRules: unknown): accessRules is AccessRulesOverride {
  if (typeof accessRules !== 'object' || accessRules === null) return false;

  for (const [role, override] of Object.entries(accessRules)) {
    if (!(VALID_ROLES as readonly string[]).includes(role)) {
      console.warn(`[Config] Invalid role in accessRules: ${role}`);
      return false;
    }
    if (typeof override !== 'object' || override === null) return false;

    const overrideObj = override as Record<string, unknown>;

    for (const field of Object.keys(overrideObj)) {
      if (!(VALID_ACCESS_FIELDS as readonly string[]).includes(field)) {
        console.warn(`[Config] Invalid field in accessRules.${role}: ${field}`);
        return false;
      }
    }
    for (const field of VALID_ACCESS_FIELDS) {
      if (field in overrideObj) {
        if (!validateFileTypeArray(overrideObj[field])) {
          console.warn(`[Config] Invalid value for accessRules.${role}.${field}`);
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Validate org config structure.
 * Supports partial configs — validates that present fields are properly typed.
 */
export function validateOrgConfig(content: unknown): content is Partial<OrgConfig> {
  if (!content || typeof content !== 'object') return false;

  const config = content as any;

  if (config.branding !== undefined) {
    if (typeof config.branding !== 'object' || config.branding === null) return false;

    const branding = config.branding;
    const validFields = ['displayName', 'agentName', 'favicon', 'logoLight', 'logoDark', 'tagline'];

    for (const field of validFields) {
      if (branding[field] !== undefined) {
        if (typeof branding[field] !== 'string') return false;
      }
    }
    // Allow unknown branding fields — don't reject the entire config for extra keys
  }

  if (config.links !== undefined) {
    if (typeof config.links !== 'object' || config.links === null) return false;

    const links = config.links;
    const validFields = ['docsUrl', 'supportUrl', 'githubIssuesUrl', 'termsUrl'];

    for (const field of validFields) {
      if (links[field] !== undefined) {
        if (typeof links[field] !== 'string') return false;
      }
    }
    // Allow unknown links fields
  }

  if (config.messaging !== undefined) {
    if (typeof config.messaging !== 'object' || config.messaging === null) return false;

    const messaging = config.messaging;
    if (!Array.isArray(messaging.webhooks)) return false;

    for (const webhook of messaging.webhooks) {
      const errors = validateWebhook(webhook);
      if (errors.length > 0) {
        console.warn('[Config] Invalid webhook in messaging config:', errors);
        return false;
      }
    }
  }

  if (config.accessRules !== undefined && !validateAccessRulesOverride(config.accessRules)) return false;
  if (config.allowedVizTypes !== undefined && !validateAllowedVizTypes(config.allowedVizTypes)) return false;
  if (config.supportedFileTypes !== undefined && !validateSupportedFileTypes(config.supportedFileTypes)) {
    console.warn('[Config] Invalid value for supportedFileTypes');
    return false;
  }

  if (config.setupWizard !== undefined) {
    const sw = config.setupWizard as any;
    if (typeof sw !== 'object' || sw === null) return false;
    if (!['pending', 'complete'].includes(sw.status)) return false;
    const VALID_STEPS = ['welcome', 'models', 'connection', 'questionnaire', 'context', 'generating', 'slack'];
    if (sw.step !== undefined && !VALID_STEPS.includes(sw.step)) return false;
    if (sw.connectionId !== undefined && typeof sw.connectionId !== 'number') return false;
    if (sw.connectionName !== undefined && typeof sw.connectionName !== 'string') return false;
    if (sw.contextFileId !== undefined && typeof sw.contextFileId !== 'number') return false;
    if (sw.questionnaireAnswers !== undefined && typeof sw.questionnaireAnswers !== 'object') return false;
    const VALID_FIELDS = new Set(['status', 'step', 'connectionId', 'connectionName', 'contextFileId', 'questionnaireAnswers']);
    for (const field of Object.keys(sw)) {
      if (!VALID_FIELDS.has(field)) return false;
    }
  }

  if (config.llm !== undefined && validateLlmConfig(config.llm) != null) return false;

  return true;
}

/**
 * The specific reason a config is invalid, for user-facing error responses —
 * detailed for the `llm` section, a generic structure message otherwise.
 * Null when the config is valid.
 */
export function orgConfigValidationError(content: unknown): string | null {
  if (!validateOrgConfig(content)) {
    const llm = (content as { llm?: unknown } | null)?.llm;
    if (llm !== undefined) {
      const llmError = validateLlmConfig(llm);
      if (llmError) return `Invalid LLM config: ${llmError}`;
    }
    return 'Invalid config structure. Required fields: branding.{logoLight, logoDark, displayName, agentName, favicon}';
  }
  return null;
}

/** Validate the `llm` config section; returns the failure reason or null when
 *  valid. Exported for the register route's bootstrap `llm` payload. */
export function validateLlmConfig(llm: unknown): string | null {
  if (typeof llm !== 'object' || llm === null) return 'llm must be an object';
  const cfg = llm as Record<string, unknown>;

  const names = new Set<string>();
  if (cfg.providers !== undefined) {
    if (!Array.isArray(cfg.providers)) return 'providers must be an array';
    for (const entry of cfg.providers) {
      if (typeof entry !== 'object' || entry === null) return 'each provider must be an object';
      const p = entry as Record<string, unknown>;
      if (typeof p.name !== 'string' || p.name === '') return 'every provider needs a non-empty name';
      if (typeof p.provider !== 'string' || p.provider === '') return `provider '${p.name}' needs a provider type`;
      if (names.has(p.name)) return `duplicate provider name '${p.name}'`;
      names.add(p.name);
      for (const field of ['apiKey', 'awsRegion', 'baseUrl'] as const) {
        if (p[field] !== undefined && typeof p[field] !== 'string') return `provider '${p.name}': ${field} must be a string`;
      }
      if (p.headers !== undefined && (typeof p.headers !== 'object' || p.headers === null)) return `provider '${p.name}': headers must be an object`;
    }
  }

  // The pre-grades shape. Rejected on write with a pointer at the new model
  // (stored old configs are never re-validated at read time, so existing
  // workspaces don't brick — they just behave as unconfigured grades).
  if (cfg.assignments !== undefined) {
    return '`assignments` was replaced by `grades` — reconfigure in Settings → Models';
  }

  if (cfg.grades !== undefined) {
    if (typeof cfg.grades !== 'object' || cfg.grades === null) return 'grades must be an object';
    for (const [grade, choice] of Object.entries(cfg.grades)) {
      if (!(LLM_GRADES as readonly string[]).includes(grade)) return `unknown grade '${grade}'`;
      if (typeof choice !== 'object' || choice === null) return `grade '${grade}' must map to an object`;
      const c = choice as Record<string, unknown>;
      if (typeof c.providerName !== 'string' || c.providerName === '') return `grade '${grade}' is missing its provider`;
      if (cfg.providers !== undefined && !names.has(c.providerName)) {
        return `grade '${grade}' references provider '${c.providerName}', which does not exist`;
      }
      if (c.model !== undefined && typeof c.model !== 'string') return `model for grade '${grade}' must be a string`;
      if (c.options !== undefined && (typeof c.options !== 'object' || c.options === null)) return `options for grade '${grade}' must be an object`;
    }
  }

  if (cfg.agents !== undefined) {
    if (typeof cfg.agents !== 'object' || cfg.agents === null) return 'agents must be an object';
    for (const [agent, policy] of Object.entries(cfg.agents)) {
      if (!(LLM_AGENT_KEYS as readonly string[]).includes(agent)) return `unknown agent '${agent}'`;
      if (typeof policy !== 'object' || policy === null) return `agent '${agent}' policy must be an object`;
      const p = policy as Record<string, unknown>;
      if (p.allowedGrades !== undefined) {
        if (!Array.isArray(p.allowedGrades) || p.allowedGrades.length === 0) return `agent '${agent}': allowedGrades must be a non-empty array`;
        for (const grade of p.allowedGrades) {
          if (!(LLM_GRADES as readonly string[]).includes(grade as string)) return `agent '${agent}': invalid grade '${grade}'`;
        }
      }
      if (p.defaultGrade !== undefined && !(LLM_GRADES as readonly string[]).includes(p.defaultGrade as string)) {
        return `agent '${agent}': invalid grade '${p.defaultGrade}'`;
      }
    }
  }

  return null;
}
