/**
 * Frontend-bridge schema ⇄ handler sync tripwire.
 *
 * Bridged tools declare their LLM-facing schema in `agents/web-analyst/web-tools.ts` but execute
 * in `lib/tools/tool-handlers.ts` — two files that can silently drift. That drift is exactly how
 * `ReadFiles.rawData` shipped: the handler supported it, the schema never declared it, so the
 * model couldn't know it existed and reasoned from chart images instead of reading rows.
 *
 * This test parses the handler source and asserts, for every bridged tool with an inline handler:
 *   1. every `args` key the handler reads is DECLARED in the schema (no invisible params), and
 *   2. every schema property is actually READ by the handler (no lying schemas).
 *
 * Colocated server tools (run() reads this.parameters) can't drift and are out of scope.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  EditFile, CreateFile, ReadFiles, Navigate, Screenshot, ClarifyFrontend, PublishAll,
} from '@/agents/web-analyst/web-tools';

// ── Extraction ────────────────────────────────────────────────────────────────

/** The `args` keys a handler block reads: `{ a, b = x, c: alias } = args` + `args.d`. */
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

/** Split tool-handlers.ts into { toolName → inline handler source }. Non-inline registrations
 *  (a shared named function) are skipped — their reads live outside the block. */
export function extractHandlerBlocks(source: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const parts = source.split(/registerFrontendTool\('/).slice(1);
  for (const part of parts) {
    const name = part.slice(0, part.indexOf("'"));
    const next = part.indexOf("registerFrontendTool('");
    const body = next === -1 ? part : part.slice(0, next);
    // Inline handler only: `registerFrontendTool('X', async (args…` — skip shared named fns.
    if (/^[^,]*,\s*async\s*\(/.test(body)) blocks.set(name, body);
  }
  return blocks;
}

// ── Extractor self-test: prove the tripwire actually catches the rawData bug class ──

describe('extractor self-test', () => {
  it('detects a handler reading an undeclared key (the ReadFiles.rawData bug shape)', () => {
    const snippet = `registerFrontendTool('ReadFiles', async (args, _context) => {
      const { fileIds, maxChars: rawMaxChars, runQueries = true, rawData = false } = args;
      return args.somethingElse;
    });`;
    const blocks = extractHandlerBlocks(snippet);
    const keys = extractArgsKeys(blocks.get('ReadFiles')!);
    expect(keys).toEqual(new Set(['fileIds', 'maxChars', 'runQueries', 'rawData', 'somethingElse']));
  });

  it('skips non-inline registrations (shared named handlers)', () => {
    const blocks = extractHandlerBlocks("registerFrontendTool('LoadSkill', resolveUserSkillFrontend);\n");
    expect(blocks.has('LoadSkill')).toBe(false);
  });
});

// ── The real audit ────────────────────────────────────────────────────────────

const HANDLERS_PATH = join(__dirname, '..', 'tool-handlers.ts');

/** Bridged tools with inline handlers, mapped to their LLM-facing schema. */
const BRIDGED_TOOLS = [
  { name: 'EditFile', schema: EditFile.schema },
  { name: 'CreateFile', schema: CreateFile.schema },
  { name: 'ReadFiles', schema: ReadFiles.schema },
  { name: 'Navigate', schema: Navigate.schema },
  { name: 'Screenshot', schema: Screenshot.schema },
  { name: 'ClarifyFrontend', schema: ClarifyFrontend.schema },
  { name: 'PublishAll', schema: PublishAll.schema },
] as const;

describe('frontend-bridge tools: schema ⇄ handler sync', () => {
  const source = readFileSync(HANDLERS_PATH, 'utf8');
  const blocks = extractHandlerBlocks(source);

  it.each(BRIDGED_TOOLS.map((t) => [t.name, t] as const))(
    '%s: every args key the handler reads is declared in the LLM schema',
    (_name, tool) => {
      const block = blocks.get(tool.name);
      expect(block, `no inline handler block found for ${tool.name} — update this test's mapping`).toBeTruthy();
      const read = extractArgsKeys(block!);
      const declared = new Set(Object.keys((tool.schema.parameters as { properties?: object }).properties ?? {}));
      const undeclaredReads = [...read].filter((k) => !declared.has(k));
      expect(undeclaredReads, `handler reads args the model is never told about — add to ${tool.name}Params`).toEqual([]);
    },
  );

  it.each(BRIDGED_TOOLS.map((t) => [t.name, t] as const))(
    '%s: every schema property is actually read by the handler',
    (_name, tool) => {
      const read = extractArgsKeys(blocks.get(tool.name)!);
      const declared = Object.keys((tool.schema.parameters as { properties?: object }).properties ?? {});
      const deadParams = declared.filter((k) => !read.has(k));
      expect(deadParams, `schema advertises params the handler ignores — remove from ${tool.name}Params or implement`).toEqual([]);
    },
  );
});
