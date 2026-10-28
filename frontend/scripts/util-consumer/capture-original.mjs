/** Capture target identity only. This file never admits or installs a candidate. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const selected = ['libmount1', 'util-linux', 'login', 'mount'];
const providers = ['libblkid1', 'liblastlog2-2', 'libsmartcols1', 'libuuid1'];
const env = { ...process.env, PATH: '/usr/bin:/bin', LC_ALL: 'C' };
for (const key of Object.keys(env)) {
  if (/^(?:LD_|DYLD_|PERL|PYTHON)/.test(key) || key === 'GLIBC_TUNABLES') delete env[key];
}
function run(command, args) {
  const result = spawnSync(command, args, { env, encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  return result.stdout;
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function metadata(path) {
  const info = lstatSync(path);
  const value = { mode: info.mode & 0o7777, uid: info.uid, gid: info.gid };
  if (info.isSymbolicLink()) return { ...value, kind: 'link', target: readlinkSync(path) };
  if (info.isDirectory()) return { ...value, kind: 'directory' };
  assert(info.isFile(), `Unsupported original path: ${path}`);
  return { ...value, kind: 'file', size: info.size, sha256: sha(readFileSync(path)) };
}
assert.equal(process.argv.length, 3);
const out = resolve(process.argv[2]);
// Nonrecursive mkdir rejects every existing entry, including dangling symlinks.
mkdirSync(out);
const rawStatus = readFileSync('/var/lib/dpkg/status');
writeFileSync(join(out, 'raw-status'), rawStatus);
// Package names may themselves contain dots (for example login.defs). Resolve
// their complete known installed prefix before treating a suffix as a control.
const installedPrefixes = new Set();
for (const paragraph of rawStatus.toString('utf8').split('\n\n')) {
  if (!/^Status: install ok installed$/m.test(paragraph)) continue;
  const name = paragraph.match(/^Package: ([a-z0-9][a-z0-9+.-]*)$/m)?.[1];
  const architecture = paragraph.match(/^Architecture: ([a-z0-9][a-z0-9-]*)$/m)?.[1];
  assert(name && architecture, 'Invalid installed package identity');
  installedPrefixes.add(name);
  installedPrefixes.add(`${name}:${architecture}`);
}
const knownPrefixes = [...installedPrefixes].sort((a, b) => b.length - a.length);
const owner = entry => knownPrefixes.find(prefix => entry.startsWith(`${prefix}.`));
const allowedControls = new Set(['list', 'conffiles', 'config', 'md5sums', 'postinst',
  'postrm', 'preinst', 'prerm', 'shlibs', 'symbols', 'templates', 'triggers']);
const policy = '/etc/dpkg/dpkg.cfg.d/docker';
const policyPresent = existsSync(policy);
if (policyPresent) copyFileSync(policy, join(out, 'dpkg-docker.cfg'));
const lintianExcluded = policyPresent && readFileSync(policy, 'utf8').split('\n').includes('path-exclude /usr/share/lintian/overrides/*');
const packages = {};
for (const name of [...selected, ...providers]) {
  const directory = join(out, name);
  mkdirSync(directory);
  const status = run('dpkg-query', ['-s', name]);
  assert.match(status, /^Status: install ok installed$/m);
  assert.match(status, /^Architecture: amd64$/m);
  const version = status.match(/^Version: (.+)$/m)?.[1];
  const expected = name === 'login' ? '1:4.16.0-2+really2.41.5-0+deb13u1' : '2.41.5-0+deb13u1';
  assert.equal(version, expected, `Original version changed: ${name}`);
  writeFileSync(join(directory, 'status'), status);
  const listing = run('dpkg-query', ['-L', name]);
  writeFileSync(join(directory, 'paths'), listing);
  const paths = listing.trimEnd().split('\n');
  assert.equal(paths.length, new Set(paths).size);
  const present = [], absent = [], files = {};
  for (const path of paths) {
    assert(path.startsWith('/') && !path.split('/').includes('..'));
    let info;
    try { info = lstatSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (info) { present.push(path); files[path] = metadata(path); continue; }
    assert(/^\/usr\/share\/(?:doc|man)(?:\/|$)/.test(path) ||
      (lintianExcluded && /^\/usr\/share\/lintian(?:\/overrides(?:\/.*)?)?$/.test(path)),
    `Missing original runtime/configuration path: ${path}`);
    absent.push(path);
  }
  writeFileSync(join(directory, 'present-paths'), present.join('\n') + '\n');
  writeFileSync(join(directory, 'absent-documentation'), absent.length ? absent.join('\n') + '\n' : '');
  run('tar', ['--no-recursion', '--absolute-names', '--numeric-owner', '-cpf', join(directory, 'payload.tar'),
    '--verbatim-files-from', '--files-from', join(directory, 'present-paths')]);
  // Include internal .list/.conffiles and reject stale alternate multiarch prefixes.
  const anchor = run('dpkg-query', ['--control-path', name, 'md5sums']).trim();
  assert(anchor.startsWith('/var/lib/dpkg/info/') && anchor.endsWith('.md5sums'));
  const prefix = basename(anchor).slice(0, -'.md5sums'.length);
  assert([name, `${name}:amd64`].includes(prefix));
  const alternate = prefix === name ? `${name}:amd64` : name;
  const controls = {};
  mkdirSync(join(directory, 'controls'));
  for (const entry of readdirSync('/var/lib/dpkg/info').sort()) {
    const owningPrefix = owner(entry);
    if (owningPrefix !== prefix && owningPrefix !== alternate) continue;
    assert(!entry.startsWith(`${alternate}.`), `Stale package info: ${entry}`);
    assert.equal(owningPrefix, prefix);
    const source = join('/var/lib/dpkg/info', entry);
    const item = metadata(source);
    assert.equal(item.kind, 'file');
    const label = entry.slice(prefix.length + 1);
    assert(allowedControls.has(label), `Unknown stored package control: ${entry}`);
    copyFileSync(source, join(directory, 'controls', label));
    controls[label] = item;
  }
  assert(controls.md5sums && controls.list);
  packages[name] = { version, status_sha256: sha(Buffer.from(status)), stored_prefix: prefix,
    files, controls, absent_paths: absent, payload_archive_sha256: sha(readFileSync(join(directory, 'payload.tar'))) };
}
assert.deepEqual(readFileSync('/var/lib/dpkg/status'), rawStatus, 'Package state changed during capture');
writeFileSync(join(out, 'profile.json'), JSON.stringify({ kind: 'util-consumer-original-capture',
  status: 'capture-only-unadmitted', selected_packages: selected, unchanged_provider_packages: providers,
  raw_status_sha256: sha(rawStatus), dpkg_policy: policyPresent ? metadata(policy) : null, packages }, null, 2) + '\n');
