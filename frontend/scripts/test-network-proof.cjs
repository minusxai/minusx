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

function sourceFixture(t, variant = 'openssl') {
  const f = fixture(t, variant === 'gnutls');
  const source = structuredClone(require('./network/curl-maintenance-source.json'));
  const config = {
    tls: variant,
    config_sha256: 'a'.repeat(64),
    required_defined: ['USE_LIBSSH2', 'USE_OPENLDAP', 'HAVE_GSSAPI', 'USE_LIBRTMP', 'USE_TLS_SRP', 'USE_NGTCP2', 'USE_NGHTTP3', variant === 'gnutls' ? 'USE_GNUTLS' : 'USE_OPENSSL'].sort(),
    forbidden_undefined: ['USE_LIBSSH', 'USE_WOLFSSL', 'USE_OPENSSL_QUIC', 'CURL_DISABLE_IPFS', 'CURL_DISABLE_SMB', 'CURL_DISABLE_NTLM', variant === 'gnutls' ? 'USE_OPENSSL' : 'USE_GNUTLS'].sort(),
  };
  f.write('runtime-curl-maintenance-source.json', source);
  f.write('runtime-curl-config.json', config);
  return { ...f, source, config, verify: () => require('./verify-network-proof.cjs').verifyCurlSource(f.doc, variant) };
}
test('both TLS receipts bind the exact maintenance patch set and generated configuration', t => {
  sourceFixture(t).verify(); sourceFixture(t, 'gnutls').verify();
});
test('changed source patch digest fails installed receipt admission', t => {
  const f = sourceFixture(t); f.source.patches[Object.keys(f.source.patches)[0]] = 'b'.repeat(64);
  f.write('runtime-curl-maintenance-source.json', f.source); assert.throws(f.verify);
});
test('missing native QUIC exclusion fails installed receipt admission', t => {
  const f = sourceFixture(t); f.config.forbidden_undefined = f.config.forbidden_undefined.filter(name => name !== 'USE_OPENSSL_QUIC');
  f.write('runtime-curl-config.json', f.config); assert.throws(f.verify);
});
test('lost original capability fails installed receipt admission', t => {
  const f = sourceFixture(t); f.config.required_defined = f.config.required_defined.filter(name => name !== 'USE_TLS_SRP');
  f.write('runtime-curl-config.json', f.config); assert.throws(f.verify);
});
test('wrong TLS family fails installed receipt admission', t => {
  const f = sourceFixture(t); f.config.tls = 'gnutls';
  f.write('runtime-curl-config.json', f.config); assert.throws(f.verify);
});
