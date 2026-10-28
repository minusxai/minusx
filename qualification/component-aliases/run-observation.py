"""Inspect an authenticated existing image without application execution or builds."""
import hashlib
import json
import pathlib
import re
import subprocess
import sys


def command(argv, timeout=60):
    return subprocess.run(argv,capture_output=True,text=True,timeout=timeout)


def checked(argv,timeout=60):
    result=command(argv,timeout)
    if result.returncode:raise RuntimeError('Read-only image observation operation failed')
    return result.stdout


def observe(lock_path, origin_path, probe_path, output):
    lock_bytes=pathlib.Path(lock_path).read_bytes();lock=json.loads(lock_bytes);origin=json.loads(pathlib.Path(origin_path).read_text())
    image_ref='ghcr.io/'+lock['repository'].split('/')[0]+'/'+lock['package']+'@'+lock['image_digest']
    assert origin['image_ref']==image_ref and origin['source_head']==lock['source_head']
    assert origin['lock_sha256']==hashlib.sha256(lock_bytes).hexdigest()
    checked(['docker','pull','--platform','linux/amd64',image_ref],300)
    image=json.loads(checked(['docker','image','inspect',image_ref]))[0];image_id=image['Id']
    assert re.fullmatch(r'sha256:[a-f0-9]{64}',image_id)
    assert image['Architecture']=='amd64' and image['Os']=='linux'
    assert image['Config']['Labels']['org.opencontainers.image.revision']==lock['source_head']
    code=pathlib.Path(probe_path).read_text();payload=code+'\nprocess.stdout.write(JSON.stringify(module.exports.inspectAliases("/"))+"\\n");\n'
    args=['docker','create','--network','none','--read-only','--cpus','1','--memory','1g','--pids-limit','64','--cap-drop','ALL','--cap-add','DAC_READ_SEARCH','--user','0:0','--security-opt','no-new-privileges','--entrypoint','node']
    container=checked(args+[image_id,'-e',payload]).strip();assert re.fullmatch(r'[a-f0-9]{64}',container)
    try:
        config=json.loads(checked(['docker','inspect',container]))[0];host=config['HostConfig']
        assert config['Image']==image_id and config['Config']['User']=='0:0'
        assert host['ReadonlyRootfs'] is True and host['NetworkMode']=='none'
        assert host['CapDrop']==['ALL'] and host['CapAdd']==['CAP_DAC_READ_SEARCH']
        assert host['SecurityOpt']==['no-new-privileges'] and not host['Binds'] and not config['Mounts']
        assert host['NanoCpus']==1000000000 and host['Memory']==1073741824 and host['PidsLimit']==64
        actual=command(['docker','start','--attach',container],150);assert actual.returncode==0
        probe=json.loads(actual.stdout)
        assert type(probe['probe_uid']) is int and probe['probe_uid']==0
        result={'kind':'existing-published-image-read-only-alias-observation','image_id':image_id,'container_image_id':config['Image'],'published_digest':lock['image_digest'],'source_head':lock['source_head'],'publisher_run_id':lock['run_id'],'publisher_job_id':lock['job_id'],'origin_sha256':hashlib.sha256(pathlib.Path(origin_path).read_bytes()).hexdigest(),'probe_sha256':hashlib.sha256(code.encode()).hexdigest(),'execution_payload_sha256':hashlib.sha256(payload.encode()).hexdigest(),'runner_sha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'new_source_or_image_built':False,'application_deployed':False,'probe':probe}
        pathlib.Path(output).write_text(json.dumps(result,indent=2)+'\n')
        assert probe['schema']==1 and type(probe['schema']) is int
        assert probe['error_count']==0 and type(probe['error_count']) is int
        assert probe['ordinary_rootfs_alias_closure_complete'] is True
        assert probe['component_absence_proven'] is True
        assert probe['homed_matching_entry_count']==0 and type(probe['homed_matching_entry_count']) is int
    finally:checked(['docker','rm','-f',container],15)


if __name__=='__main__':observe(*sys.argv[1:])
