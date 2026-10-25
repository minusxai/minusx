"""Preserve installed interfaces, replace upstream payloads, and derive package ABI."""
import json
import hashlib
import os
import tempfile
import re
from pathlib import Path
import shutil
import subprocess
import sys

mode, stage_arg, out_arg = sys.argv[1:]
stage, out = Path(stage_arg), Path(out_arg)
triplet = subprocess.check_output(['dpkg-architecture', '-qDEB_HOST_MULTIARCH'], text=True).strip()
arch = subprocess.check_output(['dpkg', '--print-architecture'], text=True).strip()
version = {'coreutils': '9.12-1+runtime1', 'ncurses': '6.6-1+runtime1', 'dash': '0.5.12+libcfnmatch-1+runtime1'}[mode]
packages = ['libtinfo6', 'ncurses-bin', 'ncurses-base'] if mode == 'ncurses' else [mode]
if mode == 'ncurses' and subprocess.run(['dpkg-query', '-W', '-f=${db:Status-Status}', 'libncursesw6'], capture_output=True, text=True).stdout == 'installed':
    packages.append('libncursesw6')

def normalized(path):
    for prefix in ('/bin/', '/sbin/', '/lib/', '/lib64/'):
        if path.startswith(prefix):
            return '/usr' + path
    return path

