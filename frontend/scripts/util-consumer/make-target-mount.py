"""Metadata-only mount constructor. No installation or native admission.

The caller authenticates the complete original capture before invoking this file.
Only version/source bookkeeping and the one exact libmount1 dependency change.
"""
import copy
import hashlib
import io
import json
from pathlib import Path
from email.parser import Parser
import tarfile
import sys

OLD = '2.41.5-0+deb13u1'
NEW = OLD + '+security20261028'
VERSION = OLD + '+metadata20261028.1'
MAX_ARCHIVE = 8 * 1024 * 1024
MAX_MEMBER = 16 * 1024 * 1024
MAX_TOTAL = 32 * 1024 * 1024
MAX_MEMBERS = 512
sha = lambda value: hashlib.sha256(value).hexdigest()


def fields(raw):
    parsed = Parser().parsestr(raw)
    assert not parsed.defects and len(parsed.keys()) == len(set(parsed.keys()))
    return dict(parsed.items())


def ar_member(name, data):
    assert len(name) <= 15
    header = ((name + '/').ljust(16) + '0'.ljust(12) + '0'.ljust(6) +
              '0'.ljust(6) + '100644'.ljust(8) + str(len(data)).ljust(10) + '`\n')
    return header.encode() + data + (b'\n' if len(data) % 2 else b'')


