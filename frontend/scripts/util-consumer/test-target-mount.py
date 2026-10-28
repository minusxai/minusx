"""Run metadata-only constructor controls against an authenticated original capture."""
import hashlib
import json
from pathlib import Path
import runpy
import shutil
import sys
import tempfile
import io
import tarfile
import copy

construct = runpy.run_path(str(Path(__file__).with_name('make-target-mount.py')))['construct']
source = Path(sys.argv[1])
negative_controls = 0


def reject(label, mutate):
    global negative_controls
    with tempfile.TemporaryDirectory(prefix='mount-constructor-negative-') as directory:
        root = Path(directory)
        capture = root / 'capture'
        shutil.copytree(source, capture)
        output = root / 'mount.deb'
        mutate(capture, output)
        before = output.read_bytes() if output.exists() and not output.is_symlink() else None
        try:
            construct(capture, output)
        except (AssertionError, FileExistsError):
            if before is None:
                assert not output.exists() or output.is_symlink(), 'Failed gate emitted package'
            else:
                assert output.read_bytes() == before, 'Existing output overwritten'
            negative_controls += 1
            return
        raise AssertionError('Negative control accepted: ' + label)


def profile(capture, mutate):
    path = capture / 'profile.json'
    value = json.loads(path.read_text())
    mutate(value)
    path.write_text(json.dumps(value))


def archive(capture, mutate, pax=False):
    path = capture / 'mount/payload.tar'
    with tarfile.open(path, mode='r:') as source:
        members = [(copy.copy(m), source.extractfile(m).read() if m.isfile() else None) for m in source]
    mutate(members)
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w', format=tarfile.PAX_FORMAT if pax else tarfile.GNU_FORMAT) as target:
        for member, content in members:
            target.addfile(member, io.BytesIO(content) if content is not None else None)
    data = stream.getvalue()
    path.write_bytes(data)
    profile(capture, lambda p: p['packages']['mount'].__setitem__('payload_archive_sha256', hashlib.sha256(data).hexdigest()))


def member_change(capture, mutate, pax=False):
    def change(items):
        index = next(i for i, (member, _) in enumerate(items) if member.isfile())
        member, content = items[index]
        items[index] = mutate(member, content)
    archive(capture, change, pax)


def dependency(capture, value):
    path = capture / 'mount/status'
    raw = path.read_text()
    line = next(line for line in raw.splitlines() if line.startswith('Pre-Depends: '))
    raw = raw.replace(line, line + value)
    path.write_text(raw)
    profile(capture, lambda p: p['packages']['mount'].__setitem__('status_sha256', hashlib.sha256(raw.encode()).hexdigest()))


with tempfile.TemporaryDirectory(prefix='mount-constructor-positive-') as directory:
    output = Path(directory) / 'mount.deb'
    construct(source, output)
    first = output.read_bytes()
    second = Path(directory) / 'second.deb'
    construct(source, second)
    assert second.read_bytes() == first, 'Constructor output must be deterministic'
    receipt = json.loads(output.with_suffix('.receipt.json').read_text())
    assert receipt['status'] == 'constructed-unadmitted' and receipt['native_qualified'] is False
    assert receipt['preserved_target_tarinfo_entries'] == len(json.loads((source / 'profile.json').read_text())['packages']['mount']['files'])

