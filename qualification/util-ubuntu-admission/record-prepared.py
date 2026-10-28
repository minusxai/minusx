"""No package install or native acceptance; bind only exact preparation outputs."""
import hashlib,json,sys,re
from pathlib import Path
p=Path(sys.argv[1])
assert p.is_dir() and not p.is_symlink()
for entry in p.rglob('*'):
 assert not entry.is_symlink() and (entry.is_file() or entry.is_dir()), 'Nonregular candidate entry'
status=json.loads((p/'transport-status.json').read_text())
assert status=={'kind':'ubuntu-util-package-transport','status':'unadmitted','exit_code':0,'candidate_installed':False,'native_qualified':False}
assert type(status['exit_code'])is int and status['candidate_installed']is False and status['native_qualified']is False
prepared=json.loads((p/'package-status.json').read_text())
assert all(prepared[key]is False for key in ('source_recompiled','candidate_installed','native_qualified'))
assert prepared=={'kind':'ubuntu-util-package-preparation','status':'three-packages-prepared-unadmitted','source_recompiled':False,'candidate_installed':False,'native_qualified':False}
plan=json.loads((p/'plan.json').read_text())
assert type(plan)is dict and set(plan)=={'kind','status','status_sha256','architecture','packages','target_binding_sha256','source_builder_status_not_runtime_binding'}
assert plan['kind']=='util-ubuntu-three-package-review-candidate' and plan['architecture']=='amd64' and plan['source_builder_status_not_runtime_binding']is True
assert type(plan['packages'])is dict and all(type(value)is dict for value in plan['packages'].values())
assert plan['target_binding_sha256']==hashlib.sha256((p/'target-binding.json').read_bytes()).hexdigest()
assert set(plan['packages'])=={'util-linux','libmount1','mount'} and plan['status']=='UNADMITTED-PACKAGE-PLAN'
assert plan['status_sha256']=='afe797abc46863435d51b0468fa26642fca16d73a4dc85335f73f4623f7e1df9'
assert {x.name for x in (p/'packages').iterdir()}=={name+'.deb'for name in plan['packages']}
for name,spec in plan['packages'].items():
 assert set(spec)=={'original_version','candidate_version','sha256','source','mode'} and all(type(value)is str for value in spec.values())
 assert spec['original_version']=='2.42.2-1ubuntu2' and spec['candidate_version']==spec['original_version']+('+metadata20261028.1' if name=='mount' else '+security20261028')
 assert spec['source']==('util-linux (2.42.2-1ubuntu2)'if name=='mount'else'util-linux')
 assert spec['mode']==('metadata-only-original-payload'if name=='mount'else'retained-corrected-source-payload')
 assert re.fullmatch('[0-9a-f]{64}',spec['sha256']) and hashlib.sha256((p/'packages'/(name+'.deb')).read_bytes()).hexdigest()==spec['sha256']
assert json.loads((p/'evidence-binding.json').read_text())['native_qualified']is False
record={'kind':'ubuntu-util-prepared-candidate','status':'package-prepared-unadmitted','candidate_installed':False,'native_qualified':False,'files':{str(x.relative_to(p)):{'size':x.stat().st_size,'sha256':hashlib.sha256(x.read_bytes()).hexdigest()}for x in p.rglob('*')if x.is_file()}}
(p/'prepared-candidate.json').write_text(json.dumps(record,sort_keys=True,indent=2)+'\n')
