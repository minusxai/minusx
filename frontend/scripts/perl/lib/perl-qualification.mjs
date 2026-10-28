/** Immutable Perl dependency admission. A prior qualification is never a current-attempt source build. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const perlFamily=['perl-base','perl','perl-modules-5.40','libperl5.40','libperl-dev'];
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>assert.match(value??'',/^[a-f0-9]{64}$/);
const positive=value=>assert.ok(Number.isSafeInteger(value)&&value>0);
const exactKeys=(value,keys)=>assert.deepEqual(Object.keys(value).sort(),[...keys].sort());
export function validatePerlLock(lock){
 exactKeys(lock,['schema','component','status','qualifications']);assert.equal(lock.schema,1);assert.equal(lock.component,'perl');assert.equal(lock.status,'qualified','Perl dependency has no successful immutable qualification');
 assert.ok(Array.isArray(lock.qualifications)&&lock.qualifications.length>0&&lock.qualifications.length<=16);
 const seen=new Set();
 for(const item of lock.qualifications){
  assert.ok(item.cold,'Qualification requires separately authenticated successful cold evidence');
  validatePerlRecord(item.cold,{cold:true});
  validatePerlRecord(item);
  for(const key of ['recipe_sha256','profile_sha256','base_index','base_child','platform'])assert.equal(item[key],item.cold[key]);
  assert.ok(item.repository!==item.cold.repository||item.run_id!==item.cold.run_id,'Cold evidence and reviewed admission must be genuinely separate runs');
  assert.ok(!seen.has(item.profile_sha256),'Duplicate qualification profile');seen.add(item.profile_sha256);
 }
 return lock.qualifications;
}
export function validateColdPerlLock(lock){
 exactKeys(lock,['schema','component','status','qualifications']);assert.equal(lock.schema,1);assert.equal(lock.component,'perl');assert.equal(lock.status,'reviewed-cold-evidence','No reviewed successful cold artifact is pinned');
 assert.ok(Array.isArray(lock.qualifications)&&lock.qualifications.length>0&&lock.qualifications.length<=16);const seen=new Set();
 for(const item of lock.qualifications){validatePerlRecord(item,{cold:true});assert.ok(!seen.has(item.profile_sha256));seen.add(item.profile_sha256);}return lock.qualifications;
}
function validatePerlRecord(item,{cold=false}={}){
  exactKeys(item,['repository','run_id','run_attempt','source_sha','workflow_path','workflow_sha256','job_name','job_id','artifact_id','artifact_name','artifact_digest','recipe_sha256','base_index','base_child','platform','profile_sha256',...(cold?[]:['cold'])]);
  assert.match(item.repository,/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);positive(item.run_id);positive(item.run_attempt);positive(item.artifact_id);positive(item.job_id);assert.match(item.source_sha,/^[a-f0-9]{40}$/);
  for(const name of ['workflow_sha256','recipe_sha256','profile_sha256'])digest(item[name]);
  for(const name of ['artifact_digest','base_child'])assert.match(item[name],/^sha256:[a-f0-9]{64}$/);
  assert.match(item.base_index,/^node:22\.23\.4-trixie-slim@sha256:[a-f0-9]{64}$/);assert.equal(item.platform,'linux/amd64');assert.equal(item.workflow_path,cold?'.github/workflows/qualify-perl.yml':'.github/workflows/admit-perl.yml');
  assert.match(item.job_name,cold?/^Qualify Perl \([a-z0-9-]+\)$/:/^Admit Perl \([a-z0-9-]+\)$/);assert.match(item.artifact_name,cold?/^cold-perl-[a-z0-9-]+$/:/^qualified-perl-[a-z0-9-]+$/);
}
export function admitPerlProducer(record,{run,artifact,jobs,workflowBytes}){
 assert.equal(run.id,record.run_id);assert.equal(run.run_attempt,record.run_attempt);assert.equal(run.head_sha,record.source_sha);assert.equal(run.status,'completed');assert.equal(run.conclusion,'success','Cold qualification workflow must succeed, including packaging and native gates');
 assert.equal(run.path,record.workflow_path);assert.equal(sha256(workflowBytes),record.workflow_sha256);
 const selected=jobs.filter(job=>job.name===record.job_name);assert.equal(selected.length,1);assert.equal(selected[0].id,record.job_id);assert.equal(selected[0].run_id,record.run_id);assert.equal(selected[0].run_attempt,record.run_attempt);assert.equal(selected[0].status,'completed');assert.equal(selected[0].conclusion,'success');
 assert.equal(artifact.id,record.artifact_id);assert.equal(artifact.name,record.artifact_name);assert.equal(artifact.expired,false);assert.equal(artifact.digest,record.artifact_digest);assert.equal(artifact.workflow_run.id,record.run_id);assert.equal(artifact.workflow_run.head_sha,record.source_sha);
 assert.ok(Date.parse(selected[0].started_at)>=Date.parse(run.run_started_at),'Producer job predates exact attempt');
 assert.ok(Date.parse(artifact.created_at)>=Date.parse(selected[0].started_at),'Artifact predates exact successful producer job');
 assert.ok(Date.parse(artifact.created_at)>=Date.parse(run.run_started_at),'Artifact predates qualification attempt');
 assert.ok(Date.parse(artifact.created_at)<=Date.parse(selected[0].completed_at),'Artifact is outside successful producer job');
}
function packageOriginal(item){
 exactKeys(item,['version','architecture','files','controls']);assert.equal(typeof item.version,'string');assert.ok(item.version);assert.ok(['amd64','all'].includes(item.architecture));
 for(const type of ['files','controls']){
  assert.ok(item[type]&&Object.keys(item[type]).length,'Complete original '+type+' required');
  for(const [path,file]of Object.entries(item[type])){
   assert.ok(path.startsWith('/')&&!path.split('/').includes('..'));assert.ok(['file','link','directory','absent'].includes(file.type));
   if(file.type==='absent'){exactKeys(file,['type']);continue;}
   assert.ok(Number.isSafeInteger(file.mode)&&file.mode>=0&&file.mode<=0o7777);assert.ok(Number.isSafeInteger(file.uid)&&file.uid>=0&&Number.isSafeInteger(file.gid)&&file.gid>=0);
   if(file.type==='file')digest(file.sha256);if(file.type==='link')assert.equal(typeof file.target,'string');
  }
 }
}
function configuration(value){assert.equal(value?.available,true,'Actual complete Perl Config is required; absence is not a wildcard');assert.ok(value.mapping&&Object.keys(value.mapping).length>17,'A selected Config key subset is insufficient');assert.ok(value.files&&Object.keys(value.files).length,'Original native configuration files must be bound');for(const file of Object.values(value.files)){if(file.type==='link')assert.equal(typeof file.target,'string');else digest(file.sha256);}}
export function validatePerlPayload(proof,entries,record){
 exactKeys(proof,['schema','component','recipe_sha256','base_index','base_child','platform','profile_sha256','cold_source_sha','cold_artifact_digest','original_configuration','candidate_configuration','packages','inventory','gates']);
 assert.equal(proof.schema,1);assert.equal(proof.component,'perl');
 assert.equal(proof.cold_source_sha,record.cold.source_sha);assert.equal(proof.cold_artifact_digest,record.cold.artifact_digest);
 for(const key of ['recipe_sha256','base_index','base_child','platform','profile_sha256'])assert.equal(proof[key],record[key]);
 configuration(proof.original_configuration);configuration(proof.candidate_configuration);
 assert.ok(proof.packages&&Object.keys(proof.packages).length);assert.ok(Object.hasOwn(proof.packages,'perl-base'));
 const expected=[];
 for(const [name,item]of Object.entries(proof.packages)){
  assert.ok(perlFamily.includes(name),'Unsupported qualified Perl package: '+name);exactKeys(item,['original','candidate','deb','receipts']);packageOriginal(item.original);packageOriginal(item.candidate);
  assert.equal(item.candidate.version,item.original.version+'+runtime1');assert.equal(item.candidate.architecture,item.original.architecture);
  assert.equal(item.deb.name,'packages/'+name+'.deb');digest(item.deb.sha256);positive(item.deb.size);expected.push(item.deb.name);
  assert.ok(Array.isArray(item.receipts)&&item.receipts.length>0);for(const path of item.receipts){assert.ok(path.startsWith('receipts/'+name+'/')&&!path.split('/').includes('..'));expected.push(path);}
 }
 assert.equal(new Set(expected).size,expected.length,'Duplicate qualified payload/receipt');
 assert.deepEqual(Object.keys(proof.inventory).sort(),expected.sort(),'Complete expected qualified package/receipt inventory required');
 const payload=entries.filter(entry=>entry.name!=='qualification.json');assert.deepEqual(payload.map(entry=>entry.name).sort(),expected,'Missing or surplus qualified package/receipt');
 for(const entry of payload){assert.equal(entry.target,undefined,'Qualification payloads must be regular files');const wanted=proof.inventory[entry.name];exactKeys(wanted,['sha256','mode','size']);assert.equal(sha256(entry.bytes),wanted.sha256);assert.equal(entry.mode,wanted.mode);assert.equal(entry.bytes.length,wanted.size);}
 for(const item of Object.values(proof.packages)){const entry=payload.find(entry=>entry.name===item.deb.name);assert.equal(sha256(entry.bytes),item.deb.sha256);assert.equal(entry.bytes.length,item.deb.size);}
 exactKeys(proof.gates,['static_suite','shared_suite','debug_build','source_signature','source_patches','package_inventory','dependency_closure','staged_native','installed_native','full_config_comparison','cold_started_at','cold_completed_at','log_sha256']);
 for(const key of ['static_suite','shared_suite','debug_build','source_signature','source_patches','package_inventory','dependency_closure','staged_native','installed_native','full_config_comparison'])assert.equal(proof.gates[key].status,'passed','Required cold qualification gate missing: '+key);
 for(const key of ['static_suite','shared_suite']){positive(proof.gates[key].scripts);positive(proof.gates[key].tests);assert.ok(Array.isArray(proof.gates[key].skips),'Original suite skip reasons must be retained');}
 assert.ok(Date.parse(proof.gates.cold_completed_at)>Date.parse(proof.gates.cold_started_at));digest(proof.gates.log_sha256);
 return proof;
}
export function configurationForPackages(value,packages){
 configuration(value);const files=Object.fromEntries(Object.entries(value.files).filter(([path])=>Object.values(packages).some(item=>Object.hasOwn(item.files,path))));
 assert.ok(Object.keys(files).length,'Every complete native configuration file must have an admitted package owner');return {...value,files};
}
export function selectPerlPackages(proof,consumer){
 configuration(consumer.configuration);assert.deepEqual(consumer.configuration,configurationForPackages(proof.original_configuration,Object.fromEntries(Object.keys(consumer.packages).map(name=>[name,proof.packages[name]?.original??{files:{}}]))),'Actual original full Perl configuration differs from exact qualified package counterparts');
 const names=Object.keys(consumer.packages).sort();assert.ok(names.includes('perl-base'));assert.ok(names.length);
 for(const name of consumer.unsupported??[])throw Error('Unsupported installed native Perl package: '+name);
 for(const name of names){assert.ok(perlFamily.includes(name),'Unsupported installed Perl package: '+name);assert.ok(Object.hasOwn(proof.packages,name),'No qualified counterpart for installed package: '+name);packageOriginal(consumer.packages[name]);assert.deepEqual(consumer.packages[name],proof.packages[name].original,'Original package bytes/control/link/mode differ: '+name);}
 return names.map(name=>({name,...proof.packages[name]}));
}

/** Only rebuilt native/CORE/generated Config bytes and new provenance docs may change. */
export function assertPerlOverlay(original,candidate){
 assert.deepEqual(Object.keys(candidate.packages).sort(),Object.keys(original.packages).sort());
 for(const [name,before]of Object.entries(original.packages)){
  const after=candidate.packages[name];assert.equal(after.version,before.version+'+runtime1');assert.equal(after.architecture,before.architecture);
  for(const [path,old]of Object.entries(before.files)){
   const current=after.files[path];if(old.type==='absent'){assert.ok(!current||current.type==='absent','Previously absent original payload appeared: '+path);continue;}
   assert.ok(current,'Original present package path disappeared: '+path);
   for(const key of ['type','mode','uid','gid','target'])assert.deepEqual(current[key],old[key],'Original inventory metadata changed: '+path+' '+key);
   if(old.native===true)assert.equal(current.native,true,'Original native payload ceased to be ELF: '+path);
   if(old.type==='file'&&old.sha256!==current.sha256)assert.ok(old.native===true||path.includes('/CORE/')||/(?:^|\/)Config(?:_heavy|_git)?\.(?:pm|pl)$/.test(path),'Unexpected nonnative original payload drift: '+path);
  }
  for(const path of Object.keys(after.files))if(!Object.hasOwn(before.files,path))assert.match(path,/^\/usr\/share\/doc\/runtime-perl(?:\/|$)/,'Unexpected package inventory addition');
  for(const path of Object.keys(after.controls))if(!Object.hasOwn(before.controls,path))assert.match(path,/\.(?:status|list|md5sums)$/,'Unexpected new package maintainer control');
  for(const [path,old]of Object.entries(before.controls)){
   const current=after.controls[path];assert.ok(current,'Original package control disappeared: '+path);
   for(const key of ['type','mode','uid','gid','target'])assert.deepEqual(current[key],old[key],'Original control metadata changed: '+path);
   if(!/\.(?:status|list|md5sums)$/.test(path))assert.deepEqual(current,old,'Original maintainer/configuration control changed: '+path);
  }
 }
}

/** Verify pinned original profile bytes before any installed admission work. */
export function assertColdPerlProfile(bytes,record){
 assert.equal(sha256(bytes),record.profile_sha256,'Original profile bytes differ from reviewed cold profile');
 return JSON.parse(bytes);
}
