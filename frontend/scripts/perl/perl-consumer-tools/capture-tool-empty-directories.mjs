import {execFileSync} from 'node:child_process';
import {lstatSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const paths=execFileSync('perl',['-e','print join(qq{\\n}, grep {-d $_ && m{^/usr/}} @INC)'],{encoding:'utf8'}).trim().split('\n').filter(Boolean),result={};
for(const path of paths){assert.ok(path.startsWith('/usr/')&&!path.split('/').includes('..'));const st=lstatSync(path);if(st.isDirectory()&&!st.isSymbolicLink()&&readdirSync(path).length===0){assert.ok(realpathSync(path).startsWith('/usr/'));result[path]={type:'directory',mode:st.mode&0o7777,uid:st.uid,gid:st.gid};}}
writeFileSync(process.argv[2],JSON.stringify(result)+'\n');
