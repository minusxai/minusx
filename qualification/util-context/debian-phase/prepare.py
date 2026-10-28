"""Verify APT-authenticated source files, then apply the pinned patch series."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

here, work = map(Path, sys.argv[1:])
proof = json.loads((here / 'source.json').read_text())
for item in proof['source_files']:
    data = (work / item['name']).read_bytes()
    assert len(data) == item['bytes'], item['name']
    assert hashlib.sha256(data).hexdigest() == item['sha256'], item['name']
# APT has already checked the source archive against the signed Debian index.
subprocess.run(['dpkg-source', '--no-check', '-x',
                str(work / 'util-linux_2.41.5-0+deb13u1.dsc'),
                str(work / 'source')], check=True)
root = work / 'source'
environment = os.environ | {'QUILT_PATCHES': 'debian/patches',
                            'QUILT_PATCH_OPTS': '--fuzz=0'}
for item in proof['patches']:
    patch = here / item['file']
    assert hashlib.sha256(patch.read_bytes()).hexdigest() == item['sha256']
    subprocess.run(['quilt', 'import', str(patch)], cwd=root,
                   env=environment, check=True)
    subprocess.run(['quilt', 'push'], cwd=root, env=environment, check=True)
changelog = root / 'debian/changelog'
entry = ('util-linux (' + proof['runtime_version'] + ') trixie; urgency=medium\n\n'
         '  * Apply reviewed upstream mount and namespace security fixes.\n\n'
         ' -- Runtime Maintainers <maintainers@example.invalid>'
         '  Wed, 28 Oct 2026 00:00:00 +0000\n\n')
changelog.write_text(entry + changelog.read_text())
# Debian later reconfigures for installer udebs. Retain the regular runtime
# configuration immediately after its unchanged full Linux test target.
rules = root / 'debian/rules'
text = rules.read_text()
old = '\tdh_auto_test --max-parallel=1\nelse'
assert text.count(old) == 1
rules.write_text(text.replace(old, '\tdh_auto_test --max-parallel=1\n'
                              '\tcp config.h ../runtime-config.h\nelse'))
