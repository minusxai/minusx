#!/usr/bin/env python3
"""Inspect an exact local image without starting it; retain only ACL evidence."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import tempfile


def run(*args):
    return subprocess.check_output(args, text=True, timeout=120)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def elf_evidence(path):
    symbols = run('objdump', '-T', str(path))
    dynamic = run('objdump', '-p', str(path))
    selected = {'imports': set(), 'exports': set()}
    for line in symbols.splitlines():
        fields = line.split()
        if fields and re.fullmatch(r'(?:acl_|attr_|[fl]?getxattr|[fl]?setxattr|[fl]?listxattr|[fl]?removexattr)[A-Za-z0-9_]*', fields[-1]):
            selected['imports' if '*UND*' in fields else 'exports'].add(fields[-1])
    return {'sha256': digest(path), 'bytes': path.stat().st_size,
            'needed': sorted(re.findall(r'^\s*NEEDED\s+(\S+)', dynamic, re.M)),
            **{key: sorted(value) for key, value in selected.items()}}


def config_evidence(path):
    result = {}
    for line in path.read_text().splitlines():
        match = re.fullmatch(r'#define\s+([A-Z0-9_]*(?:ACL|XATTR|ATTR_ACTION_PERMISSIONS)[A-Z0-9_]*)\s+([01])', line)
        if match:
            result[match[1]] = int(match[2])
    return {'sha256': digest(path), 'features': result}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', required=True, help='Exact local sha256 image ID')
    parser.add_argument('--configs', type=pathlib.Path, required=True,
                        help='Scratch export containing tar-config.h and coreutils-config.h')
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', args.image):
        parser.error('image must be an exact sha256 ID')
    inspect = json.loads(run('docker', 'image', 'inspect', args.image))[0]
    if inspect['Id'] != args.image or inspect['Architecture'] != 'amd64' or inspect['Os'] != 'linux':
        raise ValueError('Unexpected image identity or platform')
    report = {'schema': 1, 'image_id': inspect['Id'], 'platform': 'linux/amd64',
              'rootfs_layers': inspect['RootFS']['Layers'], 'executed_target': False,
              'binaries': {}, 'packages': {}, 'source_configs': {}}
    container = run('docker', 'create', '--entrypoint', '/bin/true', args.image).strip()
    try:
        assert json.loads(run('docker', 'inspect', container))[0]['Image'] == args.image
        with tempfile.TemporaryDirectory(prefix='acl-static-') as directory:
            root = pathlib.Path(directory)
            for name in ('tar', 'cp', 'mv', 'install', 'ls', 'libacl'):
                source = '/usr/lib/x86_64-linux-gnu/libacl.so.1' if name == 'libacl' else '/usr/bin/' + name
                target = root / name
                run('docker', 'cp', '-L', container + ':' + source, str(target))
                report['binaries'][name] = elf_evidence(target)
            status = root / 'status'
            run('docker', 'cp', container + ':/var/lib/dpkg/status', str(status))
            for block in status.read_text().split('\n\n'):
                fields = dict(line.split(': ', 1) for line in block.splitlines() if ': ' in line and not line.startswith(' '))
                if fields.get('Package') in ('tar', 'coreutils', 'libacl1'):
                    report['packages'][fields['Package']] = {key.lower(): fields[key] for key in ('Version', 'Architecture', 'Status')}
    finally:
        run('docker', 'rm', container)
    for name in ('tar', 'coreutils'):
        report['source_configs'][name] = config_evidence(args.configs / (name + '-config.h'))
    args.output.write_text(json.dumps(report, sort_keys=True, indent=2) + '\n')


if __name__ == '__main__':
    main()