def construct(capture, destination):
    profile = json.loads((capture / 'profile.json').read_text())
    assert profile['kind'] == 'util-consumer-original-capture'
    assert profile['status'] == 'capture-only-unadmitted'
    assert set(profile['selected_packages']) == {'libmount1', 'util-linux', 'login', 'mount'}
    assert sha((capture / 'raw-status').read_bytes()) == profile['raw_status_sha256']
    original = capture / 'mount'
    spec = profile['packages']['mount']
    raw = (original / 'status').read_text()
    assert sha(raw.encode()) == spec['status_sha256']
    before = fields(raw)
    assert before['Package'] == 'mount' and before['Version'] == spec['version'] == OLD
    assert before['Architecture'] == 'amd64' and before['Source'] == 'util-linux'
    assert before['Status'] == 'install ok installed'
    assert not any(before.get(k) for k in ('Essential', 'Protected', 'Provides', 'Depends', 'Conffiles'))
    old_dependency = 'libmount1 (= ' + OLD + ')'
    new_dependency = 'libmount1 (= ' + NEW + ')'
    assert before['Pre-Depends'] == (f'libblkid1 (= {OLD}), libc6 (>= 2.38), '
        f'libmount1 (= {OLD}), libselinux1 (>= 3.1~), libsmartcols1 (= {OLD})')
    assert before['Pre-Depends'].count(old_dependency) == 1
    updated = raw.replace('Pre-Depends: ' + before['Pre-Depends'],
                          'Pre-Depends: ' + before['Pre-Depends'].replace(old_dependency, new_dependency))
    updated = updated.replace('Version: ' + OLD + '\n', 'Version: ' + VERSION + '\n')
    updated = updated.replace('Source: util-linux\n', 'Source: util-linux (' + OLD + ')\n')
    updated = updated.replace('Status: install ok installed\n', '')
    after = fields(updated)
    assert set(after) == set(before) - {'Status'}
    assert after['Version'] == VERSION and after['Source'] == 'util-linux (' + OLD + ')'
    assert after['Pre-Depends'] == before['Pre-Depends'].replace(old_dependency, new_dependency)
    for key in set(before) - {'Status', 'Version', 'Source', 'Pre-Depends'}:
        assert after[key] == before[key]
    assert set(spec['controls']) == {'md5sums', 'list'}
    for item in spec['controls'].values():
        assert (item['kind'], item['mode'], item['uid'], item['gid']) == ('file', 0o644, 0, 0)
    md5 = (original / 'controls/md5sums').read_bytes()
    assert sha(md5) == spec['controls']['md5sums']['sha256']
    listed = (original / 'controls/list').read_bytes()
    assert sha(listed) == spec['controls']['list']['sha256']
    assert listed == (original / 'paths').read_bytes()
    payload = (original / 'payload.tar').read_bytes()
    assert len(payload) <= MAX_ARCHIVE
    assert sha(payload) == spec['payload_archive_sha256']
    output = io.BytesIO()
    expected = []
    with tarfile.open(fileobj=io.BytesIO(payload), mode='r:') as source, tarfile.open(
            fileobj=output, mode='w', format=tarfile.GNU_FORMAT) as target:
        seen = set()
        total = 0
        members = source.getmembers()
        assert len(members) <= MAX_MEMBERS
        by_name = {member.name: member for member in members}
        assert len(by_name) == len(members)
        by_path = {'/' + member.name.lstrip('/'): member for member in members}
        for member in members:
            assert 0 <= member.size <= MAX_MEMBER
            total += member.size
            assert total <= MAX_TOTAL
            assert member.isfile() or member.isdir() or member.issym() or member.islnk()
            assert not member.pax_headers and not member.sparse
            assert member.devmajor == member.devminor == 0
            path = '/' + member.name.lstrip('/')
            assert '..' not in Path(path).parts
            assert path in spec['files'] and path not in seen
            seen.add(path)
            item = spec['files'][path]
            assert (member.mode, member.uid, member.gid) == (item['mode'], item['uid'], item['gid'])
            content = source.extractfile(member).read() if member.isfile() else None
            if member.isfile():
                assert item['kind'] == 'file' and sha(content) == item['sha256']
            elif member.issym():
                assert item['kind'] == 'link' and member.linkname == item['target']
                linked, chain = member, {path}
                while linked.issym():
                    assert linked.linkname and '..' not in Path(linked.linkname).parts
                    current = '/' + linked.name.lstrip('/')
                    link_path = Path(linked.linkname) if linked.linkname.startswith('/') else Path(current).parent / linked.linkname
                    link_path = str(link_path)
                    assert link_path in spec['files'] and link_path in by_path, 'Symlink target escapes original mount payload'
                    assert link_path not in chain, 'Symlink cycle'
                    chain.add(link_path)
                    linked = by_path[link_path]
            elif member.isdir():
                assert item['kind'] == 'directory'
            else:
                # Original hardlinks remain hardlinks, including numeric metadata.
                assert item['kind'] == 'file'
                chain = {member.name}
                linked = member
                while linked.islnk():
                    assert '..' not in Path(linked.linkname).parts
                    assert linked.linkname in by_name and linked.linkname not in chain
                    chain.add(linked.linkname)
                    linked = by_name[linked.linkname]
                assert linked.isfile(), 'Hardlink does not end in an original regular file'
                assert sha(source.extractfile(member).read()) == item['sha256']
            normalized = copy.copy(member)
            normalized.name = member.name.lstrip('/')
            assert normalized.name and '..' not in Path(normalized.name).parts
            if member.islnk():
                normalized.linkname = member.linkname.lstrip('/')
                assert '..' not in Path(normalized.linkname).parts
            descriptor = normalized.get_info()
            descriptor.pop('chksum')
            expected.append((descriptor, sha(content) if content is not None else None))
            target.addfile(normalized, io.BytesIO(content) if content is not None else None)
        assert seen == set(spec['files'])
    data = output.getvalue()
    observed = []
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:') as archive:
        for member in archive:
            descriptor = member.get_info()
            descriptor.pop('chksum')
            observed.append((descriptor, sha(archive.extractfile(member).read()) if member.isfile() else None))
    assert observed == expected, 'Target TarInfo or file bytes changed'
    control = io.BytesIO()
    with tarfile.open(fileobj=control, mode='w', format=tarfile.GNU_FORMAT) as archive:
        for name, content, metadata in [('control', updated.encode(), {'mode': 0o644, 'uid': 0, 'gid': 0}),
                                        ('md5sums', md5, spec['controls']['md5sums'])]:
            member = tarfile.TarInfo('./' + name)
            member.mode, member.uid, member.gid = metadata['mode'], metadata['uid'], metadata['gid']
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
    result = (b'!<arch>\n' + ar_member('debian-binary', b'2.0\n') +
              ar_member('control.tar', control.getvalue()) + ar_member('data.tar', data))
    assert not destination.exists()
    with destination.open('xb') as stream:
        stream.write(result)
    receipt = {'kind': 'target-mount-metadata-only-package', 'status': 'constructed-unadmitted',
               'native_qualified': False, 'original_profile_sha256': sha((capture / 'profile.json').read_bytes()),
               'original_payload_archive_sha256': sha(payload), 'candidate_data_archive_sha256': sha(data),
               'candidate_sha256': sha(result), 'preserved_target_tarinfo_entries': len(expected),
               'changed_control_fields': ['Version', 'Source', 'Pre-Depends'], 'source_compiled': False}
    destination.with_suffix('.receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    construct(Path(sys.argv[1]), Path(sys.argv[2]))
