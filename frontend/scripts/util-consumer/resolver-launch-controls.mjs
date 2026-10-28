/** Owned resolver launch controls only; no runtime qualification. */
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root = mkdtempSync(join(tmpdir(), 'resolver-controls-'));
try {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'resolver.mjs'), 'utf8');
  const runtime = join(root, 'runtime.json');
  const probe = join(root, 'probe.cjs');
  writeFileSync(runtime, JSON.stringify({loader: process.execPath, library_path: 'owned', python: probe}));
  // Mock only the ELF loader invocation; inspect the exact Python arguments/env.
  const patched = source.replace("readFileSync('/qualification-tools/tool-runtime.json')", `readFileSync(${JSON.stringify(runtime)})`).replace("['--library-path',runtime.library_path,runtime.python", '[runtime.python');
  writeFileSync(join(root, 'resolver.mjs'), patched);
  writeFileSync(probe, `const a=require('node:assert/strict');a.deepEqual(process.argv.slice(2),['-S','control.py']);for(const k of Object.keys(process.env))if(k.startsWith('PYTHON')&&k!=='PYTHONHOME')throw Error(k);a.equal(process.env.PYTHONHOME,'/qualification-tools/usr');a.equal(process.env.PATH,'/usr/bin:/bin');`);
  const result = spawnSync(process.execPath, [join(root, 'resolver.mjs'), 'control.py'], {encoding: 'utf8', env: {...process.env, PYTHONPATH: root, PYTHONSTARTUP: 'ambient', PYTHONUSERBASE: root, PYTHONINSPECT: '1'}});
  assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(root, 'sitecustomize.py'), "raise RuntimeError('ambient site executed')\n");
  const site = spawnSync('python3', ['-S', '-c', "import sys; assert 'site' not in sys.modules; assert 'sitecustomize' not in sys.modules"], {encoding: 'utf8', env: {...process.env, PYTHONPATH: root}});
  assert.equal(site.status, 0, site.stderr);
  const ambient = spawnSync('python3', ['-c', "import sys; assert 'sitecustomize' not in sys.modules"], {encoding: 'utf8', env: {...process.env, PYTHONPATH: root}});
  assert.match(ambient.stderr, /ambient site executed/);
  console.log(JSON.stringify({kind:'resolver-launch-controls',status:'controls-only-unadmitted',positive:2}));
} finally {rmSync(root,{recursive:true,force:true});}
