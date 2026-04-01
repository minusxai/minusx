/**
 * Database version constants for migrations
 */

export const LATEST_DATA_VERSION = 24;  // V24: Replace old Slack HTTP template with SLACK_DEFAULT keyword; add EMAIL_DEFAULT keyword for missing email webhooks
export const LATEST_SCHEMA_VERSION = 8;  // V8: Revise job_runs table (drop input/output, rename columns)
