"""Explicitly authorized isolated namespace probe; no package installation.
Image arguments must be immutable local sha256 IDs from the qualification build.
"""
import hashlib,json,re,subprocess,sys,uuid
from pathlib import Path

def docker(*args):
    return subprocess.check_output(['docker',*args],text=True,timeout=60)

def probe(images,output):
    assert set(images)=={'original','candidate'}
    records=[]
    for label,image in sorted(images.items()):
        assert re.fullmatch(r'sha256:[0-9a-f]{64}',image)
        assert json.loads(docker('image','inspect',image))[0]['Id']==image
        for cwd in (False,True):
            name='util-ns-proof-'+uuid.uuid4().hex
            command=['--mount=/proc/self/ns/mnt']
            command+=['--wd=/tmp','--','/usr/bin/pwd'] if cwd else ['--','/usr/bin/true']
            try:
                docker('create','--name',name,'--network','none','--read-only',
                    '--cap-drop','ALL','--cap-add','SYS_ADMIN','--cap-add','SYS_CHROOT',
                    '--security-opt','no-new-privileges','--pids-limit','32',
                    '--memory','128m','--cpus','1','--user','0:0',
                    '--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=16m',
                    '--entrypoint','/usr/bin/nsenter',image,*command)
                inspect=json.loads(docker('inspect',name))[0];host=inspect['HostConfig'];config=inspect['Config']
                assert inspect['Image']==image and not host['Privileged']
                assert host['CapDrop']==['ALL'] and len(host['CapAdd'])==2 and set(host['CapAdd'])=={'CAP_SYS_ADMIN','CAP_SYS_CHROOT'}, ('Unexpected capabilities',host['CapDrop'],host['CapAdd'])
                assert host['ReadonlyRootfs'] and host['NetworkMode']=='none'
                assert not host['Binds']
                assert all(m['Type']=='tmpfs' and m['Destination']=='/tmp' for m in inspect['Mounts'])
                assert host['PidMode']=='' and host['IpcMode']=='private'
                assert host['PidsLimit']==32 and host['Memory']==134217728 and host['NanoCpus']==1000000000
                assert host['SecurityOpt']==['no-new-privileges']
                assert host['Tmpfs']=={'/tmp':'rw,noexec,nosuid,nodev,size=16m'}
                assert config['User']=='0:0' and config['Entrypoint']==['/usr/bin/nsenter'] and config['Cmd']==command
                result=subprocess.run(['docker','start','--attach',name],capture_output=True,timeout=30)
                exit_code=int(docker('inspect','--format','{{.State.ExitCode}}',name).strip())
                expected=b'/tmp\n' if cwd else b''
                passed=result.returncode==0 and exit_code==0 and result.stdout==expected and result.stderr==b''
                records.append({'profile':label,'image_id':image,'cwd':cwd,'exit_code':exit_code,
                    'transport_exit':result.returncode,'stdout_sha256':hashlib.sha256(result.stdout).hexdigest(),
                    'stderr_sha256':hashlib.sha256(result.stderr).hexdigest(),'passed':passed})
            finally:
                subprocess.run(['docker','rm','--force',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False,timeout=15)
    receipt={'kind':'isolated-namespace-kernel-proof','status':'unadmitted',
        'capabilities':['SYS_ADMIN','SYS_CHROOT'],'default_security_policy':True,'results':records}
    output.write_text(json.dumps(receipt,sort_keys=True,indent=2)+'\n')
    assert len(records)==4 and all(row['passed'] for row in records),'Mandatory original/candidate namespace proof failed'

if __name__=='__main__':
    assert len(sys.argv)==4
    probe({'original':sys.argv[1],'candidate':sys.argv[2]},Path(sys.argv[3]))
