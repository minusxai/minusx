const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function assertSessionDisabled(options) {
  assert.ok(options.length, 'SQLite compile diagnostics must be available');
  for (const option of options) {
    assert.doesNotMatch(option, /^ENABLE_(SESSION|PREUPDATE_HOOK)(=|$)/,
      'Session-specific applicability requires these existing features to remain absent');
  }
}

function checkEmbeddedSqlite(database) {
  const version = database.prepare('select sqlite_version() as version').get().version;
  const sourceId = database.prepare('select sqlite_source_id() as source_id').get().source_id;
  const options = database.pragma('compile_options').map(row => row.compile_options).sort();
  assertSessionDisabled(options);
  const loaded = Object.keys(require.cache).filter(filename => filename.endsWith('/better_sqlite3.node'));
  assert.equal(loaded.length, 1, 'Identify the actual loaded native module');
  const relativeModule = path.relative(process.cwd(), loaded[0]);
  assert.equal(relativeModule, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node');
  const source = fs.readFileSync(path.join(path.dirname(require.resolve('better-sqlite3/package.json')), 'deps/sqlite3/sqlite3.c'));
  const text = source.toString('utf8');
  assert.equal(text.match(/^#define SQLITE_VERSION\s+"([^"]+)"/m)?.[1], version);
  const opening = '#if defined(SQLITE_ENABLE_SESSION) && defined(SQLITE_ENABLE_PREUPDATE_HOOK)';
  const closing = '#endif /* SQLITE_ENABLE_SESSION && SQLITE_ENABLE_PREUPDATE_HOOK */';
  const start = text.indexOf(opening);
  const end = text.indexOf(closing, start);
  assert.ok(start >= 0 && end > start, 'Session implementation conditional guard must exist');
  const guarded = text.slice(start, end);
  for (const name of ['sqlite3session_create', 'sqlite3changeset_apply_v2', 'sqlite3changeset_concat']) {
    assert.ok(guarded.includes(name), name);
  }
  const proof = {
    platform: process.platform, architecture: process.arch, module_relative_path: relativeModule,
    module_sha256: crypto.createHash('sha256').update(fs.readFileSync(loaded[0])).digest('hex'),
    sqlite_version: version, sqlite_source_id: sourceId, compile_options: options,
    amalgamation_sha256: crypto.createHash('sha256').update(source).digest('hex'),
    session_conditional_guard: opening,
    applicability_only: ['CVE-2026-50812', 'CVE-2026-50813'],
    limit: 'Absent session/preupdate implementation is a narrow component finding, not general SQLite clearance; defined-symbol verification is separate.',
  };
  if (process.env.NATIVE_PROOF_DIR) {
    fs.mkdirSync(process.env.NATIVE_PROOF_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.NATIVE_PROOF_DIR, 'embedded-sqlite.json'), JSON.stringify(proof, null, 2) + '\n');
  }
  console.log('Loaded embedded SQLite ' + version + ': SESSION/PREUPDATE_HOOK absent; module/source hash receipt recorded when requested');
  return proof;
}

module.exports = { assertSessionDisabled, checkEmbeddedSqlite };
