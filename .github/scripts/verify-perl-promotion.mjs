import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, lstatSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root = process.argv[2] || 'runtime-inputs/perl';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const read = name => readFileSync(join(root, 'qualified-input', name));
const json = name => JSON.parse(read(name));
const lock = JSON.parse(readFileSync(join(root, 'qualification.lock.json')));
assert.equal(lock.schema, 1);
const bytes = read('manifest.json');
assert.equal(digest(bytes), lock.manifest_sha256);
const manifest = JSON.parse(bytes);
assert.equal(manifest.schema, 1);
assert.equal(manifest.kind, 'perl-sanitized-promotion-input');
assert.equal(manifest.status, 'reviewed-source-evidence');
assert.equal(manifest.component, 'perl');
assert.equal(manifest.source_compiled_in_promotion, false);
for (const key of ['original_profile_sha256', 'base_index', 'base_child', 'source_recipe_sha256', 'platform']) assert.equal(manifest[key], lock[key]);
assert.equal(manifest.platform, 'linux/amd64');
const found = [];
function visit(relative = '') {
  for (const name of readdirSync(join(root, 'qualified-input', relative)).sort()) {
    const item = join(relative, name), stat = lstatSync(join(root, 'qualified-input', item));
    assert.ok(!stat.isSymbolicLink(), 'Symlink in promotion input');
    if (stat.isDirectory()) visit(item);
    else { assert.ok(stat.isFile()); found.push(item); }
  }
}
visit();
assert.deepEqual(found.sort(), ['manifest.json', ...Object.keys(manifest.inventory)].sort());
for (const [name, expected] of Object.entries(manifest.inventory)) {
  assert.ok(!name.startsWith('/') && !name.split('/').includes('..') && /^(packages|evidence)\//.test(name));
  const file = read(name);
  assert.equal(file.length, expected.size, name);
  assert.equal(digest(file), expected.sha256, name);
}
assert.equal(digest(read('evidence/original-profile.json')), manifest.original_profile_sha256);
const original = json('evidence/original-profile.json');
assert.deepEqual(original.unsupported, []);
assert.deepEqual(original.configuration, manifest.original_configuration);
assert.deepEqual(Object.keys(original.packages).sort(), Object.keys(manifest.packages).sort());
for (const [name, item] of Object.entries(manifest.packages)) {
  assert.equal(name, 'perl-base', 'This reviewed promotion is the exact minimal package profile');
  assert.deepEqual(item.original, original.packages[name]);
  assert.equal(item.candidate.version, item.original.version + '+runtime1');
  assert.equal(item.candidate.architecture, item.original.architecture);
  assert.deepEqual(item.deb, {name: 'packages/' + name + '.deb', ...manifest.inventory['packages/' + name + '.deb']});
}
assert.deepEqual(json('evidence/original-full-config.json'), manifest.original_configuration);
assert.deepEqual(json('evidence/candidate-full-config.json'), manifest.candidate_configuration);
const signature = json('evidence/source-signature.json');
assert.equal(signature.status, 'verified');
assert.equal(signature.signed_dsc_sha256, digest(read('evidence/source.dsc')));
assert.ok(signature.valid_signature_status_fields.length > 0);
for (const mode of ['static', 'shared']) {
  assert.equal(manifest.source_tests[mode].status, 'passed');
  assert.ok(manifest.source_tests[mode].scripts > 0 && manifest.source_tests[mode].tests > 0);
}
for (const name of ['debug_build', 'source_signature', 'source_patches', 'package_inventory', 'dependency_closure', 'staged_native', 'installed_native', 'full_config_comparison']) assert.equal(manifest.gate_assertions[name], 'passed');
const report = {schema: 1, manifest_sha256: lock.manifest_sha256, inventory_files: Object.keys(manifest.inventory).length, source_compiled_in_promotion: false, source_tests_rerun_in_promotion: false, scope: lock.promotion_scope, retained_signature_receipt_bound: true, retained_source_suite_assertions_bound: true};
writeFileSync(join(root, 'promotion-verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
