/**
 * Setup file for the orchestrator vitest project.
 *
 * Agent tests now transitively import production modules (FilesAPI, etc.) that
 * pull in next-auth and other Next.js internals. The main project's setup file
 * already mocks all of these uniformly — re-use it here so the orchestrator
 * project gets the same mock baseline. Additional setup specific to orchestrator
 * goes below.
 */
import './vitest.setup';
