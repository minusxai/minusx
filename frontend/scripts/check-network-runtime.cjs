const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
(async () => {
  const run = async (command, args, options = {}) => (await execFile(command, args, { encoding: 'utf8', timeout: 15000, ...options })).stdout;
  assert.equal((await run('dpkg-query', ['-W', '-f=${Version}', 'curl'])).trim(), '8.23.0-1+runtime1');
  assert.equal((await run('dpkg-query', ['-W', '-f=${Version}', 'libcurl4t64'])).trim(), '8.23.0-1+runtime1');
  const installed = async name => {
    try { return (await run('dpkg-query', ['-W', '-f=${db:Status-Status}', name])).trim() === 'installed'; }
    catch (error) { if (error.code !== 1) throw error; return false; }
  };
  for (const name of ['libgssapi-krb5-2', 'libk5crypto3', 'libkrb5-3', 'libkrb5support0', 'libp11-kit0']) {
    assert.equal(await installed(name), true, 'Required original client library: ' + name);
  }
  for (const name of ['libcurl3t64-gnutls', 'openssh-client', 'openssh-server', 'slapd', 'libsasl2-modules', 'nghttp2-proxy', 'krb5-kdc', 'krb5-admin-server', 'krb5-kdc-ldap', 'libelf1t64', 'libfreetype6']) {
    assert.equal(await installed(name), false, 'Unexpected component in scoped runtime: ' + name);
  }
  const files = (await run('dpkg-query', ['-L', 'libsasl2-2', 'libsasl2-modules-db'])).split('\n');
  assert.ok(!files.some(file => /libdigestmd5\.so/.test(file)), 'DIGEST-MD5 plugin must remain absent');
  const krbFiles = (await run('dpkg-query', ['-L', 'libgssapi-krb5-2', 'libkrb5-3'])).split('\n');
  assert.ok(!krbFiles.some(file => /libgssrpc|kadmind|krb5kdc/.test(file)), 'KDC/RPC components must remain absent');
  const ldapFiles = (await run('dpkg-query', ['-L', 'libldap2'])).split('\n');
  const ldap = ldapFiles.find(file => /\/libldap\.so\.\d/.test(file) && fs.existsSync(file) && !fs.lstatSync(file).isSymbolicLink());
  assert.ok(ldap, 'Installed LDAP library is required');
  const dependencies = await run('ldd', [ldap]);
  assert.match(dependencies, /libgnutls\.so/);
  assert.doesNotMatch(dependencies, /libnss3\.so|not found/);
  assert.ok(['x64', 'arm64'].includes(process.arch), '32-bit p11-kit overflow exclusion requires a 64-bit runtime');
  const receipt = JSON.parse(fs.readFileSync('/usr/share/doc/runtime-network/libcurl4t64/runtime-source.json', 'utf8'));
  assert.equal(receipt.version, '8.23.0-1+runtime1');
  assert.equal(receipt.source_archive_sha256, '8dadd7d2536a314f982ad05a651b713f426bf7d02cc2c76cffb9796f2218e6c5');
  // Same final payload and public-API gates as the shared Python checker,
  // using the existing Node runtime rather than adding Python to the image.
  const crypto = require('node:crypto');
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'libraries/config.json'), 'utf8'));
  const patchedPackages = new Set();
  for (const item of Object.values(config)) {
    for (const name of item.packages) {
      if (!(await installed(name))) continue;
      patchedPackages.add(name);
      const receipt = JSON.parse(fs.readFileSync('/usr/share/doc/runtime-libraries/' + name + '/runtime-source.json', 'utf8'));
      assert.equal((await run('dpkg-query', ['-W', '-f=${Version}', name])).trim(), receipt.version, name);
      for (const [filename, digest] of Object.entries(receipt.native_sha256)) {
        assert.equal(crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'), digest, filename);
      }
    }
  }
  const environment = { ...process.env };
  delete environment.LD_LIBRARY_PATH;
  for (const [fixture, names] of [['krb5', config.krb5.packages], ['p11', ['libp11-kit0']], ['elf', ['libelf1t64']], ['freetype', ['libfreetype6']]]) {
    if (!names.some(name => patchedPackages.has(name))) continue;
    await run(path.join(process.argv[3], 'check-' + fixture), [], { env: environment, timeout: 30000 });
    console.log('Installed native payload hashes and public API fixture passed: ' + fixture);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'network-check-'));
  let server;
  try {
    const key = path.join(directory, 'key.pem');
    const cert = path.join(directory, 'cert.pem');
    await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1']);
    const payload = 'ordinary loopback transfer\n';
    server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert), minVersion: 'TLSv1.2' }, (_, response) => response.end(payload));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = 'https://127.0.0.1:' + server.address().port + '/payload';
    const version = await run('curl', ['--version']);
    assert.match(version, /^curl 8\.23\.0 .*libcurl\/8\.23\.0 .*OpenSSL\//);
    assert.equal(await run('curl', ['--fail', '--silent', '--show-error', '--noproxy', '*', '--cacert', cert, url]), payload);
    assert.equal(await run(process.argv[2], [url, cert]), payload);
    console.log('Installed curl CLI and libcurl ABI perform CA-verified TLS transfers; scoped component inventory and loader checks passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
