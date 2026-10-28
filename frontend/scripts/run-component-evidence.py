#!/usr/bin/env python3
"""Bind a reviewed, read-only component observation to one immutable runtime image."""
import hashlib
import json
import pathlib
import re
import sys
from importlib.util import spec_from_file_location, module_from_spec

spec = spec_from_file_location('inventory_executor', pathlib.Path(__file__).with_name('run-glibc-inventory.py'))
executor = module_from_spec(spec)
spec.loader.exec_module(executor)


def capture(image, script, output, source_head, checkout_sha):
    assert re.fullmatch(r'[a-f0-9]{40}', source_head) and re.fullmatch(r'[a-f0-9]{40}', checkout_sha)
    image_id = executor.checked(['docker', 'image', 'inspect', '--format', '{{.Id}}', image]).strip()
    assert re.fullmatch(r'sha256:[a-f0-9]{64}', image_id)
    code = pathlib.Path(script).read_text()
    payload = code + '\nprocess.stdout.write(JSON.stringify(module.exports.inspect("/",true))+"\\n");\n'
    args = ['docker', 'create', '--network', 'none', '--read-only', '--cpus', '1', '--memory', '1g', '--pids-limit', '64', '--cap-drop', 'ALL', '--cap-add', 'DAC_READ_SEARCH', '--user', '0:0', '--security-opt', 'no-new-privileges', '--entrypoint', 'node']
    container = executor.checked(args + [image_id, '-e', payload]).strip()
    assert re.fullmatch(r'[a-f0-9]{64}', container)
    try:
        config = json.loads(executor.checked(['docker', 'inspect', container]))[0]
        host = config['HostConfig']
        assert config['Image'] == image_id and config['Config']['User'] == '0:0'
        assert host['ReadonlyRootfs'] is True and host['NetworkMode'] == 'none'
        assert host['CapDrop'] == ['ALL'] and host['CapAdd'] == ['CAP_DAC_READ_SEARCH']
        assert host['SecurityOpt'] == ['no-new-privileges'] and not host['Binds'] and not config['Mounts']
        assert host['NanoCpus'] == 1000000000 and host['Memory'] == 1073741824 and host['PidsLimit'] == 64
        actual = executor.command(['docker', 'start', '--attach', container], 120)
        assert actual.returncode == 0
        probe = json.loads(actual.stdout)
        assert type(probe['schema']) is int and probe['schema'] == 1
        assert probe['image_identity_bound'] is False and probe['source_to_binary_binding_proven'] is False
        assert probe['package_absence_checked'] is False and probe['systemd_homed']['component_absence_proven'] is False
        assert probe['traversal']['ordinary_rootfs_complete'] is False and probe['traversal']['directory_symlinks_followed'] is False
        result = {'kind': 'image-bound-read-only-component-observation', 'source_head': source_head, 'checkout_sha': checkout_sha, 'image_id': image_id, 'container_image_id': config['Image'], 'probe_sha256': hashlib.sha256(code.encode()).hexdigest(), 'execution_payload_sha256': hashlib.sha256(payload.encode()).hexdigest(), 'executor_sha256': hashlib.sha256(pathlib.Path(executor.__file__).read_bytes()).hexdigest(), 'runner_sha256': hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(), 'inventory_capability': 'CAP_DAC_READ_SEARCH', 'component_absence_admitted': False, 'binary_derivation_admitted': False, 'probe': probe}
        pathlib.Path(output).write_text(json.dumps(result, indent=2) + '\n')
    finally:
        executor.checked(['docker', 'rm', '-f', container], 15)


if __name__ == '__main__':
    capture(*sys.argv[1:])
