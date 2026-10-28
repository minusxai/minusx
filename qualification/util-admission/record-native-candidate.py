"""Bind successful package-only/native gates; final admission remains external."""
import hashlib,json,os,sys,re
from pathlib import Path
packages,native,lock_path=map(Path,sys.argv[1:]);
status=json.loads((packages/'package-status.json').read_text());assert status=={'kind':'util-package-transport','status':'package-only-unadmitted','source_compiled':False,'native_admitted':False,'exit_codes':{'source':0,'mount':0,'plan':0}}
assert all(type(code)is int and code==0 for code in status['exit_codes'].values())
native_status=json.loads((native/'native-status.json').read_text())
assert native_status in ({'kind':'util-native-transport','status':'native-unadmitted','native_qualified':False,'exit_code':0},{'kind':'util-native-transport','status':'native-unadmitted','native_qualified':False,'exit_code':1})
assert native_status['native_qualified'] is False and type(native_status['exit_code']) is int
lock=json.loads(lock_path.read_text())
origin=json.loads((packages/'authenticated-prepared-origin.json').read_text())
assert origin['kind']=='util-authenticated-prepared-packages' and origin['status']=='package-only-unadmitted' and origin['native_qualified'] is False
assert origin['source_compile_lock_sha256']==hashlib.sha256(lock_path.read_bytes()).hexdigest()
plan=json.loads((packages/'plan.json').read_text());assert set(plan['packages'])=={'libmount1','util-linux','login','mount'}
assert (native/'plan.json').read_bytes()==(packages/'plan.json').read_bytes()
for name,spec in plan['packages'].items():assert hashlib.sha256((packages/'packages'/(name+'.deb')).read_bytes()).hexdigest()==spec['sha256']
cache=json.loads((native/'apt-cache-priming.json').read_text());assert cache['status']=='cache-only-unadmitted' and cache['native_qualified'] is False and type(cache['network_fetches'])is int and cache['network_fetches']==0
assert set(cache['packages'])==set(plan['packages'])
for name,spec in plan['packages'].items():assert cache['packages'][name]['sha256']==spec['sha256']
gates=json.loads((native/'independent-gates.json').read_text())
assert set(gates)=={'kind','status','namespace','observation','final','apt','audit'} and gates['kind']=='util-native-independent-gates' and gates['status']=='unadmitted'
assert all(type(gates[key]) is int and gates[key]==0 for key in ('observation','final','apt','audit'))
assert type(gates['namespace']) is int and gates['namespace'] in (0,1) and native_status['exit_code']==gates['namespace']
behavior=json.loads((native/'nsenter-candidate.json').read_text())
assert behavior['native_qualified'] is False and behavior['phase']=='candidate' and behavior['kernel_namespace_entry_required'] is True
assert len(behavior['results'])==4
commands=[['nsenter','--version'],['unshare','--version'],['nsenter','--mount=/proc/self/ns/mnt','--','/usr/bin/true'],['nsenter','--mount=/proc/self/ns/mnt','--wd=/tmp','--','/usr/bin/pwd']]
assert [row['argv'] for row in behavior['results']]==commands
assert behavior['status']==('behavior-passed-unadmitted' if gates['namespace']==0 else 'behavior-failed-unadmitted')
for row,wanted in zip(behavior['results'][2:],['','/tmp\n']):
 assert type(row['exit_code']) is int
 if gates['namespace']==0:assert row['exit_code']==0 and row['stdout']==wanted and row['stderr']==''
 else:assert row['exit_code']==1 and row['stdout']=='' and row['stderr']=="nsenter: reassociate to namespace 'ns/mnt' failed: Operation not permitted\n"

for result,wanted in zip(behavior['results'][:2],['nsenter from util-linux 2.41.5\n','unshare from util-linux 2.41.5\n']):
 assert type(result['exit_code']) is int and result['exit_code']==0 and result['stdout']==wanted and result['stderr']==''
