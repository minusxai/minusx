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


TEMPLATE_SHA256='3ca5ad64402f539c492010f961ebbb01745fed81875c151f615da697b5ca642c'
OLD="2.41.5-0+deb13u1"
NEW=OLD+"+security20261028"
SIBLINGS={"libblkid1","liblastlog2-2","libmount1","libsmartcols1","libuuid1"}
EMBEDDED_TEMPLATE='{\n  "libmount1": {\n    "original": {\n      "Architecture": "amd64",\n      "Breaks": "",\n      "Conflicts": "",\n      "Depends": "libblkid1 (= 2.41.5-0+deb13u1), libc6 (>= 2.38), libselinux1 (>= 3.1~)",\n      "Essential": "",\n      "Multi-Arch": "same",\n      "Package": "libmount1",\n      "Pre-Depends": "",\n      "Protected": "",\n      "Provides": "",\n      "Recommends": "",\n      "Replaces": "",\n      "Source": "util-linux",\n      "Suggests": "cryptsetup-bin",\n      "Version": "2.41.5-0+deb13u1"\n    },\n    "rebuilt": {\n      "Architecture": "amd64",\n      "Breaks": "",\n      "Conflicts": "",\n      "Depends": "libblkid1 (= 2.41.5-0+deb13u1+security20261028), libc6 (>= 2.38), libselinux1 (>= 3.1~)",\n      "Essential": "",\n      "Multi-Arch": "same",\n      "Package": "libmount1",\n      "Pre-Depends": "",\n      "Protected": "",\n      "Provides": "",\n      "Recommends": "",\n      "Replaces": "",\n      "Source": "util-linux",\n      "Suggests": "cryptsetup-bin",\n      "Version": "2.41.5-0+deb13u1+security20261028"\n    }\n  },\n  "login": {\n    "original": {\n      "Architecture": "amd64",\n      "Breaks": "",\n      "Conflicts": "",\n      "Depends": "libpam-modules, libpam-runtime, libaudit1 (>= 1:2.2.1), libc6 (>= 2.38), libcrypt1 (>= 1:4.1.0), libpam0g (>= 0.99.7.1)",\n      "Essential": "",\n      "Multi-Arch": "foreign",\n      "Package": "login",\n      "Pre-Depends": "login.defs (>= 1:4.16.0-1~)",\n      "Protected": "yes",\n      "Provides": "",\n      "Recommends": "",\n      "Replaces": "",\n      "Source": "util-linux (2.41.5-0+deb13u1)",\n      "Suggests": "",\n      "Version": "1:4.16.0-2+really2.41.5-0+deb13u1"\n    },\n    "rebuilt": {\n      "Architecture": "amd64",\n      "Breaks": "",\n      "Conflicts": "",\n      "Depends": "libpam-modules, libpam-runtime, libaudit1 (>= 1:2.2.1), libc6 (>= 2.38), libcrypt1 (>= 1:4.1.0), libpam0g (>= 0.99.7.1)",\n      "Essential": "",\n      "Multi-Arch": "foreign",\n      "Package": "login",\n      "Pre-Depends": "login.defs (>= 1:4.16.0-1~)",\n      "Protected": "yes",\n      "Provides": "",\n      "Recommends": "",\n      "Replaces": "",\n      "Source": "util-linux (2.41.5-0+deb13u1+security20261028)",\n      "Suggests": "",\n      "Version": "1:4.16.0-2+really2.41.5-0+deb13u1+security20261028"\n    }\n  },\n  "util-linux": {\n    "original": {\n      "Architecture": "amd64",\n      "Breaks": "",\n      "Conflicts": "hardlink",\n      "Depends": "",\n      "Essential": "yes",\n      "Multi-Arch": "foreign",\n      "Package": "util-linux",\n      "Pre-Depends": "libpam-modules, libpam-runtime, libblkid1 (= 2.41.5-0+deb13u1), libc6 (>= 2.41), libcap-ng0 (>= 0.7.9), libcrypt1 (>= 1:4.1.0), liblastlog2-2 (= 2.41.5-0+deb13u1), libmount1 (= 2.41.5-0+deb13u1), libpam0g (>= 0.99.7.1), libselinux1 (>= 3.1~), libsmartcols1 (= 2.41.5-0+deb13u1), libsystemd0, libtinfo6 (>= 6), libudev1 (>= 183), libuuid1 (= 2.41.5-0+deb13u1)",\n      "Protected": "",\n      "Provides": "hardlink",\n      "Recommends": "sensible-utils",\n      "Replaces": "hardlink",\n      "Source": "",\n      "Suggests": "dosfstools, kbd, util-linux-extra, util-linux-locales, wtmpdb",\n      "Version": "2.41.5-0+deb13u1"\n    },\n    "rebuilt": {\n      "Architecture": "amd64",\n      "Breaks": "",\n      "Conflicts": "hardlink",\n      "Depends": "",\n      "Essential": "yes",\n      "Multi-Arch": "foreign",\n      "Package": "util-linux",\n      "Pre-Depends": "libpam-modules, libpam-runtime, libblkid1 (= 2.41.5-0+deb13u1+security20261028), libc6 (>= 2.41), libcap-ng0 (>= 0.7.9), libcrypt1 (>= 1:4.1.0), liblastlog2-2 (= 2.41.5-0+deb13u1+security20261028), libmount1 (= 2.41.5-0+deb13u1+security20261028), libpam0g (>= 0.99.7.1), libselinux1 (>= 3.1~), libsmartcols1 (= 2.41.5-0+deb13u1+security20261028), libsystemd0, libtinfo6 (>= 6), libudev1 (>= 183), libuuid1 (= 2.41.5-0+deb13u1+security20261028)",\n      "Protected": "",\n      "Provides": "hardlink",\n      "Recommends": "sensible-utils",\n      "Replaces": "hardlink",\n      "Source": "",\n      "Suggests": "dosfstools, kbd, util-linux-extra, util-linux-locales, wtmpdb",\n      "Version": "2.41.5-0+deb13u1+security20261028"\n    }\n  }\n}\n'
def normalized(value):
    return re.sub(r'\s+',' ',value).strip()


