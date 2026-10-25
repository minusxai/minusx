const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function verifyNetworkProof(root, directory, packageName) {
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
  const native = read('runtime-native.json');
  assert.ok(Object.keys(native).length, 'Empty native inventory');
  for (const [filename, digest] of Object.entries(native)) {
    assert.ok(filename.startsWith('/usr/') && !filename.split('/').includes('..'), filename);
    const actual = path.join(root, filename.slice(1));
    assert.ok(fs.statSync(actual).isFile(), filename);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(actual)).digest('hex'), digest, filename);
  }
  if (!packageName.startsWith('libcurl')) return native;
  const variant = packageName.endsWith('gnutls') ? 'gnutls' : 'openssl';
  const beforeRows = read('runtime-build-http3-proof.json').filter(row => row.tls_variant === variant);
  const afterRows = read('runtime-transformed-http3-proof.json').filter(row => row.tls_variant === variant);
  assert.equal(beforeRows.length, 1);
  assert.equal(afterRows.length, 1);
  const before = beforeRows[0];
  const after = afterRows[0];
  for (const [row, phase] of [[before, 'upstream-staged'], [after, 'post-transform']]) {
    assert.equal(row.phase, phase);
    assert.equal(row.http_version, '3');
    assert.equal(row.ca_verified, true);
  }
  const family = variant === 'gnutls' ? 'libcurl-gnutls.so.4' : 'libcurl.so.4';
  const libraries = Object.keys(native).filter(filename => path.basename(filename).startsWith(family + '.'));
  assert.equal(libraries.length, 1);
  assert.equal(native[libraries[0]], after.staged_libcurl_sha256, 'Installed library differs from tested transformed artifact');
  if (variant === 'gnutls') {
    assert.deepEqual(read('runtime-soname-transform.json'), {
      operation: 'patchelf --set-soname', from: 'libcurl.so.4', to: 'libcurl-gnutls.so.4',
      before_sha256: before.staged_libcurl_sha256, after_sha256: after.staged_libcurl_sha256,
    });
  } else {
    assert.equal(before.staged_libcurl_sha256, after.staged_libcurl_sha256);
  }
  return native;
}

function verifyCurlSource(doc, variant) {
  assert.ok(['openssl', 'gnutls'].includes(variant));
  const read = name => JSON.parse(fs.readFileSync(path.join(doc, name), 'utf8'));
  assert.deepEqual(read('runtime-curl-maintenance-source.json'), require('./network/curl-maintenance-source.json'));
  const config = read('runtime-curl-config.json');
  assert.equal(config.tls, variant);
  assert.match(config.config_sha256, /^[a-f0-9]{64}$/);
  const required = ['USE_LIBSSH2', 'USE_OPENLDAP', 'HAVE_GSSAPI', 'USE_LIBRTMP', 'USE_TLS_SRP', 'USE_NGTCP2', 'USE_NGHTTP3', variant === 'gnutls' ? 'USE_GNUTLS' : 'USE_OPENSSL'].sort();
  const forbidden = ['USE_LIBSSH', 'USE_WOLFSSL', 'USE_OPENSSL_QUIC', 'CURL_DISABLE_IPFS', 'CURL_DISABLE_SMB', 'CURL_DISABLE_NTLM', variant === 'gnutls' ? 'USE_OPENSSL' : 'USE_GNUTLS'].sort();
  assert.deepEqual(config.required_defined, required);
  assert.deepEqual(config.forbidden_undefined, forbidden);
}

module.exports = { verifyNetworkProof, verifyCurlSource };
