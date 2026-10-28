const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertSessionDisabled } = require('./check-embedded-sqlite.cjs');

test('nonempty diagnostics with unrelated features preserve this narrow absence finding', () => {
  assert.doesNotThrow(() => assertSessionDisabled(['THREADSAFE=1', 'ENABLE_FTS5']));
});
test('enabling either session prerequisite fails the narrow applicability gate', () => {
  for (const flag of ['ENABLE_SESSION', 'ENABLE_PREUPDATE_HOOK', 'ENABLE_SESSION=1']) {
    assert.throws(() => assertSessionDisabled(['THREADSAFE=1', flag]));
  }
  assert.throws(() => assertSessionDisabled([]));
});
