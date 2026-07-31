#!/usr/bin/env tsx
/**
 * Prove that a change touched ONLY comments.
 *
 * A comment audit edits prose inside thousands of files. Reading the diff by eye does
 * not scale, and one stray edit to an expression is a live defect wearing the disguise
 * of a typo fix. So instead of trusting the diff, this re-derives the CODE from both
 * versions — parse to an AST, print it back with `removeComments` — and asserts the two
 * renderings are byte-identical.
 *
 * Printing the AST rather than scanning tokens is deliberate. A standalone
 * `ts.createScanner` cannot re-scan template-literal continuations (the `}…${` and `}…\``
 * forms need parser feedback), so everything after the first substitution template
 * collapses into one giant token — which silently swallows appended comments and reports
 * a false difference. The parser has that context; the printer is a pure function of the
 * AST, so reindenting, rewrapping or deleting a comment cannot change its output, and
 * changing one character of code cannot fail to.
 *
 * Usage:
 *   npx tsx scripts/assert-comments-only.ts            # working tree vs HEAD
 *   npx tsx scripts/assert-comments-only.ts <ref>      # working tree vs <ref>
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const BASE = process.argv[2] || 'HEAD';
const MAX = 64 * 1024 * 1024;

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

/** Code with every comment removed, normalised through the printer. */
function codeOnly(source: string, filename: string): string {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, /* setParentNodes */ false);
  return printer.printFile(sf);
}

function show(ref: string, path: string): string | null {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: MAX });
  } catch {
    return null; // added file — nothing to compare against
  }
}

const changed = execFileSync('git', ['diff', '--name-only', BASE, '--', '*.ts', '*.tsx'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
  maxBuffer: MAX,
})
  .split('\n')
  .filter(Boolean);

const offenders: string[] = [];
let compared = 0;

for (const rel of changed) {
  const before = show(BASE, rel);
  if (before === null) continue;
  let after: string;
  try {
    after = readFileSync(join(REPO_ROOT, rel), 'utf8');
  } catch {
    continue; // deleted
  }
  compared++;
  if (codeOnly(before, rel) !== codeOnly(after, rel)) offenders.push(rel);
}

if (offenders.length) {
  console.error(`\nassert-comments-only: ${offenders.length} file(s) changed CODE, not just comments:\n`);
  for (const o of offenders) console.error(`  ${o}`);
  console.error('\nReview each by hand. A comment audit must not alter behaviour.\n');
  process.exit(1);
}

console.log(`assert-comments-only: ${compared} changed file(s) — code identical, comments only.`);
