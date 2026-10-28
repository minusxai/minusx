"""Authenticate a pinned successful producer job, even when another OS job failed.
Host-only GitHub token transport; no credential enters a build context.
"""
import base64,hashlib,json,stat,subprocess,sys,zipfile,io
from pathlib import Path

def sha(data):return hashlib.sha256(data).hexdigest()
def api(path,raw=False):
    data=subprocess.check_output(['gh','api',path])
    return data if raw else json.loads(data)
def fetch(lock,destination):
    assert set(lock)=={'repository','repository_id','run_id','attempt','head','branch','workflow_path','workflow_sha256','job_id','job_name','artifact_id','artifact_name','zip_sha256','zip_size','proof_sha256','recipe_sha256','whole_run_conclusion'}
    repo=lock['repository'];assert repo=='minusxai/minusx'
    assert api('repos/'+repo)['id']==lock['repository_id']
    run=api('repos/'+repo+'/actions/runs/'+str(lock['run_id']))
    for field,value in [('id',lock['run_id']),('run_attempt',lock['attempt']),('head_sha',lock['head']),('head_branch',lock['branch']),('path',lock['workflow_path']),('event','push')]:assert run[field]==value,field
    assert run['status']=='completed' and run['conclusion']==lock['whole_run_conclusion'] and run['conclusion'] in ('success','failure')
    assert run['repository']['id']==lock['repository_id'] and run['head_repository']['id']==lock['repository_id']
    workflow=api('repos/'+repo+'/contents/'+lock['workflow_path']+'?ref='+lock['head'])
    assert workflow['encoding']=='base64' and sha(base64.b64decode(workflow['content']))==lock['workflow_sha256']
    job=api('repos/'+repo+'/actions/jobs/'+str(lock['job_id']))
    for field,value in [('run_id',lock['run_id']),('run_attempt',lock['attempt']),('head_sha',lock['head']),('name',lock['job_name']),('status','completed'),('conclusion','success')]:assert job[field]==value,field
    artifact=api('repos/'+repo+'/actions/artifacts/'+str(lock['artifact_id']))
    assert artifact['name']==lock['artifact_name'] and artifact['expired'] is False
    assert artifact['workflow_run']['id']==lock['run_id'] and artifact['workflow_run']['head_sha']==lock['head']
    assert artifact['workflow_run']['repository_id']==lock['repository_id'] and artifact['workflow_run']['head_repository_id']==lock['repository_id']
    assert artifact['digest']=='sha256:'+lock['zip_sha256'] and artifact['size_in_bytes']==lock['zip_size']
    data=api('repos/'+repo+'/actions/artifacts/'+str(lock['artifact_id'])+'/zip',raw=True)
    assert len(data)==lock['zip_size'] and sha(data)==lock['zip_sha256']
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names=archive.namelist();assert len(names)==len(set(names))
        for entry in archive.infolist():
            p=Path(entry.filename);assert not p.is_absolute() and '..' not in p.parts
            assert not stat.S_ISLNK(entry.external_attr>>16), 'ZIP symlink rejected'
        record=json.loads(archive.read('compile-evidence.json'))
        assert record['status']=='compile-only-unadmitted' and record['installed_native_qualification'] is False
        assert (record['source_head'],record['run_id'],record['run_attempt'],record['os'])==(lock['head'],lock['run_id'],lock['attempt'],'debian')
        assert record['recipe_manifest_sha256']==lock['recipe_sha256']
        actual_names={n for n in names if not n.endswith('/')}
        assert actual_names==set(record['files'])|{'compile-evidence.json'}, 'Closed artifact inventory required'
        for name,spec in record['files'].items():
            item=archive.read(name);assert len(item)==spec['size'] and sha(item)==spec['sha256']
        assert sha(archive.read('compile-proof.json'))==record['compile_proof_sha256']==lock['proof_sha256']
        destination.mkdir()
        for name in sorted(actual_names):
            path=destination/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(archive.read(name))
    (destination/'authenticated-producer.json').write_text(json.dumps({'kind':'util-authenticated-compile-input','status':'compile-only-unadmitted','native_qualified':False,'lock_sha256':sha(json.dumps(lock,sort_keys=True).encode()),'successful_job_id':lock['job_id'],'run_id':lock['run_id'],'head':lock['head'],'artifact_id':lock['artifact_id'],'archive_sha256':sha(data),'whole_workflow_conclusion':run['conclusion'],'scope':'Successful Debian producer job authenticated; other OS job outcome is separate'},indent=2)+'\n')
if __name__=='__main__':fetch(json.loads(Path(sys.argv[1]).read_text()),Path(sys.argv[2]))
