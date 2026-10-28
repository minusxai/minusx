"""Compare authenticated source original numeric archive with fresh target capture.
No installation, package reconstruction, or native admission.
"""
import hashlib
import io
import json
from pathlib import Path
from email.parser import Parser
import tarfile
import sys

SOURCE_EVIDENCE_SHA256 = '0f457ab945c8e15ef0be3aceab29b1cdd4d459992c31886e12a896b29bd5c431'
SOURCE_ARCHIVE_SHA256 = 'c2244d9465e04b30186d2048a6f29fc1741836be1fd0c43671c9109433539f94'
SELECTED = {'libmount1', 'util-linux', 'login', 'mount'}
PROVIDERS = {'libblkid1', 'liblastlog2-2', 'libsmartcols1', 'libuuid1'}
sha = lambda data: hashlib.sha256(data).hexdigest()


def inventory(data):
    assert len(data) <= 32 * 1024 * 1024
    result = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:') as archive:
        members = archive.getmembers()
        assert len(members) <= 4096
        by_name = {member.name: member for member in members}
        assert len(by_name) == len(members)
        total = 0
        for member in members:
            assert member.isfile() or member.isdir() or member.issym() or member.islnk()
            assert not member.pax_headers and not member.sparse
            assert member.devmajor == member.devminor == 0
            assert 0 <= member.size <= 16 * 1024 * 1024
            path = '/' + (member.name.removeprefix('./').lstrip('/') or '.')
            assert '..' not in Path(path).parts and path not in result
            value = {'mode': member.mode, 'uid': member.uid, 'gid': member.gid}
            if member.issym():
                value.update(kind='link', target=member.linkname)
            elif member.isdir():
                value['kind'] = 'directory'
            else:
                linked, chain = member, {member.name}
                while linked.islnk():
                    assert '..' not in Path(linked.linkname).parts
                    assert linked.linkname in by_name and linked.linkname not in chain
                    chain.add(linked.linkname)
                    linked = by_name[linked.linkname]
                assert linked.isfile() and 0 <= linked.size <= 16 * 1024 * 1024
                total += linked.size
                assert total <= 32 * 1024 * 1024
                data = archive.extractfile(member).read()
                value.update(kind='file', size=len(data), sha256=sha(data))
                if member.islnk():
                    value['hardlink_target'] = '/' + linked.name.removeprefix('./').lstrip('/')
            result[path] = value
    return result


