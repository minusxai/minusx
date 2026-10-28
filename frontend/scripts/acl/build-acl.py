#!/usr/bin/env python3
"""Authenticate and build the pinned Debian source with its normal test suite."""
import hashlib
import json
import pathlib
import subprocess


def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs)


root = pathlib.Path('/acl-source')
root.mkdir()
manifest = json.loads(pathlib.Path(__file__).with_name('source.json').read_text())
for item in manifest['files']:
    path = root / item['name']
    assert path.parent == root
    run('curl', '--fail', '--silent', '--show-error', '--location', '--proto', '=https',
        '--proto-redir', '=https', '--retry', '3', '--max-time', '180', item['url'], '-o', str(path))
    assert path.stat().st_size == item['bytes']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256']
keyring = '/usr/share/keyrings/debian-keyring.gpg'
authentication = run('gpgv', '--status-fd', '1', '--keyring', keyring, str(root / 'acl_2.4.0-1.dsc'))
fingerprints = [line.split()[2] for line in authentication.splitlines() if line.startswith('[GNUPG:] VALIDSIG ')]
assert fingerprints
run('dpkg-source', '--extract', str(root / 'acl_2.4.0-1.dsc'), str(root / 'build'))
source = root / 'build'
changelog = source / 'debian/changelog'
old = changelog.read_text()
assert old.startswith('acl (2.4.0-1) ')
changelog.write_text(old.replace('acl (2.4.0-1) ', 'acl (2.4.0-1+runtime1) ', 1))
# No nocheck profile or ignored test exit status. Debian runs the full upstream suite.
subprocess.run(['dpkg-buildpackage', '-us', '-uc', '-b', '-j2'], cwd=source, check=True)
out = pathlib.Path('/acl-out')
out.mkdir()
for package, name in [('libacl1', 'libacl1.deb'), ('libacl1-dev', 'libacl1-dev.deb')]:
    matches = list(root.glob(package + '_2.4.0-1+runtime1_*.deb'))
    assert len(matches) == 1
    (out / name).write_bytes(matches[0].read_bytes())
receipt = {'kind': 'authenticated-debian-acl-source-build', 'source_compiled': True,
           'source_version': '2.4.0-1', 'output_version': '2.4.0-1+runtime1',
           'source_inputs': manifest['files'], 'dsc_signer_fingerprints': fingerprints,
           'keyring_package_version': run('dpkg-query', '-W', '-f=${Version}', 'debian-keyring'),
           'test_policy': 'Normal Debian build including full dh_auto_test; no nocheck profile',
           'packages': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in out.glob('*.deb')}}
(out / 'source-proof.json').write_text(json.dumps(receipt, indent=2) + '\n')
