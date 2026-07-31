#!/usr/bin/env tsx
/**
 * Assert that documentation still points at code that exists.
 *
 * Three sweeps, all mechanical:
 *   1. Every file path referenced in ANY `CLAUDE.md` resolves to a real file or directory.
 *   2. No source comment references a `*.md` file that no longer exists.
 *   3. Every nested `CLAUDE.md` is reachable from the root one.
 *
 * Sweep 3 exists because a nested doc only auto-loads for work inside its own
 * directory. An unlinked module doc is invisible to anyone reading top-down —
 * present, correct, and never found.
 *
 * Neither can tell you a description is WRONG — only that a pointer is DEAD, which is
 * the drift that actually misleads a reader, and the only kind a machine can catch
 * with certainty. Wrong prose stays the author's responsibility; this exists so the
 * cheap half is never the thing that rots.
 *
 * Runs in milliseconds. Wired into `npm run validate` and into the PostToolUse hook.
 *
 * Usage:
 *   npm run check-docs
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT_DOC = 'CLAUDE.md';

// `data` is deliberately absent: the repo-root `data/` holds databases, but
// `frontend/lib/data/` is a source directory and skipping it hides real files.
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.next-qa', 'dist', 'build', 'out', 'test-results']);

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|yaml|yml|css|sql)$/;
const PATH_LIKE = /^[\w./@[\]-]+$/;

const exists = (p: string): boolean => {
  if (!existsSync(p)) return false;
  try { statSync(p); return true; } catch { return false; }
};

/**
 * A gitignored path is absent from a clean checkout BY DESIGN — `frontend/.env` is
 * created by the developer, exists on every working machine, and never in CI. Failing
 * on it would mean documentation could not describe setup, which is exactly the kind of
 * false alarm that gets a check deleted.
 */
function isGitIgnored(relPath: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', relPath], { cwd: REPO_ROOT, stdio: 'ignore' });
    return true; // exit 0 = ignored
  } catch {
    return false; // exit 1 = not ignored; any other failure is treated the same, conservatively
  }
}

/** An extensionless import may name a file, a directory, or a directory/index.ts. */
function existsAsModule(base: string): boolean {
  if (exists(base)) return true;
  return ['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx'].some((s) => exists(base + s));
}

function walk(dir: string, keep: (name: string) => boolean, out: string[] = [], depth = 0): string[] {
  if (depth > 10) return out;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walk(join(dir, e.name), keep, out, depth + 1);
    } else if (keep(e.name)) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

function existsSomewhereUnder(dir: string, filename: string, depth = 0): boolean {
  if (depth > 8) return false;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (e.isFile() && e.name === filename) return true;
    // `.github` holds real, frequently-referenced files (CI workflows); other dot-dirs do not.
    if (e.isDirectory() && !SKIP_DIRS.has(e.name) && (!e.name.startsWith('.') || e.name === '.github')) {
      if (existsSomewhereUnder(join(dir, e.name), filename, depth + 1)) return true;
    }
  }
  return false;
}

// ── Sweep 1: paths claimed by ANY CLAUDE.md ──────────────────────────────────
// The project doc is no longer one file: the root carries orientation and the
// development rules, and each deep module carries its own. All of them are
// auto-loaded, so all of them can lie — checking only the root would leave the
// module docs, which are the ones a developer reads while editing, unguarded.
const failures: string[] = [];
let pathsChecked = 0;

const rootDocPath = join(REPO_ROOT, ROOT_DOC);
if (!exists(rootDocPath)) {
  console.error(`check-docs: ${ROOT_DOC} not found at the repo root.`);
  process.exit(1);
}

/** Every CLAUDE.md in the tree, repo-relative. */
function findClaudeDocs(dir: string, out: string[] = []): string[] {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || (e.name.startsWith('.') && e.name !== '.github')) continue;
      findClaudeDocs(full, out);
    } else if (e.name === ROOT_DOC) {
      out.push(full.slice(REPO_ROOT.length + 1));
    }
  }
  return out;
}

const CLAUDE_DOCS = findClaudeDocs(REPO_ROOT);

for (const relDoc of CLAUDE_DOCS) {
checkDoc(relDoc, readFileSync(join(REPO_ROOT, relDoc), 'utf8'));
}

function checkDoc(PROJECT_DOC: string, doc: string): void {
let inFence = false;

doc.split('\n').forEach((line, i) => {
  if (line.trimStart().startsWith('```')) { inFence = !inFence; return; }
  if (inFence) return; // fenced blocks are examples, not pointers

  for (const [, token] of line.matchAll(/`([^`]+)`/g)) {
    const t = token.trim();
    if (!PATH_LIKE.test(t)) continue;
    if (t.includes('*')) continue;                            // globs can't be checked literally
    if (t.startsWith('/') || t.startsWith('.')) continue;     // URLs, virtual paths, bare suffixes
    if (/^[A-Z][A-Za-z0-9]*\.json$/.test(t)) continue;        // `NextResponse.json` is a call
    if (t.startsWith('@') && !t.startsWith('@/')) continue;   // npm specifier

    // Only judge tokens that are unambiguously PATH-SHAPED. Prose is full of
    // slash-separated things that are not paths — MIME types (`application/x-ndjson`),
    // weight tuples (`0.3/0.3/0.4`), symbol groups (`CACHE_TTL.FILE/FOLDER/QUERY`),
    // recipe ids (`minusx/trend@1`), npm subpaths (`next/og`). Flagging those buries
    // the real finding, and a checker nobody trusts is a checker nobody runs.
    const isRepoRooted = /^(frontend|docs|scripts|assets|data|\.github)\//.test(t);
    const hasSourceExt = SOURCE_EXT.test(t);
    const isAlias = t.startsWith('@/');
    if (!isRepoRooted && !hasSourceExt && !isAlias) continue;
    if (/@[\w.-]+$/.test(t)) continue;                        // versioned id, e.g. minusx/trend@1

    const cleaned = t.replace(/\/$/, '');
    const alias = cleaned.startsWith('@/') ? join('frontend', cleaned.slice(2)) : null;
    pathsChecked++;

    if (alias) {
      if (!existsAsModule(join(REPO_ROOT, alias))) failures.push(`${PROJECT_DOC}:${i + 1}  dead path: \`${t}\``);
      continue;
    }
    const direct = [REPO_ROOT, join(REPO_ROOT, 'frontend')].some((b) => existsAsModule(join(b, cleaned)));
    if (direct) continue;

    const basename = cleaned.split('/').pop()!;
    if (existsSomewhereUnder(join(REPO_ROOT, 'frontend'), basename)) continue;
    if (existsSomewhereUnder(REPO_ROOT, basename)) continue;
    if (isGitIgnored(cleaned)) continue; // developer-created (e.g. `frontend/.env`) — absent by design
    failures.push(`${PROJECT_DOC}:${i + 1}  dead path: \`${t}\``);
  }
});
}

