/**
 * Database version constants for migrations
 */

export const LATEST_DATA_VERSION = 23;  // V23: Migrate alert files: questionId + AlertCondition → tests: Test[]
export const LATEST_SCHEMA_VERSION = 8;  // V8: Revise job_runs table (drop input/output, rename columns)
