/**
 * Database version constants for migrations
 */

export const LATEST_DATA_VERSION = 25;  // V25: Set setupWizard.status = 'complete' on all existing /org/configs/config documents
export const LATEST_SCHEMA_VERSION = 9;  // V9: Add OAuth tables (oauth_authorization_codes, oauth_tokens)
