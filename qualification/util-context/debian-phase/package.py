"""Bind the distro-built payloads to original interfaces and source/test proof."""
import hashlib
import json
import os
from pathlib import Path
from email.parser import Parser
import re
import shutil
import stat
import subprocess
import sys
import tarfile

mode, recipe_arg, work_arg = sys.argv[1:]
recipe, work = Path(recipe_arg), Path(work_arg)
proof = json.loads((recipe / 'source.json').read_text())


def run(*arguments):
    return subprocess.check_output(arguments, text=True).strip()


def native(path):
    return path.is_file() and not path.is_symlink() and path.open('rb').read(4) == b'\x7fELF'


def metadata(path):
    info = path.lstat()
    value = {'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid}
    if path.is_symlink():
        value.update(kind='link', target=os.readlink(path))
    elif path.is_dir():
        value['kind'] = 'directory'
    else:
        value['kind'] = 'file'
    return value


def exports(path):
    return sorted({tuple(line.split()[-2:]) for line in run('objdump', '-T', str(path)).splitlines()
                   if len(line.split()) >= 7 and '*UND*' not in line and '*ABS*' not in line})


if mode == 'snapshot':
    baseline = {}
    for package in proof['runtime_packages']:
        assert run('dpkg-query', '-W', '-f=${Version}', package) == proof['package_versions'][package]['original']
        original = work / 'original' / package
        payload = work / 'original-payload' / package
        files, library_exports = {}, {}
        with tarfile.open(original / 'payload.tar') as archive:
            for member in archive:
                name = str(Path('/' + member.name.lstrip('/')))
                assert '..' not in Path(name).parts
                item = {'mode': member.mode, 'uid': member.uid, 'gid': member.gid}
                if member.issym():
                    item.update(kind='link', target=member.linkname)
                elif member.isdir():
                    item['kind'] = 'directory'
                else:
                    assert member.isfile() or member.islnk(), (package, name)
                    data = archive.extractfile(member).read()
                    destination = payload / name.lstrip('/')
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(data)
                    item.update(kind='file', sha256=hashlib.sha256(data).hexdigest(), native=data[:4] == b'\x7fELF')
                    if item['native']:
                        # Freeze features/ABI only after proving bootstrap did
                        # not replace the pristine captured runtime payload.
                        assert hashlib.sha256(Path(name).read_bytes()).hexdigest() == item['sha256'], ('Bootstrap changed native payload', name)
                        if '.so.' in Path(name).name:
                            library_exports[name] = exports(Path(name))
                files[name] = item
        controls = {path.name: {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                'mode': stat.S_IMODE(path.stat().st_mode)}
                    for path in (original / 'controls').iterdir()}
        baseline[package] = {'files': files, 'library_exports': library_exports,
            'absent_documentation': (original / 'absent-documentation').read_text().splitlines(),
            'controls': controls, 'relationships': (original / 'status').read_text(),
            'pristine_payload_archive_sha256': hashlib.sha256((original / 'payload.tar').read_bytes()).hexdigest()}
    subprocess.run(['cc', '-O2', '-Wall', '-Wextra', '-Werror',
                    str(recipe / 'check-features.c'), '-Wl,-l:libmount.so.1',
                    '-o', '/out/check-features'], check=True)
    features = run('/out/check-features').splitlines()
    assert features and len(set(features)) == len(features)
    assert 'fd-based-mount' in features
    baseline['original_features'] = sorted(features)
    (work / 'original-features.h').write_text('static const char *const original_features[] = {\n' +
        ''.join('    ' + json.dumps(feature) + ',\n' for feature in sorted(features)) + '    NULL\n};\n')
    (work / 'baseline.json').write_text(json.dumps(baseline, indent=2) + '\n')
    sys.exit()

assert mode == 'package'
baseline = json.loads((work / 'baseline.json').read_text())

# Export technical control metadata before validation, including when validation
# deliberately fails. Never export process environment or full dpkg status.
relationship_fields = ('Package', 'Version', 'Source', 'Architecture', 'Essential',
    'Protected', 'Multi-Arch', 'Provides', 'Conflicts', 'Breaks', 'Replaces',
    'Pre-Depends', 'Depends', 'Recommends', 'Suggests')
relationship_diagnostics = {}
for diagnostic_package in proof['runtime_packages']:
    diagnostic_candidates = list(work.glob(diagnostic_package + '_' +
        proof['package_versions'][diagnostic_package]['rebuilt'].split(':', 1)[-1] + '_*.deb'))
    assert len(diagnostic_candidates) == 1, ('Diagnostic package count', diagnostic_package)
    diagnostic_original = Parser().parsestr(baseline[diagnostic_package]['relationships'])
    diagnostic_rebuilt = Parser().parsestr(run('dpkg-deb', '-f', str(diagnostic_candidates[0])))
    relationship_diagnostics[diagnostic_package] = {
        side: {field: re.sub(r'\s+', ' ', message.get(field, '')).strip()
               for field in relationship_fields}
        for side, message in [('original', diagnostic_original), ('rebuilt', diagnostic_rebuilt)]}
Path('/out/package-relationship-diagnostics.json').write_text(
    json.dumps(relationship_diagnostics, indent=2, sort_keys=True) + '\n')
all_native = {}
all_absent = set()
for package in proof['runtime_packages']:
    candidates = list(work.glob(package + '_' + proof['package_versions'][package]['rebuilt'].split(':', 1)[-1] + '_*.deb'))
    assert len(candidates) == 1, (package, candidates)
    root = work / ('proof-package-' + package)
    subprocess.run(['dpkg-deb', '--raw-extract', str(candidates[0]), str(root)], check=True)
    source = run('dpkg-deb', '-f', str(candidates[0]), 'Source')
    assert (source.split()[0] if source else package) == 'util-linux'
    control = root / 'DEBIAN'
    control_text = (control / 'control').read_text()
    original = Parser().parsestr(baseline[package]['relationships'])
    rebuilt = Parser().parsestr(control_text)
    assert rebuilt.get('Version') == proof['package_versions'][package]['rebuilt']
    def normalized(value):
        return re.sub(r'\s+', ' ', value or '').strip()
    for field in ['Package', 'Essential', 'Protected', 'Multi-Arch', 'Provides', 'Conflicts',
                  'Breaks', 'Replaces', 'Pre-Depends', 'Recommends', 'Suggests']:
        assert normalized(original.get(field)) == normalized(rebuilt.get(field)), ('Changed relationship', package, field, {'original': normalized(original.get(field)), 'rebuilt': normalized(rebuilt.get(field))})
    # Keep the original runtime dependency constraints as well as newly derived
    # shared-library requirements from the exact source build.
    dependencies = ', '.join(dict.fromkeys(normalized(part) for part in
        (original.get('Depends', '') + ',' + rebuilt.get('Depends', '')).split(',') if normalized(part)))
    if dependencies:
        if 'Depends' in rebuilt:
            control_text = re.sub(r'^Depends:.*(?:\n[ \t].*)*', 'Depends: ' + dependencies,
                                  control_text, count=1, flags=re.MULTILINE)
        else:
            control_text += 'Depends: ' + dependencies + '\n'
        (control / 'control').write_text(control_text)
    preserved_non_native = {}
    for name, expected in baseline[package]['files'].items():
        path = root / name.lstrip('/')
        assert path.exists() or path.is_symlink(), ('Lost installed path', package, name)
        expected_metadata = {key: value for key, value in expected.items() if key not in ['sha256', 'native']}
        assert metadata(path) == expected_metadata, ('Changed file interface', package, name, metadata(path), expected_metadata)
        # Security changes are C payloads. Retain all pristine configuration,
        # scripts, completion/localization and other runtime data byte-for-byte.
        # Source/changelog/manual documentation may reflect the rebuilt version.
        if expected['kind'] == 'file' and not expected['native'] and not name.startswith(('/usr/share/doc/', '/usr/share/man/')):
            original_file = work / 'original-payload' / package / name.lstrip('/')
            shutil.copyfile(original_file, path)
            assert hashlib.sha256(path.read_bytes()).hexdigest() == expected['sha256'], name
            preserved_non_native[name] = expected['sha256']
    preserved_controls = {}
    for name, expected in baseline[package]['controls'].items():
        if name == 'md5sums':
            continue
        original_file = work / 'original' / package / 'controls' / name
        shutil.copyfile(original_file, control / name)
        (control / name).chmod(expected['mode'])
        assert hashlib.sha256((control / name).read_bytes()).hexdigest() == expected['sha256']
        preserved_controls[name] = expected['sha256']
    for name, expected in baseline[package]['library_exports'].items():
        assert not set(map(tuple, expected)) - set(exports(root / name.lstrip('/'))), ('Lost ABI', name)
    native_hashes = {'/' + str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
                     for path in root.rglob('*') if native(path) and 'DEBIAN' not in path.parts}
    assert native_hashes, package
    all_native.update(native_hashes)
    doc = root / 'usr/share/doc' / package / 'runtime-security'
    doc.mkdir(parents=True, exist_ok=True)
    for filename in ['source.json', 'SHA256SUMS']:
        shutil.copy2(recipe / filename, doc / filename)
    shutil.copytree(recipe / 'patches', doc / 'patches')
    shutil.copy2('/out/source-regression.json', doc / 'source-regression.json')
    shutil.copy2('/out/idmap-header-regression.json', doc / 'idmap-header-regression.json')
    shutil.copy2('/out/openat-resolve-regression.json', doc / 'openat-resolve-regression.json')
    configuration = work / 'runtime-config.h'
    shutil.copy2(configuration, doc / 'runtime-config.h')
    (doc / 'receipt.json').write_text(json.dumps({
        'package': package, 'source_version': proof['source_version'],
        'version': proof['package_versions'][package]['rebuilt'], 'native_sha256': native_hashes,
        'source_checksums': proof['source_files'], 'patches': proof['patches'],
        'regular_runtime_config_sha256': hashlib.sha256(configuration.read_bytes()).hexdigest(),
        'upstream_tests': 'Unmodified Linux dh_auto_test --max-parallel=1 in full dpkg-buildpackage',
        'test_log_sha256': hashlib.sha256(Path('/out/source-build.log').read_bytes()).hexdigest(),
        'original_paths_modes_owners_symlinks_preserved': True,
        'original_absent_documentation': baseline[package]['absent_documentation'],
        'original_non_native_runtime_sha256': preserved_non_native,
        'original_maintainer_controls_sha256': preserved_controls,
        'original_features': baseline['original_features'],
        'pristine_payload_archive_sha256': baseline[package]['pristine_payload_archive_sha256'],
        'original_library_exports_preserved': True,
    }, indent=2) + '\n')
    # Preserve the image's original documentation omissions after replacement.
    # Keep build/source receipts in /out even if their documentation directory
    # was absent from the original image and must therefore stay absent.
    receipt_copy = Path('/out/package-receipts') / package
    receipt_copy.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(doc, receipt_copy)
    policy = Path('/out/pristine-package-profile/dpkg-docker.cfg')
    if policy.is_file():
        shutil.copy2(policy, receipt_copy / 'original-dpkg-docker.cfg')
    absent = baseline[package]['absent_documentation']
    for name in sorted(absent, key=lambda value: len(Path(value).parts), reverse=True):
        documentation = name == '/usr/share/doc' or name.startswith('/usr/share/doc/') or name == '/usr/share/man' or name.startswith('/usr/share/man/')
        lintian = name in ['/usr/share/lintian', '/usr/share/lintian/overrides'] or name.startswith('/usr/share/lintian/overrides/')
        if lintian:
            policy = Path('/out/pristine-package-profile/dpkg-docker.cfg').read_text()
            assert 'path-exclude /usr/share/lintian/overrides/*' in policy.splitlines()
        assert documentation or lintian, name
        path = root / name.lstrip('/')
        if path.is_symlink() or path.is_file():
            path.unlink()
        elif path.is_dir():
            shutil.rmtree(path)
        assert not path.exists() and not path.is_symlink(), name
        all_absent.add(name)
    (control / 'md5sums').write_text(''.join(
        hashlib.md5(path.read_bytes()).hexdigest() + '  ' + str(path.relative_to(root)) + '\n'
        for path in sorted(root.rglob('*')) if path.is_file() and not path.is_symlink() and control not in path.parents))
    subprocess.run(['dpkg-deb', '--build', str(root), '/out/' + package + '.deb'], check=True)
Path('/out/runtime-payload.sha256').write_text(''.join(digest + '  ' + name + '\n'
                                                     for name, digest in sorted(all_native.items())))

Path('/out/runtime-absent.paths').write_text(''.join(name + '\n' for name in sorted(all_absent)))
Path('/out/check-absence.sh').write_text("#!/bin/sh\nset -eu\npaths=${1:?absence path list required}\nwhile IFS= read -r path; do\n    if test -e \"$path\" || test -L \"$path\"; then\n        printf 'Unexpected original absent path: %s\\n' \"$path\" >&2\n        exit 1\n    fi\ndone < \"$paths\"\n")
Path('/out/check-absence.sh').chmod(0o755)
