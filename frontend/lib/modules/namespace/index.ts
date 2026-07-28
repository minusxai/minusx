import { DEFAULT_ISOLATION } from '@/lib/namespace/types';
import { getDataVersion } from '@/lib/database/config-store';
import type { NextRequest } from 'next/server';
import type { ExternalIdKind, INamespaceModule } from '../types';

/**
 * Open source Namespace Module.
 *
 * One workspace, so the isolation level is a constant and there is nothing to
 * disambiguate — binding an external identifier is a no-op. The constant is non-empty
 * so that prefixing is unconditional: an empty prefix would make every call site
 * check before joining.
 */
export class NamespaceModule implements INamespaceModule {
  /** One workspace, so every request resolves to the same namespace. */
  async resolve(_req: NextRequest, _hints?: Record<string, string>): Promise<string | null> {
    return DEFAULT_ISOLATION;
  }

  /** Nothing ambient to establish — the namespace is a constant. */
  async with<T>(_namespace: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async isolation(): Promise<string> {
    return DEFAULT_ISOLATION;
  }

  /** One workspace, so the fleet minimum is just its own version. */
  async minDataVersion(): Promise<number> {
    return getDataVersion();
  }

  async bindExternalId(_kind: ExternalIdKind, _externalId: string): Promise<void> {}
  async unbindExternalId(_kind: ExternalIdKind, _externalId: string): Promise<void> {}
}
