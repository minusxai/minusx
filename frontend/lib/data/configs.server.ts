import 'server-only';
import { DocumentDB } from '@/lib/database/documents-db';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { CompanyConfig, DEFAULT_CONFIG, DEFAULT_STYLES, mergeConfig } from '@/lib/branding/whitelabel';
import { getAdapter } from '@/lib/database/adapter/factory';
import { resolvePath } from '@/lib/mode/path-resolver';
import { Mode, DEFAULT_MODE } from '@/lib/mode/mode-types';
import { validateWebhook } from '@/lib/messaging/webhook-executor';

export interface GetConfigsResult {
  config: CompanyConfig;
}

/**
 * Get company name from companies table by ID
 */
export async function getCompanyNameById(companyId: number): Promise<string | null> {
  try {
    const db = await getAdapter();
    const result = await db.query<{ name: string }>(
      'SELECT name FROM companies WHERE id = $1',
      [companyId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].name;
  } catch (error) {
    console.error('[Configs] Error looking up company name:', error);
    return null;
  }
}

/**
 * Validate company config structure
 * Supports partial configs - validates that present fields are properly typed
 */
export function validateCompanyConfig(content: unknown): content is Partial<CompanyConfig> {
  if (!content || typeof content !== 'object') return false;

  const config = content as any;

  // If branding exists, validate its structure
  if (config.branding !== undefined) {
    if (typeof config.branding !== 'object' || config.branding === null) {
      return false;
    }

    const branding = config.branding;
    const validFields = ['displayName', 'agentName', 'favicon'];

    // Validate that any present field is a non-empty string
    for (const field of validFields) {
      if (branding[field] !== undefined) {
        if (typeof branding[field] !== 'string' || branding[field].trim() === '') {
          return false;
        }
      }
    }

    // Reject if there are fields we don't recognize
    for (const field of Object.keys(branding)) {
      if (!validFields.includes(field)) {
        return false;
      }
    }
  }

  // If links exists, validate its structure
  if (config.links !== undefined) {
    if (typeof config.links !== 'object' || config.links === null) {
      return false;
    }

    const links = config.links;
    const validFields = ['docsUrl', 'supportUrl', 'githubIssuesUrl'];

    // Validate that any present field is a non-empty string
    for (const field of validFields) {
      if (links[field] !== undefined) {
        if (typeof links[field] !== 'string' || links[field].trim() === '') {
          return false;
        }
      }
    }

    // Reject if there are fields we don't recognize
    for (const field of Object.keys(links)) {
      if (!validFields.includes(field)) {
        return false;
      }
    }
  }

  // If messaging exists, validate its structure
  if (config.messaging !== undefined) {
    if (typeof config.messaging !== 'object' || config.messaging === null) {
      return false;
    }

    const messaging = config.messaging;

    // Validate webhooks array
    if (!Array.isArray(messaging.webhooks)) {
      return false;
    }

    // Validate each webhook
    for (const webhook of messaging.webhooks) {
      const errors = validateWebhook(webhook);
      if (errors.length > 0) {
        console.warn('[Config] Invalid webhook in messaging config:', errors);
        return false;
      }
    }
  }

  return true;
}

class ConfigsDataLayerServer {
  /**
   * Get configs for authenticated user
   * Used after login
   */
  async getConfig(user: EffectiveUser): Promise<GetConfigsResult> {
    return this._loadConfigsByCompanyId(user.companyId, user.mode);
  }

  private async _loadConfigsByCompanyId(companyId: number, mode: Mode = DEFAULT_MODE): Promise<GetConfigsResult> {
    try {
      // Load from database
      const configPath = resolvePath(mode, '/configs/config');
      const doc = await DocumentDB.getByPath(configPath, companyId);

      if (doc && doc.content && typeof doc.content === 'object') {
        const dbContent = doc.content as Partial<CompanyConfig>;

        // Validate structure
        if (validateCompanyConfig(dbContent)) {
          // Merge with defaults (database overrides defaults)
          const merged = mergeConfig(DEFAULT_CONFIG, dbContent);
          return { config: merged };
        } else {
          console.warn('[Configs] Invalid config structure in database, using defaults');
        }
      }
    } catch (error) {
      console.log('[Configs] Using default config (document not found)');
    }

    // Fall back to defaults
    return { config: DEFAULT_CONFIG };
  }
}

export const ConfigsAPI = new ConfigsDataLayerServer();
export const getConfigs = ConfigsAPI.getConfig.bind(ConfigsAPI);

/**
 * Get configs by company ID directly
 * Used for pre-login in single-tenant mode
 */
export async function getConfigsByCompanyId(companyId: number, mode: Mode = DEFAULT_MODE): Promise<GetConfigsResult> {
  return ConfigsAPI['_loadConfigsByCompanyId'](companyId, mode);
}

/**
 * Load styles.css for a company
 * @private
 */
async function _loadStylesByCompanyId(companyId: number, mode: Mode = DEFAULT_MODE): Promise<string> {
  try {
    console.log(`[Styles] Loading styles for company ${companyId} (mode: ${mode})`);
    const stylesPath = resolvePath(mode, '/configs/styles');
    const doc = await DocumentDB.getByPath(stylesPath, companyId);

    console.log(`[Styles] Document found:`, !!doc);
    if (doc) {
      console.log(`[Styles] Document type:`, doc.type);
      console.log(`[Styles] Content type:`, typeof doc.content);
      console.log(`[Styles] Content:`, JSON.stringify(doc.content).substring(0, 200));
    }

    if (doc && doc.content && typeof doc.content === 'object') {
      const content = doc.content as any;

      // Extract CSS from content.styles
      if (typeof content.styles === 'string') {
        const css = content.styles;
        console.log(`[Styles] Successfully loaded CSS (${css.length} chars)`);

        // Validate CSS safety
        // Note: @import url() is allowed for custom font imports (e.g., Google Fonts)
        const dangerousPatterns = [
          /<script/i,
          /javascript:/i,
          /data:text\/html/i
        ];

        for (const pattern of dangerousPatterns) {
          if (pattern.test(css)) {
            console.warn('[Styles] Rejected styles.css with dangerous pattern');
            return DEFAULT_STYLES;
          }
        }

        return css;
      } else {
        console.warn(`[Styles] content.styles is not a string, type:`, typeof content.styles);
      }
    } else {
      console.warn(`[Styles] Invalid document structure - doc:`, !!doc, 'content:', typeof doc?.content);
    }
  } catch (error) {
    console.error('[Styles] Error loading styles:', error);
  }

  console.log('[Styles] Falling back to DEFAULT_STYLES');
  return DEFAULT_STYLES;
}

/**
 * Get styles for authenticated user
 */
async function getStyles(user: EffectiveUser): Promise<string> {
  return _loadStylesByCompanyId(user.companyId, user.mode);
}

export const getCompanyStyles = getStyles;

/**
 * Get styles by company ID directly
 * Used for pre-login in single-tenant mode
 */
export async function getCompanyStylesById(companyId: number, mode: Mode = DEFAULT_MODE): Promise<string> {
  return _loadStylesByCompanyId(companyId, mode);
}
