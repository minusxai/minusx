#!/usr/bin/env tsx
/**
 * Assert every code pointer in every AGENTS.md resolves to a real file.
 *
 * AGENTS.md files earn their keep by pointing at code. A pointer that rots is
 * worse than no pointer — it sends an agent (or a person) to a file that isn't
 * there, and nothing in CI notices. This walks every AGENTS.md, pulls the
 * repo-relative paths out of backticks, and fails if any of them is gone.
 *
 * Deliberately mechanical: no LLM, no judgement, ~milliseconds. It cannot tell
 * you a description is stale — only that a path is dead, which is the failure
 * mode that has actually bitten this repo.
 *
 * Usage:
 *   npm run check-agents-md
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// NOTE: `data` is deliberately absent — the repo-root `data/` holds databases, but
// `frontend/lib/data/` is a source directory and skipping it hides real files.
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.next-qa', 'dist', 'build', 'out']);

/**
 * A backticked token is treated as a path claim when it looks like one: it has a
 * slash or a known source extension, and no spaces/globs/pipes. Prose like
 * `verified` or `SELECT * FROM` must not be dragged in.
 */
const PATH_LIKE = /^[\w./@[\]-]+$/;
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|yaml|yml|css|sql|mdx)$/;

function findAgentsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      findAgentsFiles(join(dir, entry.name), out);
    } else if (entry.name === 'AGENTS.md') {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** Pull every plausible path claim out of the backticked spans of a markdown file. */
function extractPathClaims(md: string): { raw: string; line: number }[] {
  const claims: { raw: string; line: number }[] = [];
  const lines = md.split('\n');
  let inFence = false;

  lines.forEach((line, i) => {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      return;
    }
    if (inFence) return; // code blocks are examples, not pointers

    for (const [, token] of line.matchAll(/`([^`]+)`/g)) {
      const t = token.trim();
      if (!PATH_LIKE.test(t)) continue;
      // A bare identifier (`useFile`, `QueryResult`) is a symbol, not a path.
      if (!t.includes('/') && !SOURCE_EXT.test(t)) continue;
      // Globs and dynamic segments can't be checked literally.
      if (t.includes('*')) continue;
      // Leading `/` is a URL or an app-virtual path (`/config/users.yml`), and a
      // leading `.` is a relative import or a bare suffix (`.server.ts`) — neither
      // can be resolved against the repo without context we don't have.
      if (t.startsWith('/') || t.startsWith('.')) continue;
      // `NextResponse.json` is a method call, not a file. Config/data files are
      // never CamelCase, so CamelCase + .json is always a symbol.
      if (/^[A-Z][A-Za-z0-9]*\.json$/.test(t)) continue;
      // Slash-separated prose (`columns/types/rows`) is a field list, not a path:
      // a real path claim ends in a source extension or names a real directory.
      if (t.includes('/') && !SOURCE_EXT.test(t) && !t.startsWith('@/')) {
        if (!existsSync(join(REPO_ROOT, t)) && !existsSync(join(REPO_ROOT, 'frontend', t))) continue;
      }
      claims.push({ raw: t, line: i + 1 });
    }
  });
  return claims;
}

/**
 * An npm package specifier, not a repo path. `@scope/name` and bare module ids
 * have no extension and no `./` — checking them against the filesystem is
 * meaningless, and node_modules may not even be installed.
 */
function isPackageSpecifier(claim: string): boolean {
  if (claim.startsWith('@') && !claim.startsWith('@/')) return true; // @scope/pkg
  return false;
}

/** `@/x` is the tsconfig alias for `frontend/x`. */
function resolveAlias(claim: string): string | null {
  return claim.startsWith('@/') ? join('frontend', claim.slice(2)) : null;
}

const exists = (p: string): boolean => {
  if (!existsSync(p)) return false;
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
};

/** A TS alias or extensionless import may name a file, a dir, or a dir/index.ts. */
function existsAsModule(base: string): boolean {
  if (exists(base)) return true;
  return ['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx'].some((s) => exists(base + s));
}

/** Bare filenames are written relative to the module — find them anywhere beneath it. */
function existsSomewhereUnder(dir: string, filename: string, depth = 0): boolean {
  if (depth > 4) return false;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isFile() && e.name === filename) return true;
    if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) {
      if (existsSomewhereUnder(join(dir, e.name), filename, depth + 1)) return true;
    }
  }
  return false;
}

/**
 * Resolve a claim against the repo. A path may be written relative to the repo
 * root, to frontend/ (the dominant working dir), as a `@/` tsconfig alias, or as
 * a bare filename somewhere inside the module the AGENTS.md documents.
 */
function resolves(claim: string, agentsDir: string): boolean {
  if (isPackageSpecifier(claim)) return true; // npm specifier — not ours to check

  const cleaned = claim.replace(/^\.\//, '').replace(/\/$/, '');
  if (!cleaned) return false;

  const alias = resolveAlias(cleaned);
  if (alias) return existsAsModule(join(REPO_ROOT, alias));

  if (
    [REPO_ROOT, agentsDir, join(REPO_ROOT, 'frontend')].some((base) =>
      existsAsModule(join(base, cleaned)),
    )
  ) {
    return true;
  }

  // A bare filename is written relative to the module it documents, or names a
  // well-known file elsewhere in the app. Search the module first (cheap, and the
  // common case), then the app tree.
  const basename = cleaned.split('/').pop()!;
  if (existsSomewhereUnder(agentsDir, basename)) return true;
  if (existsSomewhereUnder(join(REPO_ROOT, 'frontend'), basename)) return true;
  return existsSomewhereUnder(REPO_ROOT, basename, 1); // e.g. .github/workflows/qa.yml
}

const agentsFiles = findAgentsFiles(REPO_ROOT);
if (agentsFiles.length === 0) {
  console.error('check-agents-md: no AGENTS.md files found — is the repo root correct?');
  process.exit(1);
}

let checked = 0;
const failures: string[] = [];

for (const file of agentsFiles) {
  const rel = file.slice(REPO_ROOT.length + 1);
  const md = readFileSync(file, 'utf8');
  const agentsDir = dirname(file);

  for (const { raw, line } of extractPathClaims(md)) {
    checked++;
    if (!resolves(raw, agentsDir)) failures.push(`${rel}:${line}  dead path: \`${raw}\``);
  }
}

if (failures.length > 0) {
  console.error(`\ncheck-agents-md: ${failures.length} dead path(s) across ${agentsFiles.length} AGENTS.md file(s):\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('\nFix the path, or delete the pointer. Docs that lie are worse than no docs.\n');
  process.exit(1);
}

console.log(`check-agents-md: ${checked} path pointer(s) across ${agentsFiles.length} AGENTS.md file(s) — all resolve.`);
