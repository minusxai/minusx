"""Bind successful package-only/native gates; final admission remains external."""
import hashlib,json,os,sys
from pathlib import Path
packages,native,lock_path=map(Path,sys.argv[1:]);lock=json.loads(lock_path.read_text())
plan=json.loads((packages/'plan.json').read_text());assert set(plan['packages'])=={'libmount1','util-linux','login','mount'}
assert (native/'plan.json').read_bytes()==(packages/'plan.json').read_bytes()
for name,spec in plan['packages'].items():assert hashlib.sha256((packages/'packages'/(name+'.deb')).read_bytes()).hexdigest()==spec['sha256']
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
