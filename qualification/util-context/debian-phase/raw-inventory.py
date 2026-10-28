"""Hash bounded raw recovery inputs without interpreting or accepting them."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys


def inventory(root):
    result = {}
    if not root.exists():
        return result
    for path in sorted(root.rglob('*')):
        info = path.lstat()
        item = {'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid}
        if path.is_symlink():
            item.update(kind='link', target=os.readlink(path))
        elif path.is_dir():
            item['kind'] = 'directory'
        else:
            assert path.is_file(), 'Unsupported raw recovery input'
            item.update(kind='file', sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        result[str(path.relative_to(root))] = item
    return result


work, output = map(Path, sys.argv[1:])
original = inventory(work / 'original')
source = inventory(work / 'source')
debs = {}
family = work / 'original/resolver/installed-util-family'
if family.is_file():
    for package in family.read_text().splitlines():
        assert package and all(c in 'abcdefghijklmnopqrstuvwxyz0123456789+.-' for c in package)
        for path in work.glob(package + '_*.deb'):
            debs[path.name] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'size': path.stat().st_size}
output.write_text(json.dumps({'kind': 'util-raw-recovery-inventory', 'status': 'unadmitted',
    'metadata_accepted': False, 'native_qualified': False, 'original': original,
    'compiled_source_inventory': source, 'available_debs': debs}, indent=2, sort_keys=True) + '\n')
