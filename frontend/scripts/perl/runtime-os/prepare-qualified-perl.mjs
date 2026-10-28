/** Fresh original-profile admission and read-only closure, before any runtime installation. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {capturePerlProfile} from './capture-perl-profile.mjs';
import {selectPerlPackages,configurationForPackages,sha256} from '../lib/perl-qualification.mjs';
import {assertPromotionBinding} from './promotion-binding.mjs';
assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
const [input,output]=process.argv.slice(2);assert.ok(input&&output);const proofBytes=readFileSync(join(input,'proof.json')),origin=JSON.parse(readFileSync(join(input,'origin.json'))),lock=JSON.parse(readFileSync(join(input,'promotion-lock.json')));
const proof=assertPromotionBinding({proofBytes,origin,lock}),original=capturePerlProfile(),selected=selectPerlPackages(proof,original);
assert.equal(sha256(JSON.stringify(original)+'\n'),proof.original_profile_sha256,'Fresh complete original Perl profile differs from the authenticated promotion');
assert.equal(sha256(readFileSync(join(input,'proof.json'))),origin.manifest_sha256);assert.deepEqual(readdirSync(join(input,'packages')).sort(),selected.map(item=>item.name+'.deb').sort());
mkdirSync(output);for(const [source,target]of [['proof.json','perl-promotion-proof.json'],['origin.json','perl-promotion-origin.json'],['promotion-lock.json','perl-promotion-lock.json']])copyFileSync(join(input,source),join(output,target));const work='/perl-fresh-closure';mkdirSync(work);writeFileSync(join(work,'baseline-dpkg-status'),readFileSync('/var/lib/dpkg/status'));writeFileSync(join(work,'runtime-profile.tsv'),selected.map(item=>item.name+'\t'+item.original.version+'\n').join(''));
for(const item of selected){const path=join(input,'packages',item.name+'.deb');assert.equal(sha256(readFileSync(path)),item.deb.sha256);copyFileSync(path,join(output,item.name+'.deb'));}
const clean={...process.env};for(const key of Object.keys(clean))if(/^(?:LD_|DYLD_|PERL)/.test(key)||key==='GLIBC_TUNABLES')delete clean[key];
const runtime=JSON.parse(readFileSync('/qualification-tools/tool-runtime.json'));
const tools={...clean,PYTHONHOME:'/qualification-tools/usr',DPKG_DATADIR:'/qualification-tools/usr/share/dpkg',PATH:'/qualification-tools/resolver-bin:/qualification-tools/usr/bin:/usr/bin:/bin',LD_LIBRARY_PATH:'/qualification-tools/usr/lib/x86_64-linux-gnu'};
const execute=args=>execFileSync(runtime.loader,['--library-path',runtime.library_path,runtime.python,...args],{env:tools,encoding:'utf8',maxBuffer:32*1024*1024});
copyFileSync('/tool-closure.json',join(output,'perl-current-tool-closure.json'));
writeFileSync(join(output,'perl-current-resolver-controls.log'),execute(['/checks/test-closure.py']));
const log=execute(['/checks/check-dependencies.py',work,'--deb-directory',output,'--read-only-debs']);writeFileSync(join(output,'perl-current-closure.log'),log);
copyFileSync(join(work,'dependency-closure.json'),join(output,'perl-current-closure.json'));
for(const item of selected)assert.equal(sha256(readFileSync(join(output,item.name+'.deb'))),item.deb.sha256,'Fresh resolver rewrote immutable qualified deb');
execute(['/checks/hash-native.py',output]);
writeFileSync(join(output,'perl-admission.json'),JSON.stringify({schema:1,mode:'current-attempt admission of separately qualified immutable dependency; no cold source build claimed',origin,original_profile_sha256:sha256(JSON.stringify(original)+'\n'),promotion_lock_sha256:sha256(readFileSync(join(input,'promotion-lock.json'))),original_status_sha256:sha256(readFileSync(join(work,'baseline-dpkg-status'))),tool_closure_sha256:sha256(readFileSync('/tool-closure.json')),closure_sha256:sha256(readFileSync(join(output,'perl-current-closure.json'))),original_packages:original.packages,original_configuration:original.configuration,candidate_configuration:configurationForPackages(proof.candidate_configuration,Object.fromEntries(selected.map(item=>[item.name,item.candidate]))),packages:Object.fromEntries(selected.map(item=>[item.name,item.candidate])),deb_sha256:Object.fromEntries(selected.map(item=>[item.name+'.deb',item.deb.sha256]))})+'\n');
