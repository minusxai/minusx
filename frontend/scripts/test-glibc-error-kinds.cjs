const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const source=fs.readFileSync(require('node:path').join(__dirname,'capture-glibc-applicability.cjs'),'utf8');
// Obtain exported functions from a dedicated context.
const c={require,Buffer,module:{exports:{}},process:{env:{PROBE_SELFTEST:'1'},getuid:()=>0}};vm.runInNewContext(source,c);const reason=c.module.exports.errorReason;
assert.equal(reason(new Error('Program header bounds')),'ELF_PHDR_BOUNDS');
const rel=Buffer.alloc(64);Buffer.from('7f454c46','hex').copy(rel);rel[4]=2;rel[5]=1;rel.writeUInt16LE(1,16);rel.writeUInt16LE(64,52);assert.throws(()=>c.module.exports.elf(rel),e=>reason(e)==='ELF_REL_NO_PHDR');
assert.equal(reason(Object.assign(new Error('/private-secret-customer/file'),{code:'EACCES'})),'EACCES');
assert.equal(reason(Object.assign(new Error('/private-secret-customer/file'),{code:'PRIVATE_SECRET'})),'IO_OTHER');
assert.equal(reason(new Error('/private-secret-customer/file')),'PARSE_OR_IO_OTHER');
let output='',exit=0;
const fake={
 lstatSync(p){return {isSymbolicLink:()=>false,isDirectory:()=>p==='/',isFile:()=>p!=='/',mode:0o644,uid:0,gid:0}},
 readdirSync(){return ['private-secret-customer-a','private-secret-customer-b']},
 openSync(p){if(p.endsWith('-a'))throw Object.assign(new Error(p),{code:'EACCES'});return 9},
 readSync(fd,b){Buffer.from('7f454c46','hex').copy(b)},closeSync(){},readFileSync(){return Buffer.from('7f454c46','hex')}
};
const full={require:n=>n==='node:fs'?fake:crypto,Buffer,module:{exports:{}},console:{log:s=>output=s},process:{env:{PROBE_EXPECTED_IMAGE_ID:'sha256:'+'a'.repeat(64)},getuid:()=>0,set exitCode(n){exit=n}}};vm.runInNewContext(source,full);
const r=JSON.parse(output);assert.equal(r.errorCount,2);assert.equal(r.errorKinds.EACCES,1);assert.equal(r.errorKinds.ELF_HEADER_TRUNCATED,1);assert.equal(r.scanComplete,false);assert.equal(exit,1);assert(!output.includes('private-secret'));assert(!output.includes('/private'));
console.log('6 finite-reason/full-walk/privacy/failclosed controls PASS');
