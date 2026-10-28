"""Bind namespace probe images to authenticated originals and fresh native receipts."""
import hashlib,io,json,re,subprocess,sys,tarfile,uuid
from pathlib import Path

def sha(data):return hashlib.sha256(data).hexdigest()
def command(*args):return subprocess.check_output(['docker',*args],timeout=60)
def copy_file(container,path):
    with tarfile.open(fileobj=io.BytesIO(command('cp',container+':'+path,'-'))) as archive:
        members=archive.getmembers();assert len(members)==1 and members[0].isfile()
        assert members[0].name==Path(path).name
        return archive.extractfile(members[0]).read()
def bind(original,candidate,packages,native,out):
    plan=json.loads((packages/'plan.json').read_text())
    expected_original='09ea3a612a16b59c04aa55d894a1e868deaddb8a6a9927c4f1993827a3554de1'
    payload={line.split()[1].lstrip('*./'):line.split()[0] for line in (packages/'runtime-payload.sha256').read_text().splitlines()}
    expected={'original':expected_original,'candidate':payload['usr/bin/nsenter']};records={}
    for label,image in [('original',original),('candidate',candidate)]:
        assert re.fullmatch(r'sha256:[0-9a-f]{64}',image)
        assert json.loads(command('image','inspect',image))[0]['Id']==image
        name='util-ns-binding-'+uuid.uuid4().hex
        try:
            command('create','--name',name,'--network','none','--read-only','--cap-drop','ALL','--entrypoint','/usr/bin/true',image)
            item=json.loads(command('inspect',name))[0]
            assert item['Image']==image and not item['HostConfig']['Privileged'] and not item['HostConfig']['Binds']
            assert sha(copy_file(name,'/usr/bin/nsenter'))==expected[label]
            if label=='original':assert sha(copy_file(name,'/var/lib/dpkg/status'))==plan['status_sha256']
            else:
                for path in sorted(native.iterdir()):
                    assert path.is_file() and not path.is_symlink()
                    assert copy_file(name,'/native-export/'+path.name)==path.read_bytes(),path.name
            records[label]={'image_id':image,'nsenter_sha256':expected[label]}
        finally:
            subprocess.run(['docker','rm','--force',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15,check=False)
    out.write_text(json.dumps({'kind':'namespace-image-provenance','status':'unadmitted','original_status_sha256':plan['status_sha256'],'original_source_proof_sha256':'91e393d7960901098ebe89f48fb36445391779673cede66abc43fa9ca3737cb1','native_files':{p.name:sha(p.read_bytes()) for p in native.iterdir()},'images':records},sort_keys=True,indent=2)+'\n')
if __name__=='__main__':bind(sys.argv[1],sys.argv[2],Path(sys.argv[3]),Path(sys.argv[4]),Path(sys.argv[5]))
