/**
 * Database version constants for migrations
 */

export const LATEST_DATA_VERSION = 20;  // V20: Migrate alert emails[] → recipients[]
export const LATEST_SCHEMA_VERSION = 8;  // V8: Revise job_runs table (drop input/output, rename columns)
