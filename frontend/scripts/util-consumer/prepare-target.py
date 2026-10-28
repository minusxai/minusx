"""Prepare a four-package target plan from authenticated immutable inputs.
No package installation or native admission. Run with a readonly resolver closure.
"""
import hashlib
import json
from pathlib import Path
import runpy
import shutil
import subprocess
import sys

here = Path(__file__).parent
original_helpers = runpy.run_path(str(here / 'compare-original.py'))
compare, inventory = original_helpers['compare'], original_helpers['inventory']
construct = runpy.run_path(str(here / 'make-target-mount.py'))['construct']
sha = lambda data: hashlib.sha256(data).hexdigest()


def payload(data):
    return {path: {key: value for key, value in item.items() if key != 'size'}
            for path, item in inventory(data).items()}


def prepare(source, native, target, out):
    comparison = compare(source, target)
    source_manifest = json.loads((source / 'compile-evidence.json').read_text())
    source_actual = {str(p.relative_to(source)) for p in source.rglob('*') if p.is_file()}
    assert source_actual == set(source_manifest['files']) | {'compile-evidence.json', 'authenticated-producer.json'}
    for name, spec in source_manifest['files'].items():
        path = source / name
        assert not path.is_symlink() and path.stat().st_size == spec['size']
        assert sha(path.read_bytes()) == spec['sha256']
    lock = json.loads((here / 'native-candidate.lock.json').read_text())
    assert lock['run_id'] == 40738744322 and lock['head'] == '630fca6aad165141dd27b38d8fe230e882e15371'
    actual = {str(p.relative_to(native)) for p in native.rglob('*') if p.is_file()}
    assert actual == set(lock['files']), 'Closed authenticated native input required'
    for name, spec in lock['files'].items():
        path = native / name
        assert not path.is_symlink()
        assert path.stat().st_size == spec['size'] and sha(path.read_bytes()) == spec['sha256']
    proof = native / 'util-native-proof'
    candidate = native / 'util-package-candidate'
    read = lambda name: json.loads((proof / name).read_text())
    summary = read('package-native-candidate.json')
    assert summary['kind'] == 'util-package-native-candidate'
    assert summary['status'] == 'package-native-gates-passed-unadmitted' and summary['native_admitted'] is False
    assert summary['source_compiled_in_this_workflow'] is False
    assert read('independent-gates.json') == {'kind': 'util-native-independent-gates', 'status': 'unadmitted',
        'namespace': 1, 'observation': 0, 'final': 0, 'apt': 0, 'audit': 0}
    # The default builder's namespace denial remains recorded. Independently
    # accepted capable-kernel proof covers both binaries and both cwd variants.
    kernel = read('namespace-kernel-proof.json')
    provenance = read('namespace-image-provenance.json')
    assert kernel['kind'] == 'isolated-namespace-kernel-proof'
    assert kernel['capabilities'] == ['SYS_ADMIN', 'SYS_CHROOT'] and kernel['default_security_policy'] is True
    results = kernel['results']
    assert len(results) == 4 and {(r['profile'], r['cwd']) for r in results} == {
        ('original', False), ('original', True), ('candidate', False), ('candidate', True)}
    for result in results:
        assert result['passed'] is True and type(result['exit_code']) is int and result['exit_code'] == 0
        assert type(result['transport_exit']) is int and result['transport_exit'] == 0
        assert result['image_id'] == provenance['images'][result['profile']]['image_id']
    profile = json.loads((target / 'profile.json').read_text())
    assert provenance['images']['original']['nsenter_sha256'] == profile['packages']['util-linux']['files']['/usr/bin/nsenter']['sha256']
    plan = json.loads((candidate / 'plan.json').read_text())
    assert set(plan['packages']) == {'libmount1', 'util-linux', 'login', 'mount'}
    assert not out.exists()
    out.mkdir()
    packages = out / 'packages'
    packages.mkdir()
    source_proof = out / 'source-proof'
    source_proof.mkdir()
    for name in ('source-build.log', 'source-suite-summary.json', 'source-regression.json',
                 'idmap-header-regression.json', 'openat-resolve-regression.json',
                 'compile-evidence.json', 'compile-proof.sha256', 'build-execution.json',
                 'source-stage-observation.json'):
        shutil.copyfile(source / name, source_proof / name)
    native_proof = out / 'accepted-isolated-proof'
    native_proof.mkdir()
    for name in ('package-native-candidate.json', 'namespace-kernel-proof.json',
                 'namespace-image-provenance.json', 'independent-gates.json', 'native-status.json'):
        shutil.copyfile(proof / name, native_proof / name)
    for name in ('libmount1', 'util-linux', 'login'):
        original = candidate / 'packages' / (name + '.deb')
        assert sha(original.read_bytes()) == plan['packages'][name]['sha256']
        shutil.copyfile(original, packages / original.name)
    construct(target, packages / 'mount.deb')
    plan['packages']['mount']['sha256'] = sha((packages / 'mount.deb').read_bytes())
    plan['status_sha256'] = profile['raw_status_sha256']
    (out / 'plan.json').write_text(json.dumps(plan, sort_keys=True, indent=2) + '\n')
    expected = {}
    excluded_provenance = set()
    provenance_directories = {}
    for name in profile['packages']:
        for path, item in payload((target / name / 'payload.tar').read_bytes()).items():
            if path in expected:
                assert expected[path] == item
            expected[path] = item
    for name in plan['packages']:
        archive = subprocess.check_output(['dpkg-deb', '--fsys-tarfile', str(packages / (name + '.deb'))])
        items = payload(archive)
        present = set(profile['packages'][name]['files'])
        assert present <= set(items), ('Candidate dropped original interface path', name)
        extra = set(items) - present
        provenance_root = '/usr/share/doc/' + name + '/runtime-security'
        assert name != 'mount' or not extra
        assert all(path == provenance_root or path.startswith(provenance_root + '/') for path in extra)
        # The original slim policy excludes these new source-proof documents.
        # Preserve that actual policy and prove absence; evidence is exported
        # separately from the authenticated source artifact.
        assert 'path-exclude /usr/share/doc/*' in (target / 'dpkg-docker.cfg').read_text().splitlines()
        for path in extra:
            item = items[path]
            if item['kind'] == 'directory':
                assert item == {'kind': 'directory', 'mode': 0o755, 'uid': 0, 'gid': 0}
                provenance_directories[path] = item
            else:
                assert item['kind'] == 'file'
                excluded_provenance.add(path)
        for path, item in items.items():
            if path in extra:
                continue
            before = expected[path]
            if item['kind'] == 'directory':
                assert item == before
            expected[path] = item
        if name == 'util-linux':
            assert items['/usr/bin/nsenter']['sha256'] == provenance['images']['candidate']['nsenter_sha256']
    manifest = {'kind': 'util-final-native-and-original-provider-manifest', 'paths': expected,
                'unchanged_provider_packages': ['libblkid1', 'liblastlog2-2', 'libsmartcols1', 'libuuid1']}
    (out / 'final-native-manifest.json').write_text(json.dumps(manifest, sort_keys=True, indent=2) + '\n')
    checksums = ''.join(item['sha256'] + '  ' + path + '\n' for path, item in sorted(expected.items()) if item['kind'] == 'file')
    (out / 'runtime-payload.sha256').write_text(checksums)
    absent = sorted({path for spec in profile['packages'].values() for path in spec['absent_paths']} | excluded_provenance)
    (out / 'runtime-absent.paths').write_text('\n'.join(absent) + '\n')
    (out / 'provenance-directories.json').write_text(json.dumps({
        'kind': 'util-new-provenance-directory-policy', 'dpkg_policy_sha256': profile['dpkg_policy']['sha256'],
        'paths': provenance_directories}, sort_keys=True, indent=2) + '\n')
    for name in ('check-absence.sh', 'check-util-linux'):
        shutil.copyfile(candidate / name, out / name)
        (out / name).chmod(0o755)
    (out / 'source-target-comparison.json').write_text(json.dumps(comparison, indent=2) + '\n')
    shutil.copyfile(target / 'raw-status', out / 'original-status')
    (out / 'preparation.json').write_text(json.dumps({'kind': 'util-target-preparation', 'status': 'prepared-unadmitted',
        'native_qualified': False, 'source_compiled': False, 'accepted_namespace_run': lock['run_id'],
        'original_target_profile_sha256': sha((target / 'profile.json').read_bytes()),
        'source_target_comparison_sha256': sha((out / 'source-target-comparison.json').read_bytes()),
        'plan_sha256': sha((out / 'plan.json').read_bytes()), 'final_manifest_sha256': sha((out / 'final-native-manifest.json').read_bytes()),
        'provenance_directories_sha256': sha((out / 'provenance-directories.json').read_bytes())}, indent=2) + '\n')


if __name__ == '__main__':
    prepare(*(Path(argument) for argument in sys.argv[1:]))
