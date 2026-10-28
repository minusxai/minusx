"""Read-only immutable image binding for isolated target or final-image probes."""
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import uuid

sha = lambda data: hashlib.sha256(data).hexdigest()


def docker(*args):
    return subprocess.check_output(['docker', *args], timeout=60)


def image_file(container, path):
    with tarfile.open(fileobj=io.BytesIO(docker('cp', container + ':' + path, '-'))) as archive:
        members = archive.getmembers()
        assert len(members) == 1 and members[0].isfile()
        assert members[0].name == Path(path).name and members[0].size <= 32 * 1024 * 1024
        return archive.extractfile(members[0]).read()


def bind(original, candidate, proof, out, final=None):
    plan = json.loads((proof / 'plan.json').read_text())
    profile = json.loads((proof / 'original/profile.json').read_text())
    manifest = json.loads((proof / 'final-native-manifest.json').read_text())
    producer = json.loads((proof / 'accepted-isolated-proof/namespace-image-provenance.json').read_text())
    expected = {'original': profile['packages']['util-linux']['files']['/usr/bin/nsenter']['sha256'],
                'candidate': manifest['paths']['/usr/bin/nsenter']['sha256']}
    assert expected == {label: record['nsenter_sha256'] for label, record in producer['images'].items()}
    for name in ('plan.json', 'preparation.json', 'source-target-comparison.json', 'prepare-status.json'):
        assert (proof / name).read_bytes() == (proof / 'installed' / name).read_bytes()
    records = {}
    for label, image in [('original', original), ('candidate', candidate)]:
        assert re.fullmatch(r'sha256:[0-9a-f]{64}', image)
        assert json.loads(docker('image', 'inspect', image))[0]['Id'] == image
        name = 'util-target-binding-' + uuid.uuid4().hex
        try:
            docker('create', '--name', name, '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                   '--security-opt', 'no-new-privileges', '--pids-limit', '32', '--memory', '128m',
                   '--cpus', '1', '--user', '0:0', '--entrypoint', '/usr/bin/true', image)
            inspected = json.loads(docker('inspect', name))[0]
            host = inspected['HostConfig']
            assert inspected['Image'] == image and not host['Privileged'] and not host['Binds']
            assert host['CapDrop'] == ['ALL'] and not host['CapAdd']
            assert host['ReadonlyRootfs'] and host['NetworkMode'] == 'none'
            assert not inspected['Mounts'] and host['PidMode'] == '' and host['IpcMode'] == 'private'
            assert host['SecurityOpt'] == ['no-new-privileges']
            assert host['PidsLimit'] == 32 and host['Memory'] == 134217728 and host['NanoCpus'] == 1000000000
            assert sha(image_file(name, '/usr/bin/nsenter')) == expected[label]
            status = image_file(name, '/var/lib/dpkg/status')
            if label == 'original':
                assert sha(status) == plan['status_sha256']
            elif final is None:
                assert status == (proof / 'installed/after-status').read_bytes()
                for path in (proof / 'installed').iterdir():
                    assert path.is_file() and not path.is_symlink()
                    assert image_file(name, '/util-proof/' + path.name) == path.read_bytes()
            else:
                assert image_file(name, '/util-final-proof.json') == final.read_bytes()
                receipt = json.loads(final.read_text())
                assert receipt['manifest_sha256'] == sha((proof / 'final-native-manifest.json').read_bytes())
            records[label] = {'image_id': image, 'nsenter_sha256': expected[label], 'actual_status_sha256': sha(status)}
        finally:
            subprocess.run(['docker', 'rm', '--force', name], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=15, check=False)
    out.write_text(json.dumps({'kind': 'util-target-immutable-image-binding', 'status': 'unadmitted',
        'scope': 'final-application' if final is not None else 'isolated-target-transaction',
        'plan_sha256': sha((proof / 'plan.json').read_bytes()), 'images': records,
        'installed_proof_hashes': {path.name: sha(path.read_bytes()) for path in (proof / 'installed').iterdir()},
        'final_receipt_sha256': sha(final.read_bytes()) if final is not None else None}, indent=2) + '\n')


if __name__ == '__main__':
    assert len(sys.argv) in (5, 6)
    bind(sys.argv[1], sys.argv[2], Path(sys.argv[3]), Path(sys.argv[4]),
         Path(sys.argv[5]) if len(sys.argv) == 6 else None)
