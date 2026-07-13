/**
 * Config Loader
 * Handles config file transformations
 * Future: Merge with default branding values
 */

import { DbFile } from '@/lib/types';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { CustomLoader } from './types';
import { redactRawConfigSecrets } from '@/lib/secrets/config-secret-specs';

/**
 * Config loader — leak guard for LEGACY documents: config credentials are
 * stored as @SECRETS/… refs (safe to show), but docs written before extraction
 * existed may still hold raw values at secret paths. Mask those on every read
 * (files API, ReadFiles tool, config.json page); keys and non-secret values
 * pass through verbatim.
 */
export const configLoader: CustomLoader = async (file: DbFile, _user: EffectiveUser, _options?) => {
  // Skip if content not loaded
  if (file.content === null) {
    return file;
  }

  return { ...file, content: redactRawConfigSecrets(file.content) };
};
