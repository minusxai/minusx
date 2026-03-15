/**
 * Database version constants for migrations
 */

export const LATEST_DATA_VERSION = 18;  // V18: Reassign /org file IDs < 100 to IDs > 100
export const LATEST_SCHEMA_VERSION = 8;  // V8: Revise job_runs table (drop input/output, rename columns)
