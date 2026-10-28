"""Bind successful package-only/native gates; final admission remains external."""
import hashlib,json,os,sys
from pathlib import Path
packages,native,lock_path=map(Path,sys.argv[1:]);
status=json.loads((packages/'package-status.json').read_text());assert status=={'kind':'util-package-transport','status':'package-only-unadmitted','source_compiled':False,'native_admitted':False,'exit_codes':{'source':0,'mount':0,'plan':0}}
assert all(type(code)is int and code==0 for code in status['exit_codes'].values())
native_status=json.loads((native/'native-status.json').read_text())
assert native_status=={'kind':'util-native-transport','status':'native-unadmitted','native_qualified':False,'exit_code':0}
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
behavior=json.loads((native/'nsenter-candidate.json').read_text());assert behavior['status']=='behavior-passed-unadmitted' and behavior['native_qualified'] is False and behavior['phase']=='candidate' and behavior['kernel_namespace_entry_required'] is True
assert all(type(result['exit_code'])is int and result['exit_code']==0 for result in behavior['results'])
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
