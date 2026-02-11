/**
 * Config Loader
 * Handles config file transformations
 * Future: Merge with default branding values
 */

import { DbFile } from '@/lib/types';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { CustomLoader } from './types';

/**
 * Config loader - pass-through for now
 * Future: Merge content with DEFAULT_BRANDING from whitelabel.ts
 */
export const configLoader: CustomLoader = async (file: DbFile, _user: EffectiveUser, _options?) => {
  // Skip if content not loaded
  if (file.content === null) {
    return file;
  }

  // TODO: Merge with default branding values
  // const defaultBranding = getCompanyBranding(user.companyName);
  // file.content = { ...defaultBranding, ...file.content };

  return file;
};
