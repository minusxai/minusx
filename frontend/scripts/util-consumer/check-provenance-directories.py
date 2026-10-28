"""Check only candidate-locked new metadata directories under original slim policy."""
import hashlib
import json
from pathlib import Path
import stat
import sys


def check(spec, policy, inspect):
    assert set(spec) == {'kind', 'dpkg_policy_sha256', 'paths'}
    assert spec['kind'] == 'util-new-provenance-directory-policy'
    assert hashlib.sha256(policy).hexdigest() == spec['dpkg_policy_sha256']
    assert b'path-exclude /usr/share/doc/*' in policy.splitlines()
    assert 0 < len(spec['paths']) <= 32
    observed = {}
    for path, expected in spec['paths'].items():
        assert path == str(Path(path)) and '..' not in Path(path).parts
        roots = ['/usr/share/doc/' + name + '/runtime-security' for name in ('libmount1', 'util-linux', 'login')]
        assert any(path == root or path.startswith(root + '/') for root in roots)
        assert expected == {'kind': 'directory', 'mode': 0o755, 'uid': 0, 'gid': 0}
        assert all(type(expected[key]) is int for key in ('mode', 'uid', 'gid'))
        actual = inspect(path)
        assert actual is None or actual == expected, ('New metadata directory changed type/owner/mode', path)
        observed[path] = {'state': 'absent'} if actual is None else {'state': 'present', **actual}
    return {'kind': 'util-new-provenance-directory-check', 'status': 'policy-checked-unadmitted',
            'native_qualified': False, 'policy_sha256': spec['dpkg_policy_sha256'], 'directories': observed}


def actual(path):
    try:
        info = Path(path).lstat()
    except FileNotFoundError:
        return None
    return {'kind': 'directory' if stat.S_ISDIR(info.st_mode) else 'unsupported',
            'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid}


if __name__ == '__main__':
    inputs, output = map(Path, sys.argv[1:])
    spec = json.loads((inputs / 'provenance-directories.json').read_text())
    result = check(spec, Path('/etc/dpkg/dpkg.cfg.d/docker').read_bytes(), actual)
    output.write_text(json.dumps(result, sort_keys=True, indent=2) + '\n')
