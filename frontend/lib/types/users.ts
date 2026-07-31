// ============================================================================
// Users domain types — split out of lib/types.ts (thin barrel there re-exports
// everything here; see lib/types.ts for the barrel).
// ============================================================================

import type { BaseFileContent } from './files';

export type UserRole = 'admin' | 'editor' | 'viewer';

export interface UserState {
  twofa_phone_otp_enabled?: boolean;
  twofa_sms_enabled?: boolean;      // Future
  twofa_email_enabled?: boolean;    // Future
  // Other user preferences can be added here
}

export interface User {
  id?: number;               // user ID from database (added in Phase 1)
  name: string;              // full name of the user
  email: string;
  phone?: string;            // optional phone number (used for Phone 2FA delivery)
  home_folder?: string;      // relative path to home folder (e.g., "sales/team-a" or "" for mode root) - admins always get "" (mode-scoped)
  password_hash?: string;    // optional bcrypt hashed password
  role: UserRole;            // user role: admin (full access), editor (create/edit most file types), viewer (read-only apart from conversations) — per-type grants live in rules.json; NOT NULL in database
}

export interface UsersContent extends BaseFileContent {
  users: User[];             // array of users (both regular and admins)
}
