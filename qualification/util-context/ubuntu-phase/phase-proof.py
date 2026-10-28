"""Freeze successful compilation; verify it before strict runtime packaging.

The proof digest must be authenticated by the caller/artifact transport. Read-only
permissions are defense in depth, not an authenticity or kernel immutability claim.
"""
from email.parser import Parser
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tarfile


def versions(specification, package):
    assert package in specification['runtime_packages'], 'Unselected runtime package'
    if 'package_versions' in specification:
        value = specification['package_versions'][package]
        assert set(value) == {'original', 'rebuilt'}
        return value
    # Ubuntu's approved recipe uses a common source/runtime version for its
    # selected binaries. Preserve that schema rather than inventing a map.
    return {'original': specification['source_version'],
            'rebuilt': specification['runtime_version']}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inventory(root, paths):
    result = {}
    for path in sorted(set(paths)):
        relative = str(path.relative_to(root))
        assert '..' not in Path(relative).parts
        info = path.lstat()
        value = {'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid}
        if path.is_symlink():
            value.update(kind='link', target=os.readlink(path))
        elif path.is_dir():
            value.update(kind='directory')
        else:
            assert path.is_file(), ('Unsupported proof file', relative)
            value.update(kind='file', sha256=digest(path))
        result[relative] = value
    return result


def descendants(path):
    assert path.exists() and not path.is_symlink(), ('Missing proof input', path.name)
    return [path, *path.rglob('*')] if path.is_dir() else [path]


def collect(recipe, work, output, specification):
    work_paths = []
    for name in ['original', 'original-payload', 'baseline.json',
                 'runtime-config.h', 'original-features.h']:
        work_paths.extend(descendants(work / name))
    selected = {}
    for package in specification['runtime_packages']:
        matches = list(work.glob(package + '_' +
            versions(specification, package)['rebuilt'].split(':', 1)[-1] + '_*.deb'))
        assert len(matches) == 1, ('Compiled package count', package)
        selected[package] = matches[0].name
        work_paths.extend(matches)
    output_paths = []
    for name in ['source-build.log', 'source-regression.json',
                 'idmap-header-regression.json', 'check-util-linux', 'check-features',
                 'pristine-package-profile', 'compiled-package-controls.json']:
        output_paths.extend(descendants(output / name))
    if (recipe / 'check-idmap-wrapper.py').is_file():
        output_paths.extend(descendants(output / 'wrapper-regression.json'))
    return {'schema': 1, 'kind': 'util-source-compile-inputs',
            'status': 'compile-only-unadmitted', 'installed_native_qualification': False, 'recipe': inventory(recipe, recipe.rglob('*')),
            'work': inventory(work, work_paths), 'output': inventory(output, output_paths),
            'selected_compiled_packages': selected,
            'source_files': specification['source_files'], 'patches': specification['patches'],
            'recipe_manifest': (recipe / 'SHA256SUMS').read_text()}


def main():
    mode, recipe_arg, work_arg, output_arg = sys.argv[1:]
    assert mode in ('freeze', 'verify')
    recipe, work, output = map(Path, (recipe_arg, work_arg, output_arg))
    specification = json.loads((recipe / 'source.json').read_text())
    proof_path = output / 'compile-proof.json'
    if mode == 'freeze':
        assert not proof_path.exists(), 'Refusing to overwrite compile proof'
        fields = ('Package', 'Version', 'Source', 'Architecture', 'Essential',
                  'Protected', 'Multi-Arch', 'Provides', 'Conflicts', 'Breaks',
                  'Replaces', 'Pre-Depends', 'Depends', 'Recommends', 'Suggests')
        controls = {}
        for package in specification['runtime_packages']:
            candidates = list(work.glob(package + '_' +
                versions(specification, package)['rebuilt'].split(':', 1)[-1] + '_*.deb'))
            assert len(candidates) == 1, ('Compiled control package count', package)
            original = Parser().parsestr((work / 'original' / package / 'status').read_text())
            rebuilt = Parser().parsestr(subprocess.check_output(
                ['dpkg-deb', '-f', str(candidates[0])], text=True))
            controls[package] = {side: {field: re.sub(r'\s+', ' ', message.get(field, '')).strip()
                for field in fields} for side, message in [('original', original), ('rebuilt', rebuilt)]}
        (output / 'compiled-package-controls.json').write_text(json.dumps(controls, indent=2, sort_keys=True) + '\n')
        proof = collect(recipe, work, output, specification)
        proof['compiled_source_inventory'] = inventory(work / 'source', (work / 'source').rglob('*'))
        # Full original metadata and actual compiled debs can be inspected even
        # when subsequent strict package metadata validation deliberately fails.
        export = output / 'compile-inputs'
        export.mkdir()
        for name in ['baseline.json', 'runtime-config.h', 'original-features.h']:
            shutil.copy2(work / name, export / name)
        for name in ['original', 'original-payload']:
            shutil.copytree(work / name, export / name, symlinks=True)
        for name in proof['selected_compiled_packages'].values():
            shutil.copy2(work / name, export / name)
        # Preserve recorded numeric ownership across artifact transport. Local
        # exporters need not retain it, so package consumers restore this tar
        # with numeric ownership in a root-owned isolated build stage.
        for path in export.rglob('*'):
            original = work / path.relative_to(export)
            info = original.lstat()
            os.chown(path, info.st_uid, info.st_gid, follow_symlinks=False)
        with tarfile.open(output / 'compile-inputs.tar', 'w') as archive:
            archive.add(export, arcname='.', recursive=True)
        proof['compile_inputs_archive_sha256'] = digest(output / 'compile-inputs.tar')
        proof['export'] = inventory(export, export.rglob('*'))
        proof_path.write_text(json.dumps(proof, indent=2, sort_keys=True) + '\n')
        proof_path.chmod(0o444)
        (output / 'compile-proof.sha256').write_text(digest(proof_path) + '  compile-proof.json\n')
        return
    expected = os.environ.get('UTIL_LINUX_COMPILE_PROOF_SHA256', '')
    assert re.fullmatch('[0-9a-f]{64}', expected), 'Authenticated compile proof SHA256 required'
    assert digest(proof_path) == expected, 'Compile proof digest mismatch'
    proof = json.loads(proof_path.read_text())
    actual = collect(recipe, work, output, specification)
    # Only a separately authenticated packaging implementation may differ from
    # the compile recipe. Never permit replacement source/build/test inputs.
    replacement = os.environ.get('UTIL_LINUX_PACKAGE_IMPLEMENTATION_SHA256')
    if replacement is not None:
        assert re.fullmatch('[0-9a-f]{64}', replacement)
        assert actual['recipe']['package.py']['sha256'] == replacement
        assert actual['recipe']['package.py']['kind'] == 'file'
        original = dict(proof['recipe']['package.py'])
        current = dict(actual['recipe']['package.py'])
        del original['sha256'], current['sha256']
        assert original == current
        actual['recipe']['package.py'] = proof['recipe']['package.py']
        expected_manifest = proof['recipe_manifest'].replace(
            proof['recipe']['package.py']['sha256'] + '  package.py\n',
            replacement + '  package.py\n')
        assert actual['recipe_manifest'] == expected_manifest, 'Unapproved manifest replacement'
        manifest_current = dict(actual['recipe']['SHA256SUMS'])
        manifest_original = dict(proof['recipe']['SHA256SUMS'])
        del manifest_current['sha256'], manifest_original['sha256']
        assert manifest_current == manifest_original
        actual['recipe']['SHA256SUMS'] = proof['recipe']['SHA256SUMS']
        actual['recipe_manifest'] = proof['recipe_manifest']
    assert actual == {key: value for key, value in proof.items() if key not in ('export', 'compiled_source_inventory', 'compile_inputs_archive_sha256')}, 'Frozen compile input changed'
    assert digest(output / 'compile-inputs.tar') == proof['compile_inputs_archive_sha256'], 'Compile archive changed'
    assert inventory(output / 'compile-inputs', (output / 'compile-inputs').rglob('*')) == proof['export'], 'Export changed'
    baseline = json.loads((work / 'baseline.json').read_text())
    for package in specification['runtime_packages']:
        version = subprocess.check_output(['dpkg-query', '-W', '-f=${Version}', package], text=True).strip()
        assert version == versions(specification, package)['original'], ('Original version changed', package)
        for name, item in baseline[package]['files'].items():
            if item.get('native'):
                assert digest(Path(name)) == item['sha256'], ('Original native bytes changed', name)
    features = subprocess.check_output([str(output / 'check-features')], text=True).splitlines()
    assert sorted(features) == baseline['original_features'], 'Original features changed'


if __name__ == '__main__':
    main()
