"""Read-only Linux defined-symbol check of the exact module loaded by Node."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


def verify_defined_symbols(names):
    assert 'sqlite3_libversion' in names, 'Require real SQLite defined-symbol visibility'
    forbidden = [name for name in names if re.match(r'^sqlite3(session_|changeset_|_preupdate_)', name)]
    assert not forbidden, ('Unexpected session/preupdate implementation', forbidden)


if __name__ == '__main__':
    root = Path(sys.argv[1])
    proof = json.loads((root / 'embedded-sqlite.json').read_text())
    assert proof['platform'] == 'linux'
    module = root / 'loaded-sqlite.node'
    data = module.read_bytes()
    assert data.startswith(b'\x7fELF')
    assert hashlib.sha256(data).hexdigest() == proof['module_sha256']
    output = subprocess.check_output(['nm', '--dynamic', '--defined-only', str(module)], text=True)
    names = {line.split()[-1].split('@')[0] for line in output.splitlines() if line.split()}
    verify_defined_symbols(names)
    receipt = {
        'module_sha256': proof['module_sha256'],
        'sqlite_defined_symbols': sorted(name for name in names if name.startswith('sqlite3')),
        'session_changeset_preupdate_defined_symbols': [],
        'limit': proof['limit'],
    }
    (root / 'embedded-sqlite-exports.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('PASS actual loaded Linux module hash and defined-symbol absence for session-specific applicability')
