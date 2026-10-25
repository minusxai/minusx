const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyNetworkProof } = require('./verify-network-proof.cjs');

function fixture(t, gnutls = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'network-proof-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const doc = path.join(root, 'receipts');
  fs.mkdirSync(doc);
  const filename = '/usr/lib/example/' + (gnutls ? 'libcurl-gnutls.so.4.8.0' : 'libcurl.so.4.8.0');
  fs.mkdirSync(path.dirname(path.join(root, filename)), { recursive: true });
  fs.writeFileSync(path.join(root, filename), 'ordinary native fixture');
  const digest = crypto.createHash('sha256').update('ordinary native fixture').digest('hex');
  const beforeDigest = gnutls ? crypto.createHash('sha256').update('before SONAME rewrite').digest('hex') : digest;
  const write = (name, value) => fs.writeFileSync(path.join(doc, name), JSON.stringify(value));
  const row = { tls_variant: gnutls ? 'gnutls' : 'openssl', http_version: '3', ca_verified: true };
  const before = { ...row, phase: 'upstream-staged', staged_libcurl_sha256: beforeDigest };
  const after = { ...row, phase: 'post-transform', staged_libcurl_sha256: digest };
  const transform = { operation: 'patchelf --set-soname', from: 'libcurl.so.4', to: 'libcurl-gnutls.so.4', before_sha256: beforeDigest, after_sha256: digest };
  write('runtime-native.json', { [filename]: digest });
  write('runtime-build-http3-proof.json', [before]);
  write('runtime-transformed-http3-proof.json', [after]);
  write('runtime-soname-transform.json', transform);
  return { root, doc, filename, write, before, after, transform, verify: () => verifyNetworkProof(root, doc, gnutls ? 'libcurl3t64-gnutls' : 'libcurl4t64') };
}

test('unchanged OpenSSL payload binds both transfer proofs to installed bytes', t => fixture(t).verify());
test('GnuTLS permits only the recorded tested SONAME transformation', t => fixture(t, true).verify());
test('changed installed bytes fail', t => {
  const f = fixture(t); fs.appendFileSync(path.join(f.root, f.filename), 'changed'); assert.throws(f.verify);
});
test('empty native inventory fails', t => {
  const f = fixture(t); f.write('runtime-native.json', {}); assert.throws(f.verify);
});
test('unrecorded OpenSSL transformation fails', t => {
  const f = fixture(t); f.write('runtime-build-http3-proof.json', [{ ...f.before, staged_libcurl_sha256: 'different' }]); assert.throws(f.verify);
});
test('post-transform transfer must test the actual packaged bytes', t => {
  const f = fixture(t, true); f.write('runtime-transformed-http3-proof.json', [{ ...f.after, staged_libcurl_sha256: 'different' }]); assert.throws(f.verify);
});
test('incorrect SONAME transform mapping fails', t => {
  const f = fixture(t, true); f.write('runtime-soname-transform.json', { ...f.transform, from: 'different' }); assert.throws(f.verify);
});
test('duplicate transfer rows fail', t => {
  const f = fixture(t); f.write('runtime-build-http3-proof.json', [f.before, f.before]); assert.throws(f.verify);
});
test('an HTTPS fallback is not HTTP3 proof', t => {
  const f = fixture(t); f.write('runtime-transformed-http3-proof.json', [{ ...f.after, http_version: '2' }]); assert.throws(f.verify);
});
test('disabled certificate verification fails', t => {
  const f = fixture(t); f.write('runtime-build-http3-proof.json', [{ ...f.before, ca_verified: false }]); assert.throws(f.verify);
});
test('wrong transfer phase fails', t => {
  const f = fixture(t); f.write('runtime-transformed-http3-proof.json', [{ ...f.after, phase: 'upstream-staged' }]); assert.throws(f.verify);
});
test('native inventory cannot escape the runtime root', t => {
  const f = fixture(t); f.write('runtime-native.json', { '/usr/../outside': 'different' }); assert.throws(f.verify);
});
