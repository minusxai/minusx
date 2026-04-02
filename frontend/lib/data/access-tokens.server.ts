import 'server-only';
import { AccessTokenDB } from '@/lib/database/documents-db';

/**
 * Server-side data layer for access tokens.
 * All access token operations go through this module — never import AccessTokenDB directly.
 */
export const AccessTokensAPI = {
  getByToken: AccessTokenDB.getByToken.bind(AccessTokenDB),
  create: AccessTokenDB.create.bind(AccessTokenDB),
  listByFileId: AccessTokenDB.listByFileId.bind(AccessTokenDB),
  revoke: AccessTokenDB.revoke.bind(AccessTokenDB),
  updateExpiration: AccessTokenDB.updateExpiration.bind(AccessTokenDB),
  validateToken: AccessTokenDB.validateToken,
};
