import { IObjectStoreModule, PresignedUrl, RequestContext } from '../types';

/**
 * Open source Object Store Module — a stub that only satisfies the ModuleSet
 * type requirement. Nothing calls `getModules().store`: every object-store
 * caller uses lib/object-store/index.ts (createObjectStore) directly, so all
 * methods here throw except resolvePath, which returns the key unchanged.
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
