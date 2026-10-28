/** Authenticate the public Actions producer before preparing any Docker input. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync, existsSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {admitPublicPerlPromotion, sha256} from './lib/public-promotion.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const lock = JSON.parse(readFileSync(join(here, 'promoted-runtime.lock.json')));
assert.match(lock.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
for (const key of ['run_id', 'run_attempt', 'artifact_id', 'repository_id', 'job_id']) assert.ok(Number.isSafeInteger(lock[key]) && lock[key] > 0);
assert.match(lock.head_sha, /^[a-f0-9]{40}$/);
for (const key of ['workflow_path', 'verifier_path', 'qualification_lock_path']) assert.ok(!lock[key].startsWith('/') && !lock[key].split('/').includes('..') && /^[A-Za-z0-9_./-]+$/.test(lock[key]));
const api = endpoint => execFileSync('gh', ['api', endpoint], {maxBuffer: 64 * 1024 * 1024});
const json = endpoint => JSON.parse(api(endpoint));
const prefix = 'repos/' + lock.repository;
const run = json(`${prefix}/actions/runs/${lock.run_id}/attempts/${lock.run_attempt}`);
const jobs = json(`${prefix}/actions/runs/${lock.run_id}/attempts/${lock.run_attempt}/jobs?per_page=100`);
const artifact = json(`${prefix}/actions/artifacts/${lock.artifact_id}`);
const source = path => {
  const object = json(`${prefix}/contents/${path}?ref=${lock.head_sha}`);
  assert.equal(object.type, 'file'); assert.equal(object.encoding, 'base64');
  return Buffer.from(object.content, 'base64');
};
const workflow = source(lock.workflow_path), verifier = source(lock.verifier_path), qualificationLock = source(lock.qualification_lock_path);
const archive = api(`${prefix}/actions/artifacts/${lock.artifact_id}/zip`);
const origin = admitPublicPerlPromotion(lock, {run, jobs, artifact, workflow, verifier, qualificationLock, archive});
assert.ok(process.argv[2], 'An explicit fresh named-context output directory is required');
const output = resolve(process.argv[2]);
assert.ok(!existsSync(output), 'Refuse to reuse stale prepared Perl input');
const temporary = mkdtempSync(join(tmpdir(), 'perl-public-promotion-'));
try {
  const archivePath = join(temporary, 'artifact.zip'), extracted = join(temporary, 'extracted');
  writeFileSync(archivePath, archive); mkdirSync(extracted);
  const archiveNames = JSON.parse(execFileSync('python3', ['-c', `import sys, pathlib, zipfile, stat, json
root=pathlib.Path(sys.argv[2])
with zipfile.ZipFile(sys.argv[1]) as archive:
 items=archive.infolist(); names=[item.filename for item in items]
 assert len(names)==len(set(names))
 assert sum(item.file_size for item in items)<64*1024*1024
 for item in items:
  name=pathlib.PurePosixPath(item.filename)
  assert not name.is_absolute() and '..' not in name.parts and not item.is_dir()
  assert not stat.S_ISLNK(item.external_attr>>16)
  target=root.joinpath(*name.parts);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(archive.read(item))
 print(json.dumps(names))
`, archivePath, extracted], {encoding: 'utf8'}));
  const manifestBytes = readFileSync(join(extracted, 'qualified-input/manifest.json'));
  assert.equal(sha256(manifestBytes), lock.manifest_sha256);
  assert.equal(sha256(readFileSync(join(extracted, 'qualification.lock.json'))), lock.qualification_lock_sha256);
  // Execute only the verifier bytes already authenticated against the source lock.
  const verifierPath = join(temporary, 'verify.mjs'); writeFileSync(verifierPath, verifier);
  execFileSync(process.execPath, [verifierPath, extracted], {stdio: 'inherit'});
  const manifest = JSON.parse(manifestBytes), identity = JSON.parse(readFileSync(join(extracted, 'promotion-identity.json')));
  for (const [key, expected] of Object.entries({repository: lock.repository, source_head: lock.head_sha, run_id: lock.run_id, run_attempt: lock.run_attempt, workflow_sha256: lock.workflow_sha256, verifier_sha256: lock.verifier_sha256, lock_sha256: lock.qualification_lock_sha256})) assert.equal(identity[key], expected);
  assert.equal(identity.source_compiled_in_promotion, false);
  const expected = ['qualification.lock.json', 'promotion-identity.json', 'promotion-verification.json', 'qualified-input/manifest.json', ...Object.keys(manifest.inventory).map(name => 'qualified-input/' + name)];
  assert.deepEqual(archiveNames.sort(), expected.sort(), 'Surplus or missing promotion archive entries');
  mkdirSync(output, {recursive: true}); mkdirSync(join(output, 'packages'));
  writeFileSync(join(output, 'proof.json'), manifestBytes);
  writeFileSync(join(output, 'origin.json'), JSON.stringify(origin) + '\n');
  for (const item of Object.values(manifest.packages)) copyFileSync(join(extracted, 'qualified-input', item.deb.name), join(output, item.deb.name));
  writeFileSync(join(output, 'promotion-lock.json'), JSON.stringify(lock) + '\n');
  console.log('PASS authenticated public Perl producer metadata, archive and complete reviewed input inventory');
} catch (error) {
  if (existsSync(output)) rmSync(output, {recursive: true, force: true});
  throw error;
} finally {
  rmSync(temporary, {recursive: true, force: true});
}
