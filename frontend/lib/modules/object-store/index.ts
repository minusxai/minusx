import { IObjectStoreModule, PresignedUrl, RequestContext } from '../types';

/**
 * Open source Object Store Module — delegates to existing lib/object-store functions.
 *
 * NOTE: Full wiring of object-store calls into this module is deferred to Phase 5.
 * Existing code continues to call lib/object-store/index.ts directly.
 * This stub satisfies the ModuleSet type requirement.
 */
export class ObjectStoreModule implements IObjectStoreModule {
  resolvePath(logicalKey: string, _context: RequestContext): string {
    return logicalKey;
  }

  async getUploadUrl(_logicalKey: string, _context: RequestContext): Promise<PresignedUrl> {
    throw new Error('getUploadUrl() — use lib/object-store/index.ts directly');
  }

  async getDownloadUrl(_logicalKey: string, _context: RequestContext): Promise<string> {
    throw new Error('getDownloadUrl() — use lib/object-store/index.ts directly');
  }

  generateKey(_type: 'chart' | 'csv' | 'upload', _context: RequestContext, _ext: string): string {
    throw new Error('generateKey() — use lib/object-store/index.ts directly');
  }
}
