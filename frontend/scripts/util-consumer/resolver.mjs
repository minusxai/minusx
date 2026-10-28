/** Read-only resolver tool closure; no tool packages enter the target runtime. */
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const runtime=JSON.parse(readFileSync('/qualification-tools/tool-runtime.json'));
const env={...process.env};
for(const key of Object.keys(env))if(/^(?:LD_|DYLD_|PERL|PYTHON)/.test(key)||key==='GLIBC_TUNABLES')delete env[key];
Object.assign(env,{PATH:'/usr/bin:/bin',PYTHONHOME:'/qualification-tools/usr',DPKG_DATADIR:'/qualification-tools/usr/share/dpkg'});
const result=spawnSync(runtime.loader,['--library-path',runtime.library_path,runtime.python,'-S',...process.argv.slice(2)],{env,stdio:'inherit'});
if(result.error)throw result.error;
if(result.signal)throw new Error('Resolver terminated by signal');
process.exit(result.status);