provenance=json.loads((native/'namespace-image-provenance.json').read_text())
assert provenance['kind']=='namespace-image-provenance' and provenance['status']=='unadmitted'
assert provenance['original_status_sha256']==plan['status_sha256'] and provenance['original_source_proof_sha256']==lock['proof_sha256']
assert set(provenance['images'])=={'original','candidate'}
payload={line.split()[1].lstrip('*./'):line.split()[0] for line in (packages/'runtime-payload.sha256').read_text().splitlines()}
for profile,wanted in [('original','09ea3a612a16b59c04aa55d894a1e868deaddb8a6a9927c4f1993827a3554de1'),('candidate',payload['usr/bin/nsenter'])]:
 item=provenance['images'][profile]
 assert set(item)=={'image_id','nsenter_sha256'} and item['nsenter_sha256']==wanted
 assert re.fullmatch(r'sha256:[0-9a-f]{64}',item['image_id'])

assert set(provenance['native_files'])=={p.name for p in native.iterdir()}-{'namespace-image-provenance.json','namespace-kernel-proof.json'}
for name,digest in provenance['native_files'].items():
 assert Path(name).name==name and hashlib.sha256((native/name).read_bytes()).hexdigest()==digest
kernel=json.loads((native/'namespace-kernel-proof.json').read_text())
assert kernel['kind']=='isolated-namespace-kernel-proof' and kernel['status']=='unadmitted' and kernel['default_security_policy'] is True
assert kernel['capabilities']==['SYS_ADMIN','SYS_CHROOT'] and len(kernel['results'])==4
assert {(row['profile'],row['cwd']) for row in kernel['results']}=={(profile,cwd) for profile in ('original','candidate') for cwd in (False,True)}
for row in kernel['results']:
 assert type(row['cwd']) is bool and row['passed'] is True and row['image_id']==provenance['images'][row['profile']]['image_id']
 assert type(row['exit_code']) is int and row['exit_code']==0 and type(row['transport_exit']) is int and row['transport_exit']==0
 assert row['stderr_sha256']==hashlib.sha256(b'').hexdigest()
 assert row['stdout_sha256']==hashlib.sha256(b'/tmp\n' if row['cwd'] else b'').hexdigest()
closure=json.loads((native/'dependency-closure.json').read_text());final=json.loads((native/'final-native.json').read_text());apt=json.loads((native/'apt-plan.json').read_text())
assert closure['status']=='closure-only-unadmitted' and closure['native_qualified'] is False
assert closure['baseline_sha256']==plan['status_sha256']
assert set(closure['candidate_names'])==set(plan['packages']) and closure['new_package_names']==[]
assert final['status']=='native-gates-passed-unadmitted' and final['actual_runtime_loader_checks']>=66
assert final['whole_status_package_count']==closure['checked_installed_packages']
assert final['manifest_sha256']==hashlib.sha256((packages/'final-native-manifest.json').read_bytes()).hexdigest()
assert apt['status']=='simulation-only-unadmitted' and apt['removals']==apt['new_names']==[]
assert set(apt['install_names'])==set(plan['packages'])
for name in ['dpkg-audit.stdout','dpkg-audit.stderr','apt-simulation.stderr']:assert (native/name).read_bytes()==b''
manifest={}
for root in [packages,native]:
 for path in sorted(root.rglob('*')):
  assert not path.is_symlink()
  if path.is_file():manifest[root.name+'/'+str(path.relative_to(root))]={'size':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
record={'kind':'util-package-native-candidate','status':'package-native-gates-passed-unadmitted','native_admitted':False,'source_compiled_in_this_workflow':False,'source_head':os.environ['GITHUB_SHA'],'run_id':int(os.environ['GITHUB_RUN_ID']),'run_attempt':int(os.environ['GITHUB_RUN_ATTEMPT']),'producer_lock_sha256':hashlib.sha256(lock_path.read_bytes()).hexdigest(),'producer_compile_proof_sha256':lock['proof_sha256'],'whole_producer_workflow_conclusion':lock['whole_run_conclusion'],'candidate_names':sorted(plan['packages']),'metadata_only_original_payload':['mount'],'files':manifest}
(native/'package-native-candidate.json').write_text(json.dumps(record,sort_keys=True,indent=2)+'\n')
