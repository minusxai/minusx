/** Admission-marker controls only; these fixtures do not assert native success. */
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const checker = join(dirname(fileURLToPath(import.meta.url)), 'check-transaction-status.mjs');
const names = ['libmount1', 'login', 'mount', 'util-linux'];
const statusHash = createHash('sha256').update('before').digest('hex');
function records() {
  const transport = (kind, status) => ({kind, status, source_compiled: false, native_qualified: false, exit_code: 0});
  const hashes = Object.fromEntries(names.map(name => [name, 'a'.repeat(64)]));
  const directoryPolicy = {kind: 'util-new-provenance-directory-policy', dpkg_policy_sha256: 'd'.repeat(64),
    paths: {'/usr/share/doc/libmount1/runtime-security': {kind: 'directory', mode: 0o755, uid: 0, gid: 0}}};
  const directoryHash = createHash('sha256').update(JSON.stringify(directoryPolicy)).digest('hex');
  return {
    'prepare-status.json': transport('util-target-prepare-transport', 'prepared-unadmitted'),
    'preparation.json': {kind: 'util-target-preparation', status: 'prepared-unadmitted', source_compiled: false, native_qualified: false, final_manifest_sha256: 'b'.repeat(64), provenance_directories_sha256: directoryHash},
    'transaction-status.json': transport('util-target-transaction-transport', 'transaction-unadmitted'),
    'plan.json': {kind: 'util-four-package-review-candidate', architecture: 'amd64', status_sha256: statusHash, packages: Object.fromEntries(names.map(name => [name, {sha256: hashes[name]}]))},
    'dependency-closure.json': {kind: 'util-data-only-closure', status: 'closure-only-unadmitted', native_qualified: false, candidate_names: names, new_package_names: [], checked_installed_packages: 100, baseline_sha256: statusHash, candidate_deb_sha256: hashes},
    'apt-plan.json': {install_names: names, kind: 'util-exact-apt-plan', native_qualified: false, new_names: [], removals: [], status: 'simulation-only-unadmitted'},
    'final-native.json': {kind: 'util-final-native-state', status: 'native-gates-passed-unadmitted', candidate_names: names, overlay_archive_receipts: {}, actual_runtime_loader_checks: 2, checked_paths: 20, whole_status_package_count: 100, manifest_sha256: 'b'.repeat(64)},
    'apt-cache-priming.json': {kind: 'util-local-apt-cache-priming', status: 'cache-only-unadmitted', native_qualified: false, network_fetches: 0, packages: Object.fromEntries(names.map(name => [name, {sha256: hashes[name]}]))},
    'control-observation.json': {kind: 'util-selected-control-observation', status: 'diagnostic-only-unadmitted', native_qualified: false, packages: Object.fromEntries(names.map(name => [name, {}]))},
    'provenance-directories.json': directoryPolicy,
    'provenance-directory-check.json': {kind: 'util-new-provenance-directory-check', status: 'policy-checked-unadmitted', native_qualified: false, policy_sha256: directoryPolicy.dpkg_policy_sha256, directories: {'/usr/share/doc/libmount1/runtime-security': {state: 'present', ...directoryPolicy.paths['/usr/share/doc/libmount1/runtime-security']}}}
  };
}
function exercise(mutate, expected) {
  const root = mkdtempSync(join(tmpdir(), 'utility-marker-controls-'));
  try {
    const data = records();
    mutate(data);
    for (const [name, value] of Object.entries(data)) if (value !== null) writeFileSync(join(root, name), JSON.stringify(value));
    for (const name of ['apt-simulation.stderr', 'dpkg-audit.stdout', 'dpkg-audit.stderr']) writeFileSync(join(root, name), '');
    writeFileSync(join(root, 'before-status'), 'before');
    writeFileSync(join(root, 'after-status'), 'after');
    const result = spawnSync(process.execPath, [checker, root], {encoding: 'utf8'});
    assert.equal(result.status === 0, expected, result.stderr);
  } finally { rmSync(root, {recursive: true, force: true}); }
}
exercise(() => {}, true);
const negatives = [
  r => { r['prepare-status.json'].exit_code = false; },
  r => { r['prepare-status.json'].exit_code = 1; },
  r => { r['prepare-status.json'] = null; },
  r => { r['transaction-status.json'].exit_code = false; },
  r => { r['transaction-status.json'].exit_code = '0'; },
  r => { r['transaction-status.json'].exit_code = 1; },
  r => { r['transaction-status.json'].native_qualified = true; },
  r => { r['transaction-status.json'].source_compiled = true; },
  r => { r['transaction-status.json'].extra = 0; },
  r => { r['final-native.json'] = null; },
  r => { r['final-native.json'].actual_runtime_loader_checks = true; },
  r => { r['final-native.json'].manifest_sha256 = 'c'.repeat(64); },
  r => { r['dependency-closure.json'].candidate_names = names.slice(1); },
  r => { r['dependency-closure.json'].baseline_sha256 = '0'.repeat(64); },
  r => { r['apt-plan.json'].new_names = ['unexpected']; },
  r => { r['apt-cache-priming.json'].network_fetches = 1; },
  r => { r['control-observation.json'].packages = {}; },
  r => { r['provenance-directory-check.json'] = null; },
  r => { r['provenance-directory-check.json'].directories = {}; },
  r => { r['provenance-directory-check.json'].policy_sha256 = '0'.repeat(64); },
  r => { r['provenance-directory-check.json'].directories['/usr/share/doc/libmount1/runtime-security'].kind = 'symlink'; },
  r => { r['preparation.json'].provenance_directories_sha256 = '0'.repeat(64); }
];
for (const mutate of negatives) exercise(mutate, false);
console.log(JSON.stringify({kind: 'utility-typed-transport-controls', status: 'marker-controls-only-unadmitted', positive: 1, negative_controls: negatives.length}, null, 2));
