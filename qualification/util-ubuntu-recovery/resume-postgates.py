"""Replay only missing gates on authenticated retained-source context; no full build."""
import hashlib,json,subprocess,sys
from pathlib import Path
recipe,checks,source,retained,original,out=map(Path,sys.argv[1:])
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
inventory=json.loads((original/'raw-input-inventory.json').read_text())
assert inventory['status']=='unadmitted' and inventory['native_qualified'] is False
pins=json.loads((checks/'reconstruction-inputs.json').read_text())
for name,digest in pins['source_inputs'].items():
    assert sha(source/name)==digest==inventory['compiled_source_inventory'][name]['sha256'],name
for name,digest in pins['retained_inputs'].items():assert sha(retained/name)==digest,name
header=(source/'libmount/src/libmount.h.in').read_bytes()
for name,value in pins['header_substitutions'].items():
    token=('@'+name+'@').encode();assert header.count(token)==1;header=header.replace(token,value.encode())
assert hashlib.sha256(header).hexdigest()==inventory['compiled_source_inventory']['libmount/src/libmount.h']['sha256']==pins['generated_header_sha256']
(source/'libmount/src/libmount.h').write_bytes(header)
out.mkdir()
subprocess.run(['python3',str(recipe/'compare_pristine.py'),str(retained/'original'),str(out/'pristine-replay.json')],check=True)
# Retained complete source suite is independently re-parsed, never rerun/relabelled.
subprocess.run(['python3',str(recipe/'check-source-suite.py'),str(original/'source-build.log'),str(out/'retained-source-suite-summary.json'),'367'],check=True)
assert json.loads((out/'retained-source-suite-summary.json').read_text())==json.loads((original/'source-suite-summary.json').read_text())
subprocess.run(['python3',str(checks/'check-idmap-header.py'),str(source),str(out/'idmap-header-regression.json'),str(retained/'runtime-config.h')],check=True)
subprocess.run(['python3',str(recipe/'check-openat-resolve.py'),str(source),str(out/'openat-resolve-regression.json'),str(retained/'runtime-config.h')],check=True)
subprocess.run(['python3',str(recipe/'check-source.py'),str(source),str(out/'source-regression.json'),'--fixtures'],check=True)
assert json.loads((out/'source-regression.json').read_text())['fixtures_executed']==['ordinary-cgroup-fd-lifecycle','ordinary-mount-status','ordinary-source-canonicalization']
assert '#define USE_LIBMOUNT_MOUNTFD_SUPPORT 1' not in (retained/'runtime-config.h').read_text()
assert '--disable-libmount-mountfd-support' in (source/'debian/rules').read_text()
# Link the exact retained built library, never an installed old provider/dev symlink.
name='libmount1_2.42.2-1ubuntu2+security20261028_amd64.deb'
assert sha(retained/name)==inventory['available_debs'][name]['sha256']
payload=out/'retained-libmount';subprocess.run(['dpkg-deb','-x',str(retained/name),str(payload)],check=True)
library=payload/'usr/lib/x86_64-linux-gnu/libmount.so.1.1.0';assert library.is_file() and not library.is_symlink()
subprocess.run(['cc','-O2','-Wall','-Wextra','-Werror','-I'+str(source/'libmount/src'),'-I'+str(retained),str(recipe/'check-util-linux.c'),str(library),'-o',str(out/'check-util-linux')],check=True)
# The helper is compiled here; actual mixed-install execution remains a later gate.
receipt={'kind':'ubuntu-retained-source-postgate-replay','status':'postgates-replayed-native-unadmitted','original_source_job_conclusion':'failure','full_util_source_recompiled':False,'native_qualification_complete':False,'full_source_suite_rerun':False,'retained_source_log_sha256':sha(original/'source-build.log'),'raw_archive_sha256':sha(original/'raw-work-inputs.tar'),'context_inputs':pins,'check_util_linux_sha256':sha(out/'check-util-linux'),'library_link_input_sha256':sha(library),'ordinary_fixtures':3,'additional_gate_families':['configured-idmap-header','openat-resolver'],'helper_executed':False}
(out/'recovery-postgates.json').write_text(json.dumps(receipt,indent=2)+'\n')
