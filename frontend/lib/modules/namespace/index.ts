import { DEFAULT_ISOLATION } from '@/lib/namespace/types';
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
  async isolation(): Promise<string> {
    return DEFAULT_ISOLATION;
  }

  async bindExternalId(_kind: ExternalIdKind, _externalId: string): Promise<void> {}
  async unbindExternalId(_kind: ExternalIdKind, _externalId: string): Promise<void> {}
}
