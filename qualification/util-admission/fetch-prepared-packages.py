"""Authenticate prepared four-package bytes from a failed native qualification.
Host-only GitHub token transport; no credential enters a build context.
"""
import base64,hashlib,json,stat,subprocess,sys,zipfile,io
from pathlib import Path

def sha(data):return hashlib.sha256(data).hexdigest()
def api(path,raw=False):
    data=subprocess.check_output(['gh','api',path])
    return data if raw else json.loads(data)
def fetch(lock,destination):
    assert set(lock)=={'repository','repository_id','run_id','attempt','head','branch','workflow_path','workflow_sha256','job_id','job_name','artifact_id','artifact_name','zip_sha256','zip_size','whole_run_conclusion','files','source_compile_lock_sha256'}
    repo=lock['repository'];assert repo=='minusxai/minusx'
    assert api('repos/'+repo)['id']==lock['repository_id']
    run=api('repos/'+repo+'/actions/runs/'+str(lock['run_id']))
    for field,value in [('id',lock['run_id']),('run_attempt',lock['attempt']),('head_sha',lock['head']),('head_branch',lock['branch']),('path',lock['workflow_path']),('event','push')]:assert run[field]==value,field
    assert run['status']=='completed' and run['conclusion']==lock['whole_run_conclusion'] and run['conclusion'] in ('success','failure')
    assert run['repository']['id']==lock['repository_id'] and run['head_repository']['id']==lock['repository_id']
    workflow=api('repos/'+repo+'/contents/'+lock['workflow_path']+'?ref='+lock['head'])
    assert workflow['encoding']=='base64' and sha(base64.b64decode(workflow['content']))==lock['workflow_sha256']
    source_lock=api('repos/'+repo+'/contents/qualification/util-admission/debian-compile.lock.json?ref='+lock['head'])
    assert source_lock['encoding']=='base64' and sha(base64.b64decode(source_lock['content']))==lock['source_compile_lock_sha256']
    job=api('repos/'+repo+'/actions/jobs/'+str(lock['job_id']))
    for field,value in [('run_id',lock['run_id']),('run_attempt',lock['attempt']),('head_sha',lock['head']),('name',lock['job_name']),('status','completed'),('conclusion','failure')]:assert job[field]==value,field
    required={'Authenticate immutable successful source job and closed input bytes','Retain package-only candidate before fresh runtime qualification','Require complete typed package gates before native transaction'}
    assert all(sum(step['name']==name and step['status']=='completed' and step['conclusion']=='success' for step in job['steps'])==1 for name in required)
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
        actual_names={n for n in names if not n.endswith('/')}
        assert actual_names==set(lock['files']), 'Exact closed failed-source inventory required'
        for name,spec in lock['files'].items():
            item=archive.read(name);assert len(item)==spec['size'] and sha(item)==spec['sha256']
        prefix='util-package-candidate/'
        status=json.loads(archive.read(prefix+'package-status.json'))
        assert status=={'kind':'util-package-transport','status':'package-only-unadmitted','source_compiled':False,'native_admitted':False,'exit_codes':{'source':0,'mount':0,'plan':0}}
        assert status['source_compiled'] is False and status['native_admitted'] is False
        assert all(type(value)is int and value==0 for value in status['exit_codes'].values())
        plan=json.loads(archive.read(prefix+'plan.json'))
        assert set(plan['packages'])=={'libmount1','util-linux','login','mount'}
        for name,spec in plan['packages'].items():assert sha(archive.read(prefix+'packages/'+name+'.deb'))==spec['sha256']
        destination.mkdir()
        for name in sorted(n for n in actual_names if n.startswith(prefix)):
            path=destination/name.removeprefix(prefix);path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(archive.read(name))
    (destination/'authenticated-prepared-origin.json').write_text(json.dumps({'kind':'util-authenticated-prepared-packages','status':'package-only-unadmitted','native_qualified':False,'producer_native_job_conclusion':'failure','head':lock['head'],'run_id':lock['run_id'],'artifact_id':lock['artifact_id'],'archive_sha256':sha(data),'source_compile_lock_sha256':lock['source_compile_lock_sha256']},indent=2)+'\n')
if __name__=='__main__':fetch(json.loads(Path(sys.argv[1]).read_text()),Path(sys.argv[2]))
