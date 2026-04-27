import 'server-only';
import { DocumentDB } from '@/lib/database/documents-db';
import { hashContent } from '@/lib/utils/query-hash';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { OrgConfig, DEFAULT_CONFIG, DEFAULT_STYLES, mergeConfig } from '@/lib/branding/whitelabel';
import { getModules } from '@/lib/modules/registry';
import { resolvePath } from '@/lib/mode/path-resolver';
import { Mode, DEFAULT_MODE } from '@/lib/mode/mode-types';
import { validateOrgConfig } from '@/lib/validation/config-validators';
export { validateOrgConfig } from '@/lib/validation/config-validators';

export interface GetConfigsResult {
  config: OrgConfig;
}

/**
 * Deep-merge two partial configs for server-side partial update support.
 * Incoming fields override base fields; missing incoming fields keep base values.
 * Nested objects (branding, links) are deep-merged so partial nested updates don't wipe sibling fields.
 */
export function mergePartialConfigs(
  base: Partial<OrgConfig>,
  incoming: Partial<OrgConfig>
): Partial<OrgConfig> {
  return {
    ...base,
    ...incoming,
    branding: incoming.branding ? { ...(base.branding || {}), ...incoming.branding } : base.branding,
    links: incoming.links ? { ...(base.links || {}), ...incoming.links } : base.links,
  };
}

class ConfigsDataLayerServer {
  /**
   * Get configs for authenticated user
   * Used after login
   */
  async getConfig(user: EffectiveUser): Promise<GetConfigsResult> {
    return this._loadConfigs(user.mode);
  }

  /**
   * Save (create or update) org config.
   * Merges incoming partial config onto existing stored content.
   * Returns the new document ID and the merged config.
   */
  async saveConfig(
    incoming: Partial<OrgConfig>,
    user: EffectiveUser
  ): Promise<{ id: number; config: OrgConfig }> {
    const configPath = resolvePath(user.mode, '/configs/config');
    const existing = await DocumentDB.getByPath(configPath);

    let existingContent: Partial<OrgConfig> = {};
    if (existing?.content && typeof existing.content === 'object') {
      existingContent = existing.content as Partial<OrgConfig>;
    }

    const mergedContent = mergePartialConfigs(existingContent, incoming);

    let id: number;
    if (existing) {
      await DocumentDB.update(existing.id, 'config.json', configPath, mergedContent as any, [], hashContent({ id: existing.id, content: mergedContent }));
      id = existing.id;
    } else {
      id = await DocumentDB.create('config.json', configPath, 'config', mergedContent as any, [], undefined, false);
    }

    const { config } = await this._loadConfigs(user.mode);
    return { id, config };
  }

  private async _loadConfigs(mode: Mode = DEFAULT_MODE): Promise<GetConfigsResult> {
    try {
      // Load from database
      const configPath = resolvePath(mode, '/configs/config');
      const doc = await DocumentDB.getByPath(configPath);

      if (doc && doc.content && typeof doc.content === 'object') {
        const dbContent = doc.content as Partial<OrgConfig>;

        // Validate structure
        if (validateOrgConfig(dbContent)) {
          // Merge with defaults (database overrides defaults)
          const merged = mergeConfig(DEFAULT_CONFIG, dbContent);
          return { config: merged };
        } else {
          console.warn('[Configs] Invalid config structure in database, using defaults');
        }
      }
    } catch (error) {
      console.log('[Configs] Using default config (document not found)', error);
    }

    // Fall back to defaults
    return { config: DEFAULT_CONFIG };
  }
}

export const ConfigsAPI = new ConfigsDataLayerServer();
export const getConfigs = ConfigsAPI.getConfig.bind(ConfigsAPI);
export const saveConfig = ConfigsAPI.saveConfig.bind(ConfigsAPI);

/**
 * Load configs for a given mode without a user session.
 * Used for pre-login branding, middleware, and background jobs in open-source deployments.
 */
export async function getConfigsForMode(mode: Mode = DEFAULT_MODE): Promise<GetConfigsResult> {
  return ConfigsAPI['_loadConfigs'](mode);
}

/**
 * Get the raw (unmerged) config content from the database.
 * Returns an empty object if no config document exists.
 */
export async function getRawConfig(mode: Mode = DEFAULT_MODE): Promise<Partial<OrgConfig>> {
  try {
    const configPath = resolvePath(mode, '/configs/config');
    const doc = await DocumentDB.getByPath(configPath);
    if (doc && doc.content && typeof doc.content === 'object') {
      return doc.content as Partial<OrgConfig>;
    }
  } catch {
    // no-op — fall through to empty config
  }
  return {};
}

/**
 * Save a partial config back to the database.
 * Creates the document if it does not exist, updates it otherwise.
 */
export async function saveRawConfig(mode: Mode, content: Partial<OrgConfig>): Promise<void> {
  const configPath = resolvePath(mode, '/configs/config');
  const existing = await DocumentDB.getByPath(configPath);
  if (existing) {
    await DocumentDB.update(existing.id, existing.name, configPath, content as any, [], hashContent({ id: existing.id, content }));
  } else {
    await DocumentDB.create('config', configPath, 'config', content as any, [], undefined, false);
  }
}

/**
 * Load styles.css
 * @private
 */
async function _loadStyles(mode: Mode = DEFAULT_MODE): Promise<string> {
  try {
    console.log(`[Styles] Loading styles (mode: ${mode})`);
    const stylesPath = resolvePath(mode, '/configs/styles');
    const doc = await DocumentDB.getByPath(stylesPath);

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
  return _loadStyles(user.mode);
}

export const getOrgStyles = getStyles;

/**
 * Get styles for a given mode without a user session.
 */
export async function getStylesForMode(mode: Mode = DEFAULT_MODE): Promise<string> {
  return _loadStyles(mode);
}
