/**
 * Database version constants for migrations
 */

export const LATEST_DATA_VERSION = 25;  // V25: Set setupWizard.status = 'complete' on all existing /org/configs/config documents
export const LATEST_SCHEMA_VERSION = 8;  // V8: Revise job_runs table (drop input/output, rename columns)
