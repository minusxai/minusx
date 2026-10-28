"""Actual authenticated fixture controls for source/target comparison only."""
import json
from pathlib import Path
import runpy
import shutil
import sys
import tempfile
import io
import tarfile

helpers = runpy.run_path(str(Path(__file__).with_name('compare-original.py')))
compare, inventory = helpers['compare'], helpers['inventory']
source, original = map(Path, sys.argv[1:])
positive = compare(source, original)
assert positive['status'] == 'family-matched-unadmitted' and positive['native_qualified'] is False
count = 0


def reject(label, mutate):
    global count
    with tempfile.TemporaryDirectory(prefix='util-family-comparison-negative-') as temporary:
        target = Path(temporary) / 'target'
        shutil.copytree(original, target)
        mutate(target)
        try:
            compare(source, target)
        except (AssertionError, KeyError):
            count += 1
            return
        raise AssertionError('Accepted target drift: ' + label)


def profile(target, mutate):
    path = target / 'profile.json'
    value = json.loads(path.read_text())
    mutate(value)
    path.write_text(json.dumps(value))


reject('whole status', lambda p: (p / 'raw-status').write_bytes(b'changed'))
reject('family package set', lambda p: profile(p, lambda r: r['packages'].pop('mount')))
reject('version', lambda p: profile(p, lambda r: r['packages']['login'].__setitem__('version', '0')))
reject('payload archive', lambda p: (p / 'mount/payload.tar').write_bytes(b'changed'))
reject('original status bytes', lambda p: (p / 'login/status').write_bytes((p / 'login/status').read_bytes() + b'\n'))
reject('original absent paths', lambda p: (p / 'mount/absent-documentation').write_bytes(b'/etc/unreviewed\n'))
reject('original path set', lambda p: (p / 'mount/paths').write_bytes(b'/unexpected\n'))
reject('physical absence profile', lambda p: profile(p, lambda r: r['packages']['mount']['absent_paths'].append('/etc/unreviewed')))
reject('runtime owner', lambda p: profile(p, lambda r: next(iter(r['packages']['mount']['files'].values())).__setitem__('uid', 123)))
reject('queried control bytes', lambda p: (p / 'mount/controls/md5sums').write_bytes(b'changed'))
reject('internal list bytes', lambda p: (p / 'mount/controls/list').write_bytes(b'changed'))
reject('internal conffiles bytes', lambda p: (p / 'login/controls/conffiles').write_bytes(b'/unexpected\n'))
reject('unreviewed physical control', lambda p: (p / 'mount/controls/extra').write_bytes(b'changed'))
reject('dpkg policy bytes', lambda p: (p / 'dpkg-docker.cfg').write_bytes(b'changed'))
reject('dpkg policy fingerprint', lambda p: profile(p, lambda r: r['dpkg_policy'].__setitem__('sha256', '0' * 64)))


def topology(items):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w', format=tarfile.GNU_FORMAT) as archive:
        for name, target in items:
            member = tarfile.TarInfo(name)
            if target is None:
                member.size = 4
                archive.addfile(member, io.BytesIO(b'same'))
            else:
                member.type, member.linkname = tarfile.LNKTYPE, target
                archive.addfile(member)
    return stream.getvalue()


linked = inventory(topology([('/a', None), ('/b', '/a')]))
independent = inventory(topology([('/a', None), ('/b', None)]))
assert linked['/b']['sha256'] == independent['/b']['sha256']
assert linked != independent and linked['/b']['hardlink_target'] == '/a'
for items in [[('/a', '/missing')], [('/a', '/b'), ('/b', '/a')], [('/a', '../../escape')]]:
    try:
        inventory(topology(items))
    except AssertionError:
        count += 1
    else:
        raise AssertionError('Invalid hardlink graph accepted')
stream = io.BytesIO()
with tarfile.open(fileobj=stream, mode='w', format=tarfile.GNU_FORMAT) as archive:
    member = tarfile.TarInfo('/a')
    member.devmajor = 1
    archive.addfile(member, io.BytesIO(b''))
data = bytearray(stream.getvalue())
data[329:337] = b'0000001\0'
data[148:156] = b'        '
data[148:156] = ('%06o\0 ' % sum(data[:512])).encode()
try:
    inventory(bytes(data))
except AssertionError:
    count += 1
else:
    raise AssertionError('Nonzero device metadata accepted')
print(json.dumps({'kind': 'util-source-target-comparison-regression', 'status': 'comparison-only-unadmitted',
                  'positive': True, 'hardlink_topology_distinguishes_equal_bytes': True,
                  'negative_controls': count}, indent=2))
