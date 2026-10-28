"""Authenticate one already published public image; never build or publish it."""
import base64
import hashlib
import json
import pathlib
import re
import subprocess
import sys


def verify(lock, run, jobs, package, version, workflow, log):
    for field in ('repository_id','run_id','attempt','job_id','package_version_id'):
        assert type(lock[field]) is int and lock[field] > 0
    assert lock['repository'] == 'minusxai/minusx' and lock['package'] == 'minusx-frontend-canary'
    assert re.fullmatch(r'[a-f0-9]{40}',lock['source_head'])
    assert re.fullmatch(r'sha256:[a-f0-9]{64}',lock['image_digest'])
    assert type(run['id']) is int and type(run['run_attempt']) is int
    assert run['id'] == lock['run_id'] and run['repository']['id'] == lock['repository_id']
    assert run['head_sha'] == lock['source_head'] and run['run_attempt'] == lock['attempt']
    assert run['status'] == 'completed' and run['conclusion'] == 'success'
    assert run['path'] == '.github/workflows/publish.yml'
    job = next(j for j in jobs['jobs'] if j['id'] == lock['job_id'])
    assert type(job['id']) is int and type(job['run_attempt']) is int
    assert job['run_attempt'] == lock['attempt'] and job['status'] == 'completed' and job['conclusion'] == 'success'
    assert package['visibility'] == 'public' and package['name'] == lock['package']
    assert package['repository']['id'] == lock['repository_id']
    assert type(version['id']) is int
    assert version['id'] == lock['package_version_id'] and version['name'] == lock['image_digest']
    assert job['started_at'] <= version['created_at'] <= job['completed_at']
    assert lock['source_head'][:7] in version['metadata']['container']['tags']
    assert hashlib.sha256(workflow).hexdigest() == lock['workflow_sha256']
    assert hashlib.sha256(log).hexdigest() == lock['publisher_log_sha256']
    assert lock['image_digest'].encode() in log
    return 'ghcr.io/' + lock['repository'].split('/')[0] + '/' + lock['package'] + '@' + lock['image_digest']


def main(lock_path, output):
    lock = json.loads(pathlib.Path(lock_path).read_text())
    def api(endpoint, raw=False):
        data = subprocess.check_output(['gh','api',endpoint],timeout=90)
        return data if raw else json.loads(data)
    repo = lock['repository']; owner = repo.split('/')[0]
    run = api(f'repos/{repo}/actions/runs/{lock["run_id"]}')
    jobs = api(f'repos/{repo}/actions/runs/{lock["run_id"]}/attempts/{lock["attempt"]}/jobs')
    package = api(f'orgs/{owner}/packages/container/{lock["package"]}')
    version = api(f'orgs/{owner}/packages/container/{lock["package"]}/versions/{lock["package_version_id"]}')
    source = api(f'repos/{repo}/contents/.github/workflows/publish.yml?ref={lock["source_head"]}')
    workflow = base64.b64decode(source['content'])
    log = api(f'repos/{repo}/actions/jobs/{lock["job_id"]}/logs',True)
    image = verify(lock,run,jobs,package,version,workflow,log)
    pathlib.Path(output).write_text(json.dumps({'kind':'authenticated-existing-public-image-origin','image_ref':image,'source_head':lock['source_head'],'lock_sha256':hashlib.sha256(pathlib.Path(lock_path).read_bytes()).hexdigest(),'publisher_run_id':lock['run_id'],'publisher_job_id':lock['job_id'],'new_image_published':False,'application_deployed':False},indent=2)+'\n')
    print(image)


if __name__ == '__main__':
    main(*sys.argv[1:])
