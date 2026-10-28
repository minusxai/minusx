#!/usr/bin/env python3
"""Run two image-bound read-only inventories; publish aggregate technical data only."""
import hashlib
import json
import pathlib
import re
import subprocess
import sys


def command(argv, timeout=60):
    return subprocess.run(argv, capture_output=True, text=True, timeout=timeout)


def checked(argv, timeout=60):
    result = command(argv, timeout)
    if result.returncode:
        raise RuntimeError('Inventory Docker operation failed')
    return result.stdout


def validate_probe(probe, image_id):
    allowed={'schema','probeUid','expectedImageId','identityBinding','counters','elfClasses','namedPayload','setuidCount','setgidCount','setidOriginCount','setidOriginTraversalCount','originTraversalCount','privateInventorySha256','errorCount','errorKinds','permissionErrors','scanComplete','capabilityCoverage','limitations'}
    assert set(probe)==allowed and probe['schema']==2
    assert probe['expectedImageId']==image_id and type(probe['probeUid']) is int
    assert type(probe['errorCount']) is int and probe['errorCount']>=0
    assert type(probe['scanComplete']) is bool
    assert re.fullmatch(r'[a-f0-9]{64}',probe['privateInventorySha256'])
    assert set(probe['counters'])=={'regularFiles','elfFiles','setidFiles','originCandidates'}
    assert all(type(n) is int and n>=0 for n in probe['counters'].values())
    assert probe['capabilityCoverage']=='unknown'
    for key,count in probe['permissionErrors'].items():
        assert re.fullmatch(r'(directory|regular|other|unknown):([0-7]{1,4}|unknown):(same|other|unknown)',key)
        assert type(count) is int and count>=0


def inventory(image, script, output, source_head, checkout_sha):
    image_id = checked(['docker', 'image', 'inspect', '--format', '{{.Id}}', image]).strip()
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image_id):
        raise ValueError('Invalid immutable image identity')
    code = pathlib.Path(script).read_text()
    proofs = []
    for read_search in (False, True):
        args = ['docker', 'create', '--network', 'none', '--read-only', '--cpus', '1', '--memory', '1g', '--pids-limit', '64', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--entrypoint', 'node', '--env', 'PROBE_SELFTEST=0', '--env', 'PROBE_EXPECTED_IMAGE_ID=' + image_id]
        if read_search:
            args += ['--user', '0:0', '--cap-add', 'DAC_READ_SEARCH', '--env', 'PROBE_REQUIRE_UID_ZERO=1']
        container = checked(args + [image_id, '-e', code]).strip()
        if not re.fullmatch(r'[a-f0-9]{64}', container):
            raise ValueError('Invalid owned container identity')
        try:
            inspected = json.loads(checked(['docker', 'inspect', container]))[0]
            host = inspected['HostConfig']
            assert inspected['Image'] == image_id
            assert host['ReadonlyRootfs'] is True and host['NetworkMode'] == 'none'
            assert host['CapDrop'] == ['ALL'] and (host['CapAdd'] or []) == (['CAP_DAC_READ_SEARCH'] if read_search else [])
            assert host['SecurityOpt'] == ['no-new-privileges']
            assert not host['Binds'] and not inspected['Mounts']
            assert host['NanoCpus'] == 1000000000 and host['Memory'] == 1073741824 and host['PidsLimit'] == 64
            if read_search:
                assert inspected['Config']['User'] == '0:0'
            actual = command(['docker', 'start', '--attach', container], 300)
            probe = json.loads(actual.stdout)
            validate_probe(probe,image_id)
            if read_search:
                assert probe['probeUid'] == 0 and actual.returncode == 0
                assert probe['errorCount'] == 0 and probe['errorKinds'] == {} and probe['scanComplete'] is True
            else:
                assert actual.returncode in (0, 1)
                if probe['errorCount']:
                    assert actual.returncode == 1 and probe['scanComplete'] is False
                    assert probe['errorKinds'] == {'EACCES': probe['errorCount']}
                    assert sum(probe['permissionErrors'].values()) == probe['errorCount']
                else:
                    assert actual.returncode == 0 and probe['scanComplete'] is True
            proofs.append(probe)
            if not read_search:
                pathlib.Path(output).write_text(json.dumps({'source_head': source_head, 'checkout_sha': checkout_sha, 'image_id': image_id, 'container_image_id': image_id, 'probe_sha256': hashlib.sha256(code.encode()).hexdigest(), 'runner_sha256': hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(), 'inventory_status': 'cap-free-only-unadmitted', 'inventory_capability': 'none', 'cap_free_diagnostic': probe, 'probe': probe}, indent=2) + '\n')
        finally:
            checked(['docker', 'rm', '-f', container], 15)
    result = {'source_head': source_head, 'checkout_sha': checkout_sha, 'image_id': image_id, 'container_image_id': image_id, 'probe_sha256': hashlib.sha256(code.encode()).hexdigest(), 'runner_sha256': hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(), 'inventory_status': 'complete-inventory', 'inventory_capability': 'CAP_DAC_READ_SEARCH', 'cap_free_diagnostic': proofs[0], 'probe': proofs[1]}
    pathlib.Path(output).write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    inventory(*sys.argv[1:])
