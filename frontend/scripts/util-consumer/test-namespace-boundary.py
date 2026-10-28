"""Probe boundary controls only. No local Docker calls or namespace entry."""
import json
from pathlib import Path
import runpy
import subprocess
import tempfile
from types import SimpleNamespace

probe = runpy.run_path(str(Path(__file__).with_name('check-namespace-containers.py')))['probe']
images = {'original': 'sha256:' + 'a' * 64, 'candidate': 'sha256:' + 'b' * 64}


def exercise(fault=None):
    created, removed = {}, set()
    def docker(*args):
        if args[:2] == ('image', 'inspect'):
            return json.dumps([{'Id': args[2]}])
        if args[0] == 'create':
            name = args[args.index('--name') + 1]
            index = next(i for i, value in enumerate(args) if value.startswith('sha256:'))
            created[name] = args[index], list(args[index + 1:])
            return name
        if args[0] == 'inspect' and args[1] == '--format':
            return '0'
        assert args[0] == 'inspect'
        image, command = created[args[1]]
        host = {'Privileged': False, 'CapDrop': ['ALL'], 'CapAdd': ['CAP_SYS_ADMIN', 'CAP_SYS_CHROOT'],
                'ReadonlyRootfs': True, 'NetworkMode': 'none', 'Binds': [], 'PidMode': '', 'IpcMode': 'private',
                'PidsLimit': 32, 'Memory': 134217728, 'NanoCpus': 1000000000,
                'SecurityOpt': ['no-new-privileges'], 'Tmpfs': {'/tmp': 'rw,noexec,nosuid,nodev,size=16m'}}
        if fault == 'extra-cap': host['CapAdd'].append('CAP_NET_ADMIN')
        if fault == 'writable': host['ReadonlyRootfs'] = False
        if fault == 'network': host['NetworkMode'] = 'bridge'
        return json.dumps([{'Image': image, 'HostConfig': host,
            'Mounts': [{'Type': 'tmpfs', 'Destination': '/tmp'}],
            'Config': {'User': '0:0', 'Entrypoint': ['/usr/bin/nsenter'], 'Cmd': command}}])
    def run(args, **kwargs):
        if args[:3] == ['docker', 'rm', '--force']:
            assert args[3] in created
            removed.add(args[3])
            return SimpleNamespace(returncode=0)
        assert args[:3] == ['docker', 'start', '--attach']
        command = created[args[3]][1]
        return SimpleNamespace(returncode=0, stdout=b'/tmp\n' if '--wd=/tmp' in command else b'',
                               stderr=b'unexpected' if fault == 'stderr' else b'')
    namespace = probe.__globals__
    previous = namespace['docker'], namespace['subprocess']
    namespace['docker'] = docker
    namespace['subprocess'] = SimpleNamespace(run=run, DEVNULL=subprocess.DEVNULL)
    passed = False
    try:
        with tempfile.TemporaryDirectory(prefix='namespace-boundary-controls-') as directory:
            output = Path(directory) / 'receipt.json'
            probe(images, output)
            record = json.loads(output.read_text())
            assert len(record['results']) == 4 and all(row['passed'] for row in record['results'])
            passed = True
    except AssertionError:
        pass
    finally:
        namespace['docker'], namespace['subprocess'] = previous
    assert set(created) == removed
    assert passed == (fault is None)


exercise()
for fault in ('extra-cap', 'writable', 'network', 'stderr'):
    exercise(fault)
print(json.dumps({'kind': 'utility-namespace-boundary-controls', 'status': 'mock-controls-only-unadmitted',
                  'positive': 1, 'negative_controls': 4, 'local_containers': 0}, indent=2))
