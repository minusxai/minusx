#!/usr/bin/env tsx
/**
 * Assert that documentation still points at code that exists.
 *
 * Four sweeps, all mechanical:
 *   1. Every file path referenced in ANY `CLAUDE.md` resolves to a real file or directory.
 *   2. No source comment references a `*.md` file that no longer exists.
 *   3. Every nested `CLAUDE.md` is reachable from the root one.
 *   4. No tracked `.md` exists outside the allowlist — i.e. no plan documents.
 *
 * Sweep 3 exists because a nested doc only auto-loads for work inside its own
 * directory. An unlinked module doc is invisible to anyone reading top-down —
 * present, correct, and never found.
 *
 * Sweep 4 enforces the root rule that docs describe the code as it is today. A plan
 * ("Phase 3", "not in scope (v1)") is stale the moment the work lands, and sweep 1
 * cannot help: it only reads `CLAUDE.md`, so a plan file anywhere else rots with no
 * signal at all. This is a NAME allowlist rather than a grep for plan-shaped prose,
 * because the failure is the file existing, not how it is written — a plan titled
 * "Notes" with no phase headings is the same problem. Plans belong outside the repo.
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
 *   npm run check-docs -- --hook   # PostToolUse mode, see below
 *
 * `--hook` exists because of how Claude Code delivers PostToolUse output: on exit 0,
 * plain stdout goes only to the debug log — the model never sees it. The ONLY way to
 * put text in front of the model from a successful hook is JSON with
 * `hookSpecificOutput.additionalContext` (max 10k chars). So in hook mode this script
 * always exits 0 and emits that JSON, carrying any failures plus the standing reminder
 * that path-existence is the only thing checked mechanically — prose truth is the
 * author's job. A bare `echo` in the hook command would be silently discarded.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT_DOC = 'CLAUDE.md';
/** This file, repo-relative — excluded from the source sweep below. */
const SELF = 'frontend/scripts/check-docs-consistency.ts';

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
  // This checker names doc filenames as PATTERNS, not pointers — `claude.md` and `readme.md` are
  // the allowlist sweep 4 matches against, lowercased. Scanning them here reports the checker to
  // itself, and only on a case-sensitive filesystem, so it passes locally on macOS and fails in CI.
  if (rel === SELF) continue;
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


// ── Sweep 4: no plan documents ───────────────────────────────────────────────
// The only markdown this repo keeps is the doc tree itself plus the root README;
// `docs/` is the published site and is .mdx today, allowed here so a legitimate page
// added later does not trip the gate. Case-insensitive, because a case-insensitive
// filesystem would otherwise let `Claude.md` through as a non-doc.
const stray: string[] = [];
const trackedMarkdown = execFileSync('git', ['ls-files', '-z', '*.md', '*.MD', '*.Md', '*.mD'], {
  cwd: REPO_ROOT, encoding: 'utf8',
}).split('\0').filter(Boolean);

for (const rel of trackedMarkdown) {
  const lower = rel.toLowerCase();
  const base = lower.split('/').pop()!;
  if (base === 'claude.md') continue;          // a module doc, any depth
  if (lower === 'readme.md') continue;         // the root README only
  if (lower.startsWith('docs/')) continue;     // the published site
  stray.push(rel);
}

const HOOK_MODE = process.argv.includes('--hook');
const report: string[] = [];

if (failures.length || orphaned.length || unlinked.length || stray.length) {
  if (failures.length) {
    report.push(`\ncheck-docs: ${failures.length} dead path(s) across ${CLAUDE_DOCS.length} CLAUDE.md file(s):\n`);
    for (const f of failures) report.push(`  ${f}`);
    report.push('\nFix the path, or delete the pointer. Documentation that lies is worse than none.');
  }
  if (orphaned.length) {
    report.push(`\ncheck-docs: ${orphaned.length} comment(s) reference a doc that does not exist:\n`);
    for (const o of orphaned) report.push(`  ${o}`);
    report.push(`\nRepoint at the nearest ${ROOT_DOC}, or drop the reference.`);
  }
  if (unlinked.length) {
    report.push(`\ncheck-docs: ${unlinked.length} module doc(s) unreachable from the root:\n`);
    for (const u of unlinked) report.push(`  ${u}`);
    report.push(`\nAdd a pointer in ${ROOT_DOC} so a top-down reader can find it.`);
  }
  if (stray.length) {
    report.push(`\ncheck-docs: ${stray.length} markdown file(s) outside the doc tree:\n`);
    for (const t of stray) report.push(`  ${t}`);
    report.push(
      '\nOnly CLAUDE.md, the root README.md and docs/** are tracked as markdown. A plan or'
      + '\ndesign note is stale the day the work lands — keep it outside the repo, or fold what'
      + '\nstays true into the nearest CLAUDE.md.',
    );
  }
  if (!HOOK_MODE) {
    for (const line of report) console.error(line);
    console.error('');
    process.exit(1);
  }
}

// The standing reminder for the editing agent: the sweeps above prove pointers are
// ALIVE, never that prose is TRUE. Delivered on every hook run, pass or fail.
const REMINDER =
  'Docs consistency: the mechanical check only proves that referenced paths still EXIST. It '
  + 'cannot tell you whether the prose is still TRUE. If this edit changed behaviour, re-read '
  + '(a) the comments in the file you edited, (b) the section of CLAUDE.md describing this '
  + 'module, and (c) any docs/content/** page describing this behaviour — and update them in '
  + 'this change, not later. Docs describe the code AS IT IS TODAY: no plan narrative, no '
  + 'migration history, no changelog, no phase numbers — that is what git is for.';

if (HOOK_MODE) {
  // additionalContext is capped at 10k chars; keep the reminder whole and truncate the
  // failure report, not the other way round — a truncated reminder reads as noise.
  const budget = 10_000 - REMINDER.length - 100;
  let failureText = report.join('\n');
  if (failureText.length > budget) failureText = `${failureText.slice(0, budget)}\n  … (truncated)`;
  const context = failureText
    ? `${failureText.trim()}\n\nFix these in this change.\n\n${REMINDER}`
    : REMINDER;
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context },
  }));
  process.exit(0);
}

console.log(
  `check-docs: ${pathsChecked} path(s) across ${CLAUDE_DOCS.length} CLAUDE.md file(s) and `
  + `${mentionsChecked} doc mention(s) in source — all resolve.`,
);
