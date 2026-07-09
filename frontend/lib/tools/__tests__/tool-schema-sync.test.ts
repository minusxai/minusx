/**
 * Frontend-bridge schema ⇄ handler sync tripwire.
 *
 * Bridged tools declare their LLM-facing schema in `agents/web-analyst/web-tools.ts` but execute
 * in `lib/tools/handlers/*.ts` (one module per tool, wired up by `lib/tools/tool-handlers.ts`) —
 * files that can silently drift from the schema. That drift is exactly how `ReadFiles.rawData`
 * shipped: the handler supported it, the schema never declared it, so the model couldn't know it
 * existed and reasoned from chart images instead of reading rows.
 *
 * This test parses each handler's source module and asserts, for every bridged tool:
 *   1. every `args` key the handler reads is DECLARED in the schema (no invisible params), and
 *   2. every schema property is actually READ by the handler (no lying schemas).
 *
 * Colocated server tools (run() reads this.parameters) can't drift and are out of scope.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  EditFile, CreateFile, ReadFiles, Navigate, ReviewFile, ClarifyFrontend, PublishAll,
} from '@/agents/web-analyst/web-tools';

// ── Extraction ────────────────────────────────────────────────────────────────

/** The `args` keys a handler reads: `{ a, b = x, c: alias } = args` + `args.d`. */
export function extractArgsKeys(handlerSource: string): Set<string> {
  const keys = new Set<string>();
  for (const m of handlerSource.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*args\b/g)) {
    for (const part of m[1].split(',')) {
      const key = part.trim().split(/[:=\s]/)[0]?.trim();
      if (key) keys.add(key);
    }
  }
  for (const m of handlerSource.matchAll(/\bargs\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    keys.add(m[1]);
  }
  return keys;
}

// ── Extractor self-test: prove the tripwire actually catches the rawData bug class ──

describe('extractArgsKeys self-test', () => {
  it('detects a handler reading an undeclared key (the ReadFiles.rawData bug shape)', () => {
    const snippet = `export const readFilesHandler: FrontendToolHandler = async (args, _context) => {
      const { fileIds, maxChars: rawMaxChars, runQueries = true, rawData = false } = args;
      return args.somethingElse;
    };`;
    const keys = extractArgsKeys(snippet);
    expect(keys).toEqual(new Set(['fileIds', 'maxChars', 'runQueries', 'rawData', 'somethingElse']));
  });

  it('does not false-positive on a comment ending in the literal "args."', () => {
    // Real example: edit-file.ts has a trailing comment "...the change args." — no identifier
    // follows the dot, so this must NOT be read as a property access.
    const snippet = '// the agent already knows its edit from the prior app state + the change args.\n';
    expect(extractArgsKeys(snippet)).toEqual(new Set());
  });
});

// ── The real audit ────────────────────────────────────────────────────────────

const HANDLERS_DIR = join(__dirname, '..', 'handlers');

/** Bridged tools, mapped to their LLM-facing schema + implementation module. */
const BRIDGED_TOOLS = [
  { name: 'EditFile', schema: EditFile.schema, file: 'edit-file.ts' },
  { name: 'CreateFile', schema: CreateFile.schema, file: 'create-file.ts' },
  { name: 'ReadFiles', schema: ReadFiles.schema, file: 'read-files.ts' },
  { name: 'Navigate', schema: Navigate.schema, file: 'navigate.ts' },
  // Screenshot is a legacy alias of ReviewFile (same schema, same handler) — auditing ReviewFile covers it.
  { name: 'ReviewFile', schema: ReviewFile.schema, file: 'review-file.ts' },
  { name: 'ClarifyFrontend', schema: ClarifyFrontend.schema, file: 'clarify.ts' },
  { name: 'PublishAll', schema: PublishAll.schema, file: 'publish-all.ts' },
] as const;

describe('frontend-bridge tools: schema ⇄ handler sync', () => {
  it.each(BRIDGED_TOOLS.map((t) => [t.name, t] as const))(
    '%s: every args key the handler reads is declared in the LLM schema',
    (_name, tool) => {
      const source = readFileSync(join(HANDLERS_DIR, tool.file), 'utf8');
      const read = extractArgsKeys(source);
      const declared = new Set(Object.keys((tool.schema.parameters as { properties?: object }).properties ?? {}));
      const undeclaredReads = [...read].filter((k) => !declared.has(k));
      expect(undeclaredReads, `handler reads args the model is never told about — add to ${tool.name}Params`).toEqual([]);
    },
  );

  it.each(BRIDGED_TOOLS.map((t) => [t.name, t] as const))(
    '%s: every schema property is actually read by the handler',
    (_name, tool) => {
      const source = readFileSync(join(HANDLERS_DIR, tool.file), 'utf8');
      const read = extractArgsKeys(source);
      const declared = Object.keys((tool.schema.parameters as { properties?: object }).properties ?? {});
      const deadParams = declared.filter((k) => !read.has(k));
      expect(deadParams, `schema advertises params the handler ignores — remove from ${tool.name}Params or implement`).toEqual([]);
    },
  );
});