// ── Sweep 2: source comments pointing at a doc that no longer exists ─────────
// A backticked mention may contain spaces; a bare one may not, or the pattern
// swallows whole sentences ending in a filename.
const MD_BACKTICKED = /`([A-Za-z0-9_][A-Za-z0-9_ ,&./-]*\.mdx?)`/g;
const MD_BARE = /(?:^|[\s'"(\[])([A-Za-z0-9_][A-Za-z0-9_./-]*\.mdx?)\b/g;

const orphaned: string[] = [];
let mentionsChecked = 0;

const sourceFiles = walk(REPO_ROOT, (n) => /\.(ts|tsx|js|jsx|mjs|cjs|css|mdx|md)$/.test(n));
for (const file of sourceFiles) {
  const rel = file.slice(REPO_ROOT.length + 1);
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  if (!text.includes('.md')) continue;

  text.split('\n').forEach((line, i) => {
    if (line.includes('http')) return; // links are the docs site's business
    const seen = new Set<string>();
    for (const re of [MD_BACKTICKED, MD_BARE]) {
      for (const [, name] of line.matchAll(re)) {
        const cleaned = name.trim();
        if (seen.has(cleaned)) continue;
        seen.add(cleaned);
        mentionsChecked++;
        const base = cleaned.split('/').pop()!;
        if (exists(join(dirname(file), cleaned)) || exists(join(REPO_ROOT, cleaned))) continue;
        if (existsSomewhereUnder(REPO_ROOT, base)) continue;
        orphaned.push(`${rel}:${i + 1}  references missing doc: ${cleaned}`);
      }
    }
  });
}

// ── Sweep 3: no module doc is an orphan ─────────────────────────────────────
// A nested CLAUDE.md only auto-loads for work inside its own directory. If the
// root does not link it, someone reading top-down never learns it exists — the
// doc is then invisible in exactly the situation it was written for.
const unlinked: string[] = [];
const rootText = readFileSync(rootDocPath, 'utf8');
for (const relDoc of CLAUDE_DOCS) {
  if (relDoc === ROOT_DOC) continue;
  // A POINTER STUB is exempt. It exists only to redirect a reader to the doc that
  // covers its directory, and that target is itself linked from the root — so
  // requiring 25 redirect files in the root map would bloat the one file whose
  // whole point is being small. Recognised structurally, not by filename.
  const body = readFileSync(join(REPO_ROOT, relDoc), 'utf8');
  const isStub = /Documented in \*\*`[^`]+`\*\*/.test(body) && body.split('\n').length <= 15;
  if (isStub) {
    const target = body.match(/Documented in \*\*`([^`]+)`\*\*/)![1];
    if (!exists(join(REPO_ROOT, target))) {
      unlinked.push(`${relDoc} redirects to ${target}, which does not exist`);
    }
    continue;
  }
  // A real doc must name the DOC in the root, not merely the directory. Accepting a
  // directory mention makes this vacuous: every module directory is already in the
  // module map. (Verified by planting an unlinked doc under a mapped directory —
  // the looser check passed it.)
  if (rootText.includes(relDoc)) continue;
  unlinked.push(`${relDoc} is not referenced from ${ROOT_DOC}`);
}

if (failures.length || orphaned.length || unlinked.length) {
  if (failures.length) {
    console.error(`\ncheck-docs: ${failures.length} dead path(s) across ${CLAUDE_DOCS.length} CLAUDE.md file(s):\n`);
    for (const f of failures) console.error(`  ${f}`);
    console.error('\nFix the path, or delete the pointer. Documentation that lies is worse than none.');
  }
  if (orphaned.length) {
    console.error(`\ncheck-docs: ${orphaned.length} comment(s) reference a doc that does not exist:\n`);
    for (const o of orphaned) console.error(`  ${o}`);
    console.error(`\nRepoint at the nearest ${ROOT_DOC}, or drop the reference.`);
  }
  if (unlinked.length) {
    console.error(`\ncheck-docs: ${unlinked.length} module doc(s) unreachable from the root:\n`);
    for (const u of unlinked) console.error(`  ${u}`);
    console.error(`\nAdd a pointer in ${ROOT_DOC} so a top-down reader can find it.`);
  }
  console.error('');
  process.exit(1);
}

console.log(
  `check-docs: ${pathsChecked} path(s) across ${CLAUDE_DOCS.length} CLAUDE.md file(s) and `
  + `${mentionsChecked} doc mention(s) in source — all resolve.`,
);
