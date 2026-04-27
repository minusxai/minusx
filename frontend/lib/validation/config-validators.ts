import type { OrgConfig, AccessRulesOverride } from '@/lib/branding/whitelabel';
import { validateWebhook } from '@/lib/messaging/webhook-executor';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import { immutableSet } from '@/lib/utils/immutable-collections';
import type { VisualizationType } from '@/lib/types';

const VALID_VIZ_TYPES: readonly VisualizationType[] = [
  'table', 'bar', 'line', 'scatter', 'area', 'funnel', 'pie', 'pivot', 'trend', 'waterfall', 'combo', 'radar', 'geo'
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
    const validFields = ['displayName', 'agentName', 'favicon', 'logoLight', 'logoDark'];

    for (const field of validFields) {
      if (branding[field] !== undefined) {
        if (typeof branding[field] !== 'string' || branding[field].trim() === '') return false;
      }
    }
    for (const field of Object.keys(branding)) {
      if (!validFields.includes(field)) return false;
    }
  }

  if (config.links !== undefined) {
    if (typeof config.links !== 'object' || config.links === null) return false;

    const links = config.links;
    const validFields = ['docsUrl', 'supportUrl', 'githubIssuesUrl'];

    for (const field of validFields) {
      if (links[field] !== undefined) {
        if (typeof links[field] !== 'string' || links[field].trim() === '') return false;
      }
    }
    for (const field of Object.keys(links)) {
      if (!validFields.includes(field)) return false;
    }
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

  if (config.setupWizard !== undefined) {
    const sw = config.setupWizard as any;
    if (typeof sw !== 'object' || sw === null) return false;
    if (!['pending', 'complete'].includes(sw.status)) return false;
    const VALID_STEPS = ['welcome', 'connection', 'context', 'generating'];
    if (sw.step !== undefined && !VALID_STEPS.includes(sw.step)) return false;
    if (sw.connectionId !== undefined && typeof sw.connectionId !== 'number') return false;
    if (sw.connectionName !== undefined && typeof sw.connectionName !== 'string') return false;
    if (sw.contextFileId !== undefined && typeof sw.contextFileId !== 'number') return false;
    const VALID_FIELDS = new Set(['status', 'step', 'connectionId', 'connectionName', 'contextFileId']);
    for (const field of Object.keys(sw)) {
      if (!VALID_FIELDS.has(field)) return false;
    }
  }

  return true;
}
