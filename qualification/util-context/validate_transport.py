"""Validate raw transport completion; this never admits native packages."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tarfile
import sys


def validate_transport(root, phase):
    root = Path(root)
    result = json.loads((root / 'build-execution.json').read_text())
    assert set(result) == {'schema', 'kind', 'status', 'phase', 'source_exit_code',
                           'export_exit_code', 'installed_native_qualification'}
    assert type(result['schema']) is int and result['schema'] == 1 and result['kind'] == 'util-evidence-transport'
    assert result['status'] == 'raw-unadmitted' and result['phase'] == phase
    assert result['installed_native_qualification'] is False
    for name in ('source_exit_code', 'export_exit_code'):
        assert type(result[name]) is int and result[name] == 0, ('Unsuccessful raw execution', name, result[name])
    archive = root / 'raw-work-inputs.tar'
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    assert (root / 'raw-work-inputs.sha256').read_text() == digest + '  /out/raw-work-inputs.tar\n'
    names = (root / 'raw-work-inputs.paths').read_bytes().split(b'\0')
    assert names[-1] == b'' and len(set(names[:-1])) == len(names) - 1
    names = [name.decode('utf-8') for name in names[:-1]]
    assert 'original' in names
    allowed = {'original', 'original-payload', 'baseline.json', 'runtime-config.h', 'original-features.h'}
    for name in names:
        assert name in allowed or re.fullmatch(r'[a-z0-9][a-z0-9+.-]*_[^/\s]+\.deb', name)
    archived = {}
    with tarfile.open(archive) as stream:
        for member in stream:
            path = PurePosixPath(member.name)
            assert not path.is_absolute() and '..' not in path.parts and str(path) == member.name
            assert path.parts[0] in names and member.name not in archived
            assert member.isdir() or member.isfile(), 'Unsupported raw archive entry'
            item = {'mode': member.mode, 'uid': member.uid, 'gid': member.gid,
                    'kind': 'directory' if member.isdir() else 'file'}
            if member.isfile():
                data = stream.extractfile(member).read()
                item.update(sha256=hashlib.sha256(data).hexdigest(), size=len(data))
                if path.parts[0] == 'original':
                    relative = Path(*path.parts[1:])
                    actual = root / 'pristine-original' / relative
                    assert actual.is_file() and not actual.is_symlink()
                    assert hashlib.sha256(actual.read_bytes()).hexdigest() == item['sha256']
            archived[member.name] = item
    direct = {str(path.relative_to(root / 'pristine-original')) for path in (root / 'pristine-original').rglob('*')}
    assert direct == {name.removeprefix('original/') for name in archived if name.startswith('original/')}
    if phase == 'compile':
        raw = json.loads((root / 'raw-input-inventory.json').read_text())
        assert raw['kind'] == 'util-raw-recovery-inventory' and raw['status'] == 'unadmitted'
        assert raw['metadata_accepted'] is False and raw['native_qualified'] is False
        assert raw['compiled_source_inventory']
        original = {name.removeprefix('original/'): {key: value for key, value in item.items() if key != 'size'}
                    for name, item in archived.items() if name.startswith('original/')}
        assert raw['original'] == original
        debs = {name: {'sha256': item['sha256'], 'size': item['size']}
                for name, item in archived.items() if name.endswith('.deb')}
        assert raw['available_debs'] == debs
    return result


if __name__ == '__main__':
    assert len(sys.argv) == 3 and sys.argv[2] in ('snapshot', 'compile')
    validate_transport(Path(sys.argv[1]), sys.argv[2])