def copy(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_symlink() or destination.exists():
        destination.unlink()
    shutil.copy2(source, destination, follow_symlinks=False)

def exports(path):
    text = subprocess.check_output(['objdump', '-T', str(path)], text=True)
    return {tuple(line.split()[-2:]) for line in text.splitlines()
            if len(line.split()) >= 7 and '*UND*' not in line and '*ABS*' not in line}

roots = {}
for package in packages:
    root = Path('/packages') / package
    root.mkdir(parents=True, exist_ok=True)
    files = subprocess.check_output(['dpkg-query', '-L', package], text=True).splitlines()
    replaced = []
    for original in files:
        src = Path(original)
        if not (src.is_file() or src.is_symlink()):
            continue
        name = normalized(original)
        dest = root / name.lstrip('/')
        # ncurses libraries are replaced as complete new SONAME families below.
        if package in ('libtinfo6', 'libncursesw6') and '.so' in src.name:
            continue
        candidate = stage / name.lstrip('/')
        if package == 'coreutils' and name == '/usr/sbin/chroot':
            candidate = stage / 'usr/bin/chroot'
        binary = name.startswith(('/usr/bin/', '/usr/sbin/', '/usr/libexec/'))
        data = package == 'ncurses-base' and name.startswith(('/usr/share/terminfo/', '/usr/lib/terminfo/', '/usr/share/tabset/'))
        if data and name.startswith('/usr/lib/terminfo/'):
            candidate = stage / 'usr/share/terminfo' / name.removeprefix('/usr/lib/terminfo/')
        if binary or data:
            derivation = {}
            if binary and not (candidate.is_file() or candidate.is_symlink()) and src.is_symlink():
                rebuilt_target = stage / normalized(str(src.resolve())).lstrip('/')
                assert rebuilt_target.is_file(), f'No rebuilt target for installed alias {original}'
                copy(src, dest)
                replaced.append({'installed': original, 'retained_alias': os.readlink(src), 'rebuilt_target': str(rebuilt_target)})
                continue
            if data and '/terminfo/' in name and not (candidate.is_file() or candidate.is_symlink()):
                # Debian carries terminal definitions not shipped in the upstream database.
                # Reconstruct the exact installed entry and compile it using the rebuilt tic.
                definition = subprocess.check_output(['/usr/bin/infocmp', '-x', '-I', '-A', str(src.parent.parent), src.name])
                # Compiled Debian database aliases can be absent from infocmp's
                # canonical header. Preserve the exact installed lookup name.
                header = re.search(rb'(?m)^([^#\s][^,\n]*),', definition)
                assert header, f'No reconstructed terminal header for {original}'
                names = header.group(1).split(b'|')
                lookup = src.name.encode()
                if lookup not in names:
                    names.insert(max(1, len(names) - 1), lookup)
                    definition = definition[:header.start(1)] + b'|'.join(names) + definition[header.end(1):]
                derivation = {'method': 'Installed Debian entry reconstructed by stock infocmp and recompiled by upstream tic', 'installed_lookup_name': src.name, 'original_sha256': hashlib.sha256(src.read_bytes()).hexdigest(), 'definition_sha256': hashlib.sha256(definition).hexdigest()}
                with tempfile.TemporaryDirectory() as temporary:
                    entry = Path(temporary) / 'entry.src'
                    entry.write_bytes(definition)
                    env = dict(os.environ, LD_LIBRARY_PATH=str(stage / 'usr/lib' / triplet))
                    subprocess.run([str(stage / 'usr/bin/tic'), '-x', '-o', str(stage / 'usr/share/terminfo'), str(entry)], env=env, check=True)
            assert candidate.is_file() or candidate.is_symlink(), f'No upstream replacement for {original}'
            if data and candidate.is_symlink():
                # The installed subset may omit upstream's canonical filename.
                # Materialize identical compiled data for the existing alias so
                # it never points at an entry absent from the runtime package.
                compiled = candidate.resolve()
                assert compiled.is_relative_to(stage.resolve()) and compiled.is_file(), candidate
                dest.parent.mkdir(parents=True, exist_ok=True)
                if dest.exists() or dest.is_symlink():
                    dest.unlink()
                shutil.copy2(compiled, dest)
                derivation['compiled_alias_materialized'] = hashlib.sha256(compiled.read_bytes()).hexdigest()
            else:
                copy(candidate, dest)
            replaced.append({'installed': original, 'upstream': str(candidate), **derivation})
        else:
            copy(src, dest)
    if package in ('libtinfo6', 'libncursesw6'):
        libdir = stage / 'usr/lib' / triplet
        families = ('libtinfo', 'libtic') if package == 'libtinfo6' else sorted({match.group(1) for file in files if (match := re.search(r'/(lib[^/]+)\.so\.6(?:\.\d+)*$', file))})
        for family in families:
            old = Path('/usr/lib') / triplet / (family + '.so.6')
            new = libdir / (family + '.so.6')
            assert new.exists(), new
            if old.exists():
                missing = exports(old) - exports(new)
                assert not missing, f'ABI exports missing from {family}: {sorted(missing)}'
            for library in libdir.glob(family + '.so.6*'):
                copy(library, root / 'usr/lib' / triplet / library.name)
                replaced.append({'installed': str(old), 'upstream': str(library)})
    doc = root / 'usr/share/doc' / package
    documentation = {'installed_lookup': '/usr/share/doc/' + package}
    if doc.is_symlink():
        # Keep Debian's installed documentation alias intact. Store this
        # package's new receipts in a unique appendix beneath its original
        # target, rather than following a dangling staging link or overwriting
        # another package's license/receipt. No dpkg symlink migration needed.
        original_doc = Path('/usr/share/doc') / package
        assert original_doc.is_symlink() and os.readlink(doc) == os.readlink(original_doc)
        original_target = original_doc.resolve()
        assert original_target.is_dir() and original_target.is_relative_to(Path('/usr/share/doc'))
        documentation['retained_alias'] = os.readlink(doc)
        doc = root / original_target.relative_to('/') / ('runtime-' + package)
    doc.mkdir(parents=True, exist_ok=True)
    documentation['payload_directory'] = '/' + str(doc.relative_to(root))
    license_file = Path({'coreutils': '/corebuild/COPYING', 'ncurses': '/cursesbuild/COPYING', 'dash': '/dashbuild/COPYING'}[mode])
    copy(license_file, doc / 'COPYING.upstream')
    source_receipt = {
        'coreutils': {'url': 'https://ftp.gnu.org/gnu/coreutils/coreutils-9.12.tar.xz', 'sha256': 'a480198559733e9b3da999e90543ac6f888a2caa544d8d664c5a1f17e528e210'},
        'ncurses': {'url': 'https://invisible-island.net/archives/ncurses/ncurses-6.6.tar.gz', 'sha256': '355b4cbbed880b0381a04c46617b7656e362585d52e9cf84a67e2009b749ff11'},
        'dash': {'url': 'https://git.kernel.org/pub/scm/utils/dash/dash.git/snapshot/dash-0.5.12.tar.gz', 'sha256': '0d632f6b945058d84809cac7805326775bd60cb4a316907d0bd4228ff7107154', 'configuration': '--enable-fnmatch'},
    }[mode]
    (doc / 'runtime-source.json').write_text(json.dumps({'source': mode, 'version': version, 'archive': source_receipt, 'replaced': replaced, 'documentation': documentation}, indent=2) + '\n')
    roots[package] = root

# Give dpkg-shlibdeps the exact replacement libraries and their honest package versions.
local_shlibs = Path('/tmp/runtime-shlibs')
local_shlibs.write_text(''.join(f'{family} 6 {package} (>= {version})\n' for family, package in [('libtinfo', 'libtinfo6'), ('libtic', 'libtinfo6'), ('libncursesw', 'libncursesw6'), ('libpanelw', 'libncursesw6'), ('libmenuw', 'libncursesw6'), ('libformw', 'libncursesw6')]) if mode == 'ncurses' else '')
Path('debian').mkdir(exist_ok=True)
Path('debian/control').write_text('Source: ' + mode + '\nMaintainer: Runtime Maintainers <maintainers@example.invalid>\n\n' + '\n'.join('Package: ' + p + '\nArchitecture: any\nDescription: upstream runtime\n' for p in packages))
for package, root in roots.items():
    elf = [p for p in root.rglob('*') if p.is_file() and not p.is_symlink() and p.open('rb').read(4) == b'\x7fELF']
    deps = ''
    if elf:
        for binary in elf:
            subprocess.run(['strip', '--strip-unneeded', str(binary)], check=True)
        command = ['dpkg-shlibdeps', '-O', '-x' + package]
        if mode == 'ncurses':
            command += ['-l' + str(stage / 'usr/lib' / triplet), '-L' + str(local_shlibs)]
        command += ['-e' + str(p) for p in elf]
        result = subprocess.check_output(command, text=True)
        deps = next(line.split('=', 1)[1] for line in result.splitlines() if line.startswith('shlibs:Depends='))
        assert deps, package
    control = root / 'DEBIAN'
    control.mkdir()
    original = subprocess.check_output(['dpkg-query', '-s', package], text=True)
    fields = {}
    for line in original.splitlines():
        if ': ' in line and not line.startswith(' '):
            key, value = line.split(': ', 1)
            if key in ('Section', 'Priority', 'Essential', 'Multi-Arch', 'Provides', 'Breaks', 'Replaces', 'Pre-Depends', 'Depends', 'Conflicts', 'Recommends', 'Suggests', 'Enhances'):
                fields[key] = value
    fields.update({'Package': package, 'Source': mode, 'Version': version, 'Architecture': 'all' if package == 'ncurses-base' else arch,
                   'Maintainer': 'Runtime Maintainers <maintainers@example.invalid>', 'Description': 'Verified upstream ' + mode + ' runtime'})
    original_deps = fields.get('Depends', '')
    for rebuilt in packages:
        original_deps = re.sub(r'(?<![A-Za-z0-9+.-])' + re.escape(rebuilt) + r'\s*\([^)]*\)', rebuilt + ' (>= ' + version + ')', original_deps)
    combined = list(dict.fromkeys(part.strip() for part in (original_deps + ',' + deps).split(',') if part.strip()))
    if combined: fields['Depends'] = ', '.join(combined)
    if package in ('libtinfo6', 'libncursesw6'):
        family_names = ('libtinfo', 'libtic') if package == 'libtinfo6' else families
        (control / 'shlibs').write_text(''.join(f'{family} 6 {package} (>= {version})\n' for family in family_names))
    for suffix in ('preinst', 'postinst', 'prerm', 'postrm', 'triggers', 'conffiles'):
        candidates = [Path('/var/lib/dpkg/info') / (package + '.' + suffix), Path('/var/lib/dpkg/info') / (package + ':' + arch + '.' + suffix)]
        present = next((p for p in candidates if p.is_file()), None)
        if present:
            copy(present, control / suffix)
    (control / 'control').write_text(''.join(k + ': ' + v + '\n' for k, v in fields.items()))
    subprocess.run(['dpkg-deb', '--build', '--root-owner-group', str(root), str(out / (package + '.deb'))], check=True)
