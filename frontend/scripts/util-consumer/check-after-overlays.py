"""Recheck selected controls, providers and payload after existing app overlays.
The earlier isolated transaction has already required unchanged whole status.
"""
import json
import hashlib
from pathlib import Path
import runpy
import sys

check = runpy.run_path(str(Path(__file__).with_name('check-util-final.py')))['check']
root, archives, output = map(Path, sys.argv[1:])
# Only the existing, separately validated runtime overlays may change here.
versions = {'perl-base': '5.40.1-6+deb13u1+runtime1', 'libsqlite3-0': '3.46.1-7+deb13u2+runtime1',
            'libpcre2-8-0': '10.49-1+runtime1', 'tar': '1.35+fedora10-1+runtime1',
            'dash': '0.5.12+libcfnmatch-1+runtime1', 'coreutils': '9.12-1+runtime1',
            'libtinfo6': '6.6-1+runtime1', 'ncurses-bin': '6.6-1+runtime1', 'ncurses-base': '6.6-1+runtime1'}
# Keep the existing source recipes' exact package/version allowlist; only packages
# present in this freshly captured target can be overlaid.
optional = {'curl': '8.18.0-1+runtime1', 'libcurl4t64': '8.18.0-1+runtime1',
            'libcurl3t64-gnutls': '8.18.0-1+runtime1',
            'openssh-client': '1:10.6p1-1+runtime1', 'openssh-server': '1:10.6p1-1+runtime1',
            'openssh-sftp-server': '1:10.6p1-1+runtime1'}
optional['libgssapi-krb5-2'] = '1.21.3-5+deb13u1+runtime1'
optional['libk5crypto3'] = '1.21.3-5+deb13u1+runtime1'
optional['libkrb5-3'] = '1.21.3-5+deb13u1+runtime1'
optional['libkrb5support0'] = '1.21.3-5+deb13u1+runtime1'
optional['libp11-kit0'] = '0.25.5-3+runtime1'
optional['libelf1t64'] = '0.192-4+runtime1'
optional['libfreetype6'] = '2.13.3+dfsg-1+deb13u1+runtime1'
original = runpy.run_path(str(Path(__file__).with_name('check-util-final.py')))['statuses'](root / 'original-status')
versions.update({name: version for name,version in optional.items() if name in original})
assert not set(versions) & {'util-linux', 'libmount1', 'login', 'mount',
                       'libblkid1', 'liblastlog2-2', 'libsmartcols1', 'libuuid1'}
assert {path.name for path in archives.iterdir()} == {name + '.deb' for name in versions}
overlays = {name: (archives / (name + '.deb'), version) for name, version in versions.items()}
check(json.loads((root / 'plan.json').read_text()), root / 'original-status', root,
      output, root / 'packages', overlay_archives=overlays)
directory_helpers = runpy.run_path(str(Path(__file__).with_name('check-provenance-directories.py')))
policy = json.loads((root / 'provenance-directories.json').read_text())
result = directory_helpers['check'](policy, Path('/etc/dpkg/dpkg.cfg.d/docker').read_bytes(), directory_helpers['actual'])
receipt = json.loads(output.read_text())
receipt['provenance_directory_check'] = result
receipt['provenance_directories_sha256'] = hashlib.sha256((root / 'provenance-directories.json').read_bytes()).hexdigest()
output.write_text(json.dumps(receipt, indent=2) + '\n')
