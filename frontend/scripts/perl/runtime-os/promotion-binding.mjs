/** Bind preparation/final checks to the externally authenticated public promotion. */
import assert from 'node:assert/strict';
import {sha256,selectPerlPackages,configurationForPackages} from '../lib/perl-qualification.mjs';
export function assertPromotionBinding({proofBytes,origin,lock}){
 const proof=JSON.parse(proofBytes);
 assert.equal(lock.schema,1);assert.equal(lock.mode,'public-reviewed-source-reattestation');
 assert.equal(origin.schema,1);assert.equal(origin.kind,'authenticated-public-reviewed-perl-promotion');
 assert.equal(proof.schema,1);assert.equal(proof.component,'perl');assert.equal(proof.kind,'perl-sanitized-promotion-input');assert.equal(proof.status,'reviewed-source-evidence');
 assert.equal(proof.source_compiled_in_promotion,false);assert.equal(origin.source_compiled_in_promotion,false);assert.equal(origin.source_tests_rerun_in_promotion,false);
 assert.equal(sha256(proofBytes),lock.manifest_sha256);assert.equal(origin.manifest_sha256,lock.manifest_sha256);
 for(const key of ['repository','run_id','run_attempt','workflow_sha256','job_id','artifact_id','artifact_digest','original_profile_sha256','base_index','base_child','platform'])assert.equal(origin[key],lock[key],'Public promotion binding differs: '+key);
 assert.equal(origin.source_head,lock.head_sha);assert.equal(proof.original_profile_sha256,lock.original_profile_sha256);
 for(const key of ['base_index','base_child','platform'])assert.equal(proof[key],lock[key]);
 assert.equal(proof.platform,'linux/amd64');
 return proof;
}
export function assertAdmissionSelection(proof,receipt){
 const selected=selectPerlPackages(proof,{packages:receipt.original_packages,configuration:receipt.original_configuration,unsupported:[]});
 assert.deepEqual(receipt.packages,Object.fromEntries(selected.map(item=>[item.name,item.candidate])));
 assert.deepEqual(receipt.candidate_configuration,configurationForPackages(proof.candidate_configuration,receipt.packages));
 assert.deepEqual(receipt.deb_sha256,Object.fromEntries(selected.map(item=>[item.name+'.deb',item.deb.sha256])));
 return selected;
}
