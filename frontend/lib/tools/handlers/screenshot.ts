/**
 * Screenshot — LEGACY alias of ReviewFile, kept registered so saved conversation logs that
 * contain pending Screenshot calls still resume. New conversations use ReviewFile (the
 * web-analyst toolset no longer offers Screenshot). Same behavior: capture the LIVE rendered
 * view + return the combined health rubric.
 */
export { reviewFileHandler as screenshotHandler } from './review-file';
