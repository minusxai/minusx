import type { OrgConfig, AccessRulesOverride } from '@/lib/branding/whitelabel';
import { validateWebhook } from '@/lib/messaging/webhook-executor';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import { immutableSet } from '@/lib/utils/immutable-collections';
import type { VisualizationType } from '@/lib/types';
import { LLM_USE_CASES } from '@/lib/llm/llm-config-types';

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
  if (config.groups !== undefined && validateGroupsSection(config.groups) != null) return false;

  return true;
}

/** Validate the `groups` config section; returns the failure reason or null. */
export function validateGroupsSection(groups: unknown): string | null {
  if (typeof groups !== 'object' || groups === null || Array.isArray(groups)) {
    return 'groups must be an object keyed by group name';
  }
  const RESERVED = new Set(['admin', 'editor', 'viewer']);
  const isTypeSet = (v: unknown) => v === '*' || (Array.isArray(v) && v.every(x => typeof x === 'string'));
  for (const [name, def] of Object.entries(groups as Record<string, unknown>)) {
    if (!name.trim()) return 'group names must be non-empty';
    if (RESERVED.has(name)) return `"${name}" is a built-in group and cannot be redefined`;
    if (typeof def !== 'object' || def === null) return `group "${name}" must be an object`;
    const g = def as Record<string, unknown>;
    if (!isTypeSet(g.allowedTypes)) return `group "${name}": allowedTypes must be "*" or an array of file types`;
    if (!isTypeSet(g.viewTypes)) return `group "${name}": viewTypes must be "*" or an array of file types`;
    if (!isTypeSet(g.createTypes)) return `group "${name}": createTypes must be "*" or an array of file types`;
    if (!Array.isArray(g.folders) || !g.folders.every(f => typeof f === 'string')) {
      return `group "${name}": folders must be an array of folder strings`;
    }
  }
  return null;
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

  if (cfg.assignments !== undefined) {
    if (typeof cfg.assignments !== 'object' || cfg.assignments === null) return 'assignments must be an object';
    for (const [useCase, assignment] of Object.entries(cfg.assignments)) {
      if (!(LLM_USE_CASES as readonly string[]).includes(useCase)) return `unknown use case '${useCase}'`;
      if (typeof assignment !== 'object' || assignment === null) return `assignment for '${useCase}' must be an object`;
      const chain = (assignment as Record<string, unknown>).chain;
      if (!Array.isArray(chain) || chain.length === 0) return `assignment for '${useCase}' needs a non-empty chain`;
      for (const choice of chain) {
        if (typeof choice !== 'object' || choice === null) return `chain entries for '${useCase}' must be objects`;
        const c = choice as Record<string, unknown>;
        if (typeof c.providerName !== 'string' || c.providerName === '') return `a chain entry for '${useCase}' is missing its provider`;
        if (cfg.providers !== undefined && !names.has(c.providerName)) {
          return `the '${useCase}' assignment references provider '${c.providerName}', which does not exist`;
        }
        if (c.model !== undefined && typeof c.model !== 'string') return `model for '${useCase}' must be a string`;
        if (c.options !== undefined && (typeof c.options !== 'object' || c.options === null)) return `options for '${useCase}' must be an object`;
      }
    }
  }

  return null;
}
