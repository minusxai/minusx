/** Fresh original Perl identity; no package/bootstrap operation is permitted before capture. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {lstatSync,readFileSync,readlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {perlFamily,sha256} from '../lib/perl-qualification.mjs';
export function capturePerlProfile({execute=execFileSync,root='/'}={}){
 const env={...process.env,PATH:'/usr/bin:/bin'};for(const key of Object.keys(env))if(/^(?:LD_|DYLD_|PERL)/.test(key)||key==='GLIBC_TUNABLES')delete env[key];
 const options={encoding:'utf8',maxBuffer:32*1024*1024,env};
 const rows=execute('dpkg-query',['-W','-f=${binary:Package}\t${db:Status-Status}\t${Version}\t${Architecture}\n'],options).trim().split('\n').filter(Boolean).map(row=>row.split('\t')).filter(([,status])=>status==='installed');
 assert.ok(rows.every(row=>row.length===4));
 const unsupported=rows.map(([name])=>name.split(':')[0]).filter(name=>/^(?:perl(?:-|$)|libperl)/.test(name)&&!perlFamily.includes(name));
 assert.equal(new Set(rows.map(([name])=>name.split(':')[0])).size,rows.length,'Unsupported duplicate multiarch package names');
 const identity=path=>{
  assert.ok(path.startsWith('/')&&!path.split('/').includes('..'));let item;
  try{item=lstatSync(join(root,path));}catch(error){if(error.code==='ENOENT')return {type:'absent'};throw error;}
  const common={mode:item.mode&0o7777,uid:item.uid,gid:item.gid};
  if(item.isSymbolicLink())return {...common,type:'link',target:readlinkSync(join(root,path))};
  if(item.isFile()){const bytes=readFileSync(join(root,path));return {...common,type:'file',sha256:sha256(bytes),native:bytes.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46]))};}
  assert.ok(item.isDirectory(),'Unsupported original Perl payload type');return {...common,type:'directory'};
 };
 const packages={};
 for(const name of perlFamily){
  const row=rows.find(([installed])=>installed.split(':')[0]===name);if(!row)continue;
  const files=Object.fromEntries([...new Set(execute('dpkg-query',['-L',row[0]],options).split('\n').filter(path=>path.startsWith('/')))].sort().map(path=>[path,identity(path)]));
  const controls=Object.fromEntries(execute('dpkg-query',['--control-path',row[0]],options).trim().split('\n').filter(Boolean).sort().map(path=>[path,identity(path)]));
  const status=execute('dpkg-query',['-s',row[0]],options);
  controls['/var/lib/dpkg/info/'+row[0]+'.status']={type:'file',mode:0o644,uid:0,gid:0,sha256:sha256(status)};
  packages[name]={version:row[2],architecture:row[3],files,controls};
 }
 assert.ok(packages['perl-base'],'Actual eligible interpreter package required');assert.deepEqual(unsupported,[],'Unsupported installed Perl family requires its own assessment');
 const program='use Config; for my $key(sort keys %Config::Config){my $v=$Config::Config{$key};print "K\\t",unpack("H*",$key),"\\t",defined($v)?"D":"U","\\t",defined($v)?unpack("H*",$v):"","\\n";} for my $key(sort keys %INC){print "I\\t",unpack("H*",$key),"\\t",unpack("H*",$INC{$key}),"\\n";}';
 const output=execute('/usr/bin/perl',['-e',program],{...options,env}),mapping={},configFiles={};
 const decode=value=>{assert.match(value,/^(?:[a-f0-9]{2})*$/);return Buffer.from(value,'hex').toString('utf8');};
 for(const line of output.trim().split('\n')){
  const parts=line.split('\t');assert.ok(parts[0]==='K'||parts[0]==='I','Invalid complete Config capture');
  if(parts[0]==='K'){assert.equal(parts.length,4);const key=decode(parts[1]);assert.ok(!Object.hasOwn(mapping,key));assert.ok(['D','U'].includes(parts[2]));mapping[key]=parts[2]==='D'?decode(parts[3]):null;}
  else{assert.equal(parts.length,3);const name=decode(parts[1]),path=decode(parts[2]);if(/(?:^|\/)Config(?:\.pm|_heavy\.pl)$/.test(name)){const file=identity(path);assert.equal(file.type,'file');configFiles[path]=file;}}
 }
 assert.ok(Object.keys(mapping).length>17&&Object.keys(configFiles).length,'Full Config mapping/files required');
 for(const item of Object.values(packages))for(const [path,file]of Object.entries(item.files)){
  if((path.includes('/CORE/')&&file.type!=='directory')||/(?:^|\/)Config(?:_git)?\.(?:pm|pl)$/.test(path)||/\/Config_heavy\.pl$/.test(path)){assert.notEqual(file.type,'absent','Installed native configuration is missing');configFiles[path]=file;}
 }
 const configuration={available:true,mapping,files:configFiles};
 return {packages,configuration,unsupported};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');const output=process.argv[2];assert.ok(output);
 writeFileSync(output,JSON.stringify(capturePerlProfile())+'\n');
 // The fresh dependency resolver consumes this complete original database, never builder state.
 writeFileSync(output+'.dpkg-status',readFileSync('/var/lib/dpkg/status'));
}
