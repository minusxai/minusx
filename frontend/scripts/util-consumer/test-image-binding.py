"""Stopped-image binding controls. Docker is fully mocked; no local containers."""
import hashlib
import io
import json
from pathlib import Path
import runpy
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace

bind = runpy.run_path(str(Path(__file__).with_name('bind-target-images.py')))['bind']
original_id, candidate_id = 'sha256:' + 'a' * 64, 'sha256:' + 'b' * 64
sha = lambda data: hashlib.sha256(data).hexdigest()
negative = 0


def exercise(fault=None, final_mode=False):
    with tempfile.TemporaryDirectory(prefix='utility-image-binding-controls-') as directory:
        root = Path(directory)
        (root / 'original').mkdir()
        (root / 'installed').mkdir()
        (root / 'accepted-isolated-proof').mkdir()
        plan = {'status_sha256': sha(b'original-status')}
        manifest = {'paths': {'/usr/bin/nsenter': {'sha256': sha(b'candidate-nsenter')}}}
        values = {'plan.json': plan, 'preparation.json': {}, 'source-target-comparison.json': {}, 'prepare-status.json': {}}
        for name, value in values.items():
            data = json.dumps(value).encode()
            (root / name).write_bytes(data)
            (root / 'installed' / name).write_bytes(data)
        (root / 'installed/after-status').write_bytes(b'candidate-status')
        (root / 'original/profile.json').write_text(json.dumps({'packages': {'util-linux': {'files': {
            '/usr/bin/nsenter': {'sha256': sha(b'original-nsenter')}}}}}))
        (root / 'final-native-manifest.json').write_text(json.dumps(manifest))
        (root / 'accepted-isolated-proof/namespace-image-provenance.json').write_text(json.dumps({'images': {
            'original': {'nsenter_sha256': sha(b'original-nsenter')},
            'candidate': {'nsenter_sha256': sha(b'candidate-nsenter')}}}))
        final = root / 'final.json'
        final.write_text(json.dumps({'manifest_sha256': sha((root / 'final-native-manifest.json').read_bytes())}))
        containers = {}
        removed = set()

        def docker(*args):
            if args[:2] == ('image', 'inspect'):
                identity = candidate_id if fault == 'wrong-image-id' else args[2]
                return json.dumps([{'Id': identity}]).encode()
            if args[0] == 'create':
                name = args[args.index('--name') + 1]
                assert name.startswith('util-target-binding-') and name not in containers
                containers[name] = args[-1]
                return name.encode()
            if args[0] == 'inspect':
                name = args[1]
                host = {'Privileged': False, 'Binds': [], 'CapDrop': ['ALL'], 'CapAdd': [],
                        'ReadonlyRootfs': True, 'NetworkMode': 'none', 'PidMode': '', 'IpcMode': 'private',
                        'SecurityOpt': ['no-new-privileges'], 'PidsLimit': 32, 'Memory': 134217728, 'NanoCpus': 1000000000}
                changes = {'privileged': ('Privileged', True), 'bind': ('Binds', ['/host:/guest']),
                           'extra-cap': ('CapAdd', ['CAP_SYS_ADMIN']), 'missing-capdrop': ('CapDrop', []),
                           'writable-root': ('ReadonlyRootfs', False), 'network': ('NetworkMode', 'bridge'),
                           'host-pid': ('PidMode', 'host'), 'host-ipc': ('IpcMode', 'host'),
                           'no-nnp': ('SecurityOpt', []), 'memory': ('Memory', 0), 'cpu': ('NanoCpus', 0)}
                if fault in changes:
                    key, value = changes[fault]
                    host[key] = value
                return json.dumps([{'Image': containers[name], 'HostConfig': host, 'Mounts': []}]).encode()
            assert args[0] == 'cp'
            name, path = args[1].split(':', 1)
            candidate = containers[name] == candidate_id
            if path == '/usr/bin/nsenter':
                data = b'candidate-nsenter' if candidate else b'original-nsenter'
                if fault == 'namespace-bytes' and candidate:
                    data = b'changed'
            elif path == '/var/lib/dpkg/status':
                data = b'candidate-status' if candidate else b'original-status'
                if fault == 'original-status' and not candidate or fault == 'candidate-status' and candidate:
                    data = b'changed'
            elif path == '/util-final-proof.json':
                data = final.read_bytes()
                if fault == 'final-receipt':
                    data += b'changed'
            else:
                assert path.startswith('/util-proof/')
                data = (root / 'installed' / Path(path).name).read_bytes()
                if fault == 'candidate-proof':
                    data += b'changed'
            output = io.BytesIO()
            with tarfile.open(fileobj=output, mode='w') as archive:
                item = tarfile.TarInfo(Path(path).name)
                if fault == 'copy-symlink':
                    item.type, item.linkname = tarfile.SYMTYPE, '/outside'
                    archive.addfile(item)
                else:
                    item.size = len(data)
                    archive.addfile(item, io.BytesIO(data))
            return output.getvalue()

        def cleanup(args, **kwargs):
            assert args[:3] == ['docker', 'rm', '--force'] and args[3] in containers
            removed.add(args[3])
            return SimpleNamespace(returncode=0)

        globals = bind.__globals__
        previous = globals['docker'], globals['subprocess']
        globals['docker'] = docker
        globals['subprocess'] = SimpleNamespace(run=cleanup, DEVNULL=subprocess.DEVNULL)
        passed = False
        try:
            bind(original_id, 'mutable:tag' if fault == 'mutable-tag' else candidate_id,
                 root, root / 'binding.json', final if final_mode else None)
            passed = True
        except AssertionError:
            pass
        finally:
            globals['docker'], globals['subprocess'] = previous
        assert removed == set(containers), 'Every owned stopped container must be removed'
        assert passed == (fault is None), 'Unexpected binding outcome: ' + str(fault)


exercise()
exercise(final_mode=True)
faults = ['wrong-image-id', 'privileged', 'bind', 'extra-cap', 'missing-capdrop', 'writable-root',
          'network', 'host-pid', 'host-ipc', 'no-nnp', 'memory', 'cpu', 'namespace-bytes',
          'original-status', 'candidate-status', 'candidate-proof', 'copy-symlink', 'mutable-tag']
for fault in faults:
    exercise(fault)
exercise('final-receipt', final_mode=True)
print(json.dumps({'kind': 'utility-image-binding-controls', 'status': 'mock-controls-only-unadmitted',
                  'positive': 2, 'negative_controls': len(faults) + 1, 'local_containers': 0}, indent=2))
