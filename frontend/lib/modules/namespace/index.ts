import type { ExternalIdKind, INamespaceModule } from '../types';

/**
 * Open source Namespace Module.
 *
 * A single-namespace deployment has nothing to disambiguate — every inbound
 * webhook already belongs to the only workspace there is — so binding an
 * external identifier is a no-op.
 */
export class NamespaceModule implements INamespaceModule {
  async bindExternalId(_kind: ExternalIdKind, _externalId: string): Promise<void> {}
  async unbindExternalId(_kind: ExternalIdKind, _externalId: string): Promise<void> {}
}