def atoms(value):
    result=[]
    for part in normalized(value).split(','):
        part=part.strip()
        match=re.fullmatch(r'([a-z0-9][a-z0-9+.-]*)(?: \((=|>=|<=|>>|<<) ([^() ]+)\))?',part)
        assert match, 'Unexpected relationship grammar in pinned flat field'
        result.append(match.groups())
    assert len({row[0] for row in result})==len(result), 'Repeated dependency in pinned field'
    return result


def render(rows):
    return ', '.join(name+((' ('+operator+' '+version+')') if operator else '') for name,operator,version in rows)


def transform(controls):
    data=EMBEDDED_TEMPLATE.encode()
    assert hashlib.sha256(data).hexdigest()==TEMPLATE_SHA256, 'Template identity changed'
    expected=json.loads(data)
    assert set(controls)==set(expected), 'Unexpected package set'
    for package in expected:
        assert set(controls[package])==set(expected[package])
        for side in expected[package]:
            actual,known=controls[package][side],expected[package][side]
            assert set(actual)==set(known), 'Unexpected technical control fields'
            assert all(isinstance(value,str) for value in actual.values())
            assert {k:normalized(v) for k,v in actual.items()}=={k:normalized(v) for k,v in known.items()}, ('Unreviewed original/derived control delta',package,side)
    output=json.loads(json.dumps(controls))
    observed=[]
    for package,field,names in [('util-linux','Pre-Depends',SIBLINGS),('libmount1','Depends',{'libblkid1'})]:
        original=atoms(controls[package]['original'][field]);rebuilt=atoms(controls[package]['rebuilt'][field])
        assert [x[0] for x in original]==[x[0] for x in rebuilt]
        changed={old[0] for old,new in zip(original,rebuilt) if old!=new}
        assert changed==names
        final=[]
        for old,new in zip(original,rebuilt):
            if old[0] in names:
                assert old==(old[0],'=',OLD) and new==(old[0],'=',NEW)
                desired=NEW if old[0]=='libmount1' else OLD
                final.append((old[0],'=',desired))
                observed.append({'package':package,'field':field,'dependency':old[0],
                                 'original_version':OLD,'built_version':NEW,'proposed_version':desired})
            else:
                assert old==new;final.append(old)
        # Preserve original clause/operator topology, translating only selected
        # libmount1's exact identity. Unselected original constraints stay exact.
        original_target=[(name,op,NEW if name=='libmount1' and op=='=' and version==OLD else version) for name,op,version in original]
        assert final==original_target
        output[package]['rebuilt'][field]=render(final)
    assert len(observed)==6
    return {'status':'UNIMPLEMENTED-UNADMITTED-PREVIEW','metadata_accepted':False,'native_qualified':False,
            'requires_corrected_source_and_fresh_provider_reverse_graph_proof':True,
            'source_rebuild_selection_unchanged':['util-linux','libmount1','login'],
            'no_mount_repack_implemented':True,'observed_six_source_version_atoms':observed,'proposed_controls':output}




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