reject('whole status drift', lambda c, _: (c / 'raw-status').write_bytes((c / 'raw-status').read_bytes() + b'\n'))
reject('mount status drift', lambda c, _: (c / 'mount/status').write_bytes((c / 'mount/status').read_bytes() + b'\n'))
reject('payload archive drift', lambda c, _: (c / 'mount/payload.tar').write_bytes((c / 'mount/payload.tar').read_bytes() + b'x'))
reject('md5 control drift', lambda c, _: (c / 'mount/controls/md5sums').write_bytes(b'changed\n'))
reject('generated path list drift', lambda c, _: (c / 'mount/controls/list').write_bytes(b'/unexpected\n'))
reject('extra control', lambda c, _: profile(c, lambda p: p['packages']['mount']['controls'].update(postinst={})))
reject('numeric owner drift', lambda c, _: profile(c, lambda p: next(iter(p['packages']['mount']['files'].values())).__setitem__('uid', 999)))
reject('payload path closure drift', lambda c, _: profile(c, lambda p: p['packages']['mount']['files'].pop(next(iter(p['packages']['mount']['files'])))))
reject('dangling output symlink', lambda _, o: o.symlink_to(o.with_name('missing')))
reject('existing output', lambda _, o: o.write_bytes(b'existing'))
reject('control root owner', lambda c, _: profile(c, lambda p: p['packages']['mount']['controls']['md5sums'].__setitem__('uid', 1)))
reject('control root group', lambda c, _: profile(c, lambda p: p['packages']['mount']['controls']['md5sums'].__setitem__('gid', 1)))
reject('control mode', lambda c, _: profile(c, lambda p: p['packages']['mount']['controls']['md5sums'].__setitem__('mode', 0o777)))
reject('missing control', lambda c, _: profile(c, lambda p: p['packages']['mount']['controls'].pop('md5sums')))
reject('payload mode', lambda c, _: profile(c, lambda p: next(iter(p['packages']['mount']['files'].values())).__setitem__('mode', 0o777)))
reject('payload group', lambda c, _: profile(c, lambda p: next(iter(p['packages']['mount']['files'].values())).__setitem__('gid', 1)))
reject('dependency duplicate', lambda c, _: dependency(c, ', libmount1 (= 2.41.5-0+deb13u1)'))
reject('dependency unknown', lambda c, _: dependency(c, ', unexpected-package'))
reject('missing archive member', lambda c, _: archive(c, lambda members: members.pop()))
reject('duplicate archive member', lambda c, _: archive(c, lambda members: members.append(members[-1])))
def traversing(member, content):
    member.name = '/usr/../escape'
    return member, content
reject('traversing member', lambda c, _: member_change(c, traversing))
def changed_content(member, content):
    content = b'x' + content[1:] if content else b'x'
    member.size = len(content)
    return member, content
reject('file content drift with updated archive hash', lambda c, _: member_change(c, changed_content))
def special(kind, target=''):
    def change(member, _):
        member.type, member.linkname, member.size = kind, target, 0
        return member, None
    return change
reject('missing hardlink target', lambda c, _: member_change(c, special(tarfile.LNKTYPE, '/missing')))
reject('escaping hardlink target', lambda c, _: member_change(c, special(tarfile.LNKTYPE, '../../escape')))
def symbolic(capture, target):
    def change(members):
        index = next(i for i, (m, _) in enumerate(members) if m.isfile())
        member = members[index][0]
        path = '/' + member.name.lstrip('/')
        member.type, member.linkname, member.size = tarfile.SYMTYPE, target, 0
        members[index] = member, None
        profile(capture, lambda p: p['packages']['mount']['files'][path].update(kind='link', target=target))
    archive(capture, change)
reject('escaping symlink', lambda c, _: symbolic(c, '../../escape'))
reject('missing symlink target', lambda c, _: symbolic(c, '/outside-original-payload'))
reject('device member', lambda c, _: member_change(c, special(tarfile.CHRTYPE)))
def pax_member(member, content):
    member.pax_headers = {'comment': 'unreviewed extended metadata'}
    return member, content
reject('PAX member', lambda c, _: member_change(c, pax_member, pax=True))
def sparse_member(member, content):
    member.pax_headers = {'GNU.sparse.size': str(member.size), 'GNU.sparse.map': '0,' + str(member.size)}
    return member, content
reject('sparse PAX member', lambda c, _: member_change(c, sparse_member, pax=True))
def cycle(capture, _):
    def change(members):
        indexes = [i for i, (m, _) in enumerate(members) if m.isfile()][:2]
        a, b = (members[i][0] for i in indexes)
        a.type = b.type = tarfile.LNKTYPE
        a.size = b.size = 0
        a.linkname, b.linkname = b.name, a.name
        for index in indexes:
            members[index] = members[index][0], None
    archive(capture, change)
reject('hardlink cycle', cycle)
reject('member count bound', lambda c, _: archive(c, lambda members: members.extend([members[-1]] * 513)))
def oversized(capture, _):
    path = capture / 'mount/payload.tar'
    data = path.read_bytes() + b'\0' * (8 * 1024 * 1024)
    path.write_bytes(data)
    profile(capture, lambda p: p['packages']['mount'].__setitem__('payload_archive_sha256', hashlib.sha256(data).hexdigest()))
reject('archive byte bound', oversized)
print(json.dumps({'kind': 'target-mount-constructor-regression', 'status': 'constructor-only-unadmitted',
                  'positive': ['deterministic output', 'typed unadmitted receipt', 'complete target TarInfo'],
                  'negative_controls': negative_controls, 'source_profile_sha256': hashlib.sha256((source / 'profile.json').read_bytes()).hexdigest()}, indent=2))
