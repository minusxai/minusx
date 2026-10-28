/** Typed gate: transport success alone cannot enable application consumption. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
assert(process.argv.length >= 3 && process.argv.length <= 4);
const [root, phase = 'transaction'] = process.argv.slice(2);
assert(root && ['prepare', 'transaction'].includes(phase));
const read = name => JSON.parse(readFileSync(join(root, name), 'utf8'));
const transport = (record, kind, status) => {
  assert.deepEqual(Object.keys(record).sort(), ['kind', 'status', 'source_compiled', 'native_qualified', 'exit_code'].sort());
  assert.equal(record.kind, kind);
  assert.equal(record.status, status);
  assert.equal(record.source_compiled, false);
  assert.equal(record.native_qualified, false);
  assert.equal(typeof record.exit_code, 'number');
  assert(Number.isInteger(record.exit_code) && record.exit_code === 0);
};
transport(read('prepare-status.json'), 'util-target-prepare-transport', 'prepared-unadmitted');
const preparation = read('preparation.json');
assert.equal(preparation.kind, 'util-target-preparation');
assert.equal(preparation.status, 'prepared-unadmitted');
assert.equal(preparation.source_compiled, false);
assert.equal(preparation.native_qualified, false);
if (phase === 'transaction') {
  transport(read('transaction-status.json'), 'util-target-transaction-transport', 'transaction-unadmitted');
  const names = ['libmount1', 'login', 'mount', 'util-linux'];
  const packagePlan = read('plan.json');
  assert.equal(packagePlan.kind, 'util-four-package-review-candidate');
  assert.equal(packagePlan.architecture, 'amd64');
  assert.deepEqual(Object.keys(packagePlan.packages).sort(), names);
  const closure = read('dependency-closure.json');
  assert.equal(closure.kind, 'util-data-only-closure');
  assert.equal(closure.status, 'closure-only-unadmitted');
  assert.equal(closure.native_qualified, false);
  assert.deepEqual(closure.candidate_names, names);
  assert.deepEqual(closure.new_package_names, []);
  assert.equal(closure.baseline_sha256, packagePlan.status_sha256);
  assert.equal(createHash('sha256').update(readFileSync(join(root, 'before-status'))).digest('hex'), packagePlan.status_sha256);
  assert.deepEqual(closure.candidate_deb_sha256, Object.fromEntries(names.map(name => [name, packagePlan.packages[name].sha256])));
  assert(typeof closure.checked_installed_packages === 'number' && Number.isInteger(closure.checked_installed_packages) && closure.checked_installed_packages > names.length);
  const plan = read('apt-plan.json');
  assert.deepEqual(plan, {install_names: names, kind: 'util-exact-apt-plan', native_qualified: false,
    new_names: [], removals: [], status: 'simulation-only-unadmitted'});
  const final = read('final-native.json');
  assert.equal(final.kind, 'util-final-native-state');
  assert.equal(final.status, 'native-gates-passed-unadmitted');
  assert.deepEqual(final.candidate_names, names);
  assert.deepEqual(final.overlay_archive_receipts, {});
  assert(Number.isInteger(final.actual_runtime_loader_checks) && final.actual_runtime_loader_checks > 0);
  assert(Number.isInteger(final.checked_paths) && final.checked_paths > 0);
  assert.equal(final.whole_status_package_count, closure.checked_installed_packages);
  assert.equal(final.manifest_sha256, preparation.final_manifest_sha256);
  assert(readFileSync(join(root, 'after-status')).length > 0);
  const cache = read('apt-cache-priming.json');
  assert.equal(cache.kind, 'util-local-apt-cache-priming');
  assert.equal(cache.status, 'cache-only-unadmitted');
  assert.equal(cache.native_qualified, false);
  assert.equal(cache.network_fetches, 0);
  assert.deepEqual(Object.keys(cache.packages).sort(), names);
  for (const name of names) assert.equal(cache.packages[name].sha256, packagePlan.packages[name].sha256);
  const controls = read('control-observation.json');
  assert.equal(controls.kind, 'util-selected-control-observation');
  assert.equal(controls.status, 'diagnostic-only-unadmitted');
  assert.equal(controls.native_qualified, false);
  assert.deepEqual(Object.keys(controls.packages).sort(), names);
  const directories = read('provenance-directory-check.json');
  assert.equal(directories.kind, 'util-new-provenance-directory-check');
  assert.equal(directories.status, 'policy-checked-unadmitted');
  assert.equal(directories.native_qualified, false);
  const directoryPolicy = read('provenance-directories.json');
  assert.equal(createHash('sha256').update(readFileSync(join(root, 'provenance-directories.json'))).digest('hex'), preparation.provenance_directories_sha256);
  assert.equal(directories.policy_sha256, directoryPolicy.dpkg_policy_sha256);
  assert.deepEqual(Object.keys(directories.directories).sort(), Object.keys(directoryPolicy.paths).sort());
  assert(Object.keys(directories.directories).length > 0);
  for (const [path, observed] of Object.entries(directories.directories)) {
    if (observed.state === 'absent') assert.deepEqual(observed, {state: 'absent'});
    else assert.deepEqual(observed, {state: 'present', ...directoryPolicy.paths[path]});
  }
  for (const name of ['apt-simulation.stderr', 'dpkg-audit.stdout', 'dpkg-audit.stderr']) {
    assert.equal(readFileSync(join(root, name)).length, 0, `${name} must be empty`);
  }
}