def retained_man_directory_mode(name, original, rebuilt):
    # Actual pristine image directories differ from source archive defaults.
    # Restore only these observed documentation directories, retaining the
    # complete original mode/ownership/type contract; other drift still fails.
    allowed = {'/usr/share/man/man1', '/usr/share/man/man5', '/usr/share/man/man8'}
    old = {'kind': 'directory', 'mode': 0o775, 'uid': 0, 'gid': 0}
    new = {'kind': 'directory', 'mode': 0o755, 'uid': 0, 'gid': 0}
    return 0o775 if name in allowed and original == old and rebuilt == new else None


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
    assert not diagnostic_original.get('Enhances') and not diagnostic_rebuilt.get('Enhances'), 'Unreviewed Enhances relationship'
    relationship_diagnostics[diagnostic_package] = {
        side: {field: re.sub(r'\s+', ' ', message.get(field, '')).strip()
               for field in relationship_fields}
        for side, message in [('original', diagnostic_original), ('rebuilt', diagnostic_rebuilt)]}
Path('/out/package-relationship-diagnostics.json').write_text(
    json.dumps(relationship_diagnostics, indent=2, sort_keys=True) + '\n')
# This replacement does not authenticate its own producer or qualify a mixed runtime.
# The caller must authenticate the frozen proof and explicitly review this candidate.
# Requiring exact proof identity prevents stale pre-correction artifacts from admission.
compile_path = Path('/out/compile-proof.json')
assert hashlib.sha256(compile_path.read_bytes()).hexdigest() == os.environ.get('UTIL_LINUX_COMPILE_PROOF_SHA256'), 'Authenticated proof digest required'
compile_identity = json.loads(compile_path.read_text())
assert compile_identity is not None, 'Authenticated frozen compile proof required in work inputs'
source_bytes = (recipe / 'source.json').read_bytes()
assert '20361d66df4d3f32d5e137fe61a55cdf156c91f0' in source_bytes.decode(), 'Corrected official prerequisite missing'
translated = transform(relationship_diagnostics)['proposed_controls']
Path('/out/proposed-install-set.json').write_text(json.dumps({
    'status': 'PROPOSED-ROOT-REVIEW-REQUIRED', 'native_qualified': False,
    'source_rebuilt': ['util-linux', 'libmount1', 'login'],
    'additional_metadata_only': ['mount'], 'new_installed_package_names': []}, indent=2)+'\n')
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
    # All technical fields were exact-guarded together before any mutation.
    # Retain original four provider identities and only update selected libmount.
    # Never concatenate contradictory old/new exact-version requirements.
    for field in ('Pre-Depends', 'Depends'):
        value = translated[package]['rebuilt'][field]
        expression = r'^' + re.escape(field) + r':.*(?:\n[ \t].*)*'
        if field in rebuilt:
            control_text, count = re.subn(expression, field + ': ' + value,
                                          control_text, count=1, flags=re.MULTILINE)
            assert count == 1
        elif value:
            control_text += field + ': ' + value + '\n'
    (control / 'control').write_text(control_text)
    preserved_non_native = {}
    for name, expected in baseline[package]['files'].items():
        path = root / name.lstrip('/')
        assert path.exists() or path.is_symlink(), ('Lost installed path', package, name)
        expected_metadata = {key: value for key, value in expected.items() if key not in ['sha256', 'native']}
        original_mode = retained_man_directory_mode(name, expected_metadata, metadata(path))
        if original_mode is not None:
            path.chmod(original_mode)
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
