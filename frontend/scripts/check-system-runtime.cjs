const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
assert.equal(execFileSync('grep', ['-P', '^native[0-9]+$'], { input: 'native42\n', encoding: 'utf8' }).trim(), 'native42');
execFileSync('dash', ['-c', 'set -eu; value=alpha; case "$value" in a*[!0-9]) ;; *) exit 1;; esac; f() { printf "%s" "$1"; }; test "$(f quoted)" = quoted; test "$(printf "%s\\n" pipeline | sed s/line//)" = pipe'], { timeout: 5000 });
assert.equal(execFileSync('dash', ['-c', String.raw`printf '\u20ac'`], { encoding: 'utf8' }), String.raw`\u20ac`);
execFileSync('dash', ['-c', 'value=$(printf "%050000d" 0 | tr 0 .); case "$value" in *.*.*.*.*.tar.gz) exit 1;; *) printf "libc matcher stress passed\\n";; esac'], { timeout: 5000 });
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-check-'));
try {
  fs.mkdirSync(path.join(directory, 'source'));
  fs.mkdirSync(path.join(directory, 'target'));
  fs.writeFileSync(path.join(directory, 'source', 'value.txt'), 'archive roundtrip\n');
  fs.writeFileSync(path.join(directory, 'source', 'another.txt'), 'glob fixture');
  execFileSync('dash', ['-c', 'set -- *.txt; test "$#" = 2'], { cwd: path.join(directory, 'source'), timeout: 5000 });
  execFileSync('tar', ['-cf', path.join(directory, 'value.tar'), '-C', path.join(directory, 'source'), 'value.txt']);
  execFileSync('tar', ['-xf', path.join(directory, 'value.tar'), '-C', path.join(directory, 'target')]);
  assert.equal(fs.readFileSync(path.join(directory, 'target', 'value.txt'), 'utf8'), 'archive roundtrip\n');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

const utilityEnv = { ...process.env, LC_ALL: 'C.UTF-8', _POSIX2_VERSION: '200809' };
for (const args of [['+0.18446744073709551615R'], ['+1', '-1.18446744073709551615R']]) {
  assert.equal(execFileSync('sort', args, { input: 'aa\nbb\n', encoding: 'utf8', env: utilityEnv, timeout: 5000 }), 'aa\nbb\n');
}
const wideLine = '😀' + 'A'.repeat(255) + '\n';
assert.equal(execFileSync('uniq', ['-w256'], { input: wideLine.repeat(2), encoding: 'utf8', env: utilityEnv, timeout: 5000 }), wideLine);
const terminalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-check-'));
try {
  const source = path.join(terminalDirectory, 'fixture.src');
  const database = path.join(terminalDirectory, 'db');
  fs.writeFileSync(source, 'runtimefixture|bounded terminal fixture,\n cols#80, lines#24, clear=\\E[H\\E[2J, is1=x, is2=' + 'A'.repeat(20000) + ',\n');
  execFileSync('tic', ['-x', '-T', '-o', database, source], { timeout: 5000 });
  const env = { ...process.env, TERMINFO: database, TERM: 'runtimefixture' };
  assert.match(execFileSync('infocmp', ['-i', 'runtimefixture'], { env, encoding: 'utf8', timeout: 5000 }), /runtimefixture/);
  assert.equal(execFileSync('tput', ['cols'], { env, encoding: 'utf8', timeout: 5000 }).trim(), '80');
} finally {
  fs.rmSync(terminalDirectory, { recursive: true, force: true });
}
console.log('System regex, archive, shell, sort/uniq, and terminal runtime checks passed');