def compare(source, target):
    manifest_bytes = (source / 'compile-evidence.json').read_bytes()
    assert sha(manifest_bytes) == SOURCE_EVIDENCE_SHA256, 'Source evidence manifest changed'
    manifest = json.loads(manifest_bytes)
    assert manifest['status'] == 'compile-only-unadmitted'
    assert manifest['installed_native_qualification'] is False
    archive_path = source / 'compile-inputs.tar'
    assert sha(archive_path.read_bytes()) == manifest['files']['compile-inputs.tar']['sha256'] == SOURCE_ARCHIVE_SHA256
    profile = json.loads((target / 'profile.json').read_text())
    assert profile['kind'] == 'util-consumer-original-capture'
    assert profile['status'] == 'capture-only-unadmitted'
    assert set(profile['selected_packages']) == SELECTED
    assert set(profile['unchanged_provider_packages']) == PROVIDERS
    assert set(profile['packages']) == SELECTED | PROVIDERS
    assert sha((target / 'raw-status').read_bytes()) == profile['raw_status_sha256']
    policy_name = 'pristine-package-profile/dpkg-docker.cfg'
    policy = (source / policy_name).read_bytes()
    assert sha(policy) == manifest['files'][policy_name]['sha256']
    assert (target / 'dpkg-docker.cfg').read_bytes() == policy
    assert profile['dpkg_policy']['kind'] == 'file' and profile['dpkg_policy']['sha256'] == sha(policy)
    names = SELECTED | PROVIDERS
    results = {}
    with tarfile.open(archive_path, mode='r:') as archive:
        members = {member.name: member for member in archive}
        assert len(members) == len(archive.getmembers()), 'Duplicate source archive member'
        def read(name):
            member = members[name]
            assert member.isfile() and 0 <= member.size <= 32 * 1024 * 1024
            return archive.extractfile(member).read()
        for name in sorted(names):
            prefix = './original/' + name + '/'
            original = target / name
            spec = profile['packages'][name]
            status = read(prefix + 'status')
            assert status == (original / 'status').read_bytes(), ('Original status differs', name)
            assert sha(status) == spec['status_sha256']
            parsed = Parser().parsestr(status.decode())
            assert not parsed.defects and len(parsed.keys()) == len(set(parsed.keys()))
            assert parsed['Package'] == name and parsed['Version'] == spec['version']
            assert parsed['Status'] == 'install ok installed' and parsed['Architecture'] == 'amd64'
            for label in ('paths', 'present-paths', 'absent-documentation'):
                assert read(prefix + label) == (original / label).read_bytes(), (name, label)
            paths = (original / 'paths').read_text().splitlines()
            present = (original / 'present-paths').read_text().splitlines()
            absent = (original / 'absent-documentation').read_text().splitlines()
            assert len(paths) == len(set(paths)) and len(present) == len(set(present))
            assert len(absent) == len(set(absent)) and not set(present) & set(absent)
            assert set(paths) == set(present) | set(absent) and absent == spec['absent_paths']
            payload = (original / 'payload.tar').read_bytes()
            assert sha(payload) == spec['payload_archive_sha256']
            actual = inventory(payload)
            assert actual == inventory(read(prefix + 'payload.tar')), ('Original interface/topology differs', name)
            observed_files = {path: {key: value for key, value in item.items() if key != 'hardlink_target'}
                              for path, item in actual.items()}
            assert observed_files == spec['files'], ('Captured filesystem differs', name)
            assert set(actual) == set(present)
            expected_controls = {}
            for path, member in members.items():
                if not path.startswith(prefix + 'controls/') or member.isdir():
                    continue
                label = path[len(prefix + 'controls/'):]
                assert '/' not in label and member.isfile()
                data = read(path)
                item = {'kind': 'file', 'mode': member.mode, 'uid': member.uid, 'gid': member.gid,
                        'size': len(data), 'sha256': sha(data)}
                assert item == spec['controls'][label]
                assert data == (original / 'controls' / label).read_bytes()
                expected_controls[label] = item
            internal = {'list'} | ({'conffiles'} if parsed.get('Conffiles') else set())
            assert set(spec['controls']) == set(expected_controls) | internal
            assert {p.name for p in (original / 'controls').iterdir()} == set(spec['controls'])
            for label, item in spec['controls'].items():
                data = (original / 'controls' / label).read_bytes()
                assert len(data) == item['size'] and sha(data) == item['sha256']
                if label in internal:
                    assert item['kind'] == 'file' and (item['mode'], item['uid'], item['gid']) == (0o644, 0, 0)
            assert (original / 'controls/list').read_bytes() == (original / 'paths').read_bytes()
            if 'conffiles' in internal:
                expected = [line.split()[0] for line in parsed['Conffiles'].splitlines() if line.strip()]
                assert (original / 'controls/conffiles').read_text().splitlines() == expected
            results[name] = {'paths': len(actual), 'controls': len(spec['controls']), 'absences': len(absent)}
    return {'kind': 'util-source-target-family-comparison', 'status': 'family-matched-unadmitted',
            'native_qualified': False, 'source_numeric_archive_sha256': SOURCE_ARCHIVE_SHA256,
            'target_profile_sha256': sha((target / 'profile.json').read_bytes()),
            'target_status_sha256': profile['raw_status_sha256'], 'packages': results,
            'comparison': 'file bytes, links, modes, numeric owners, full original status/controls/Conffiles and absences; directory mtimes remain target-specific'}


if __name__ == '__main__':
    result = compare(Path(sys.argv[1]), Path(sys.argv[2]))
    Path(sys.argv[3]).write_text(json.dumps(result, indent=2) + '\n')
