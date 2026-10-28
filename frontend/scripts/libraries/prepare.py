"""Validate frozen runtime profiles and prepare exact patched Debian sources."""
from pathlib import Path
import json,os,subprocess,sys
mode=sys.argv[1];work=Path(sys.argv[2]);here=Path(__file__).parent.resolve();config=json.loads((here/'config.json').read_text());profile=dict(l.split('\t',1) for l in (work/'runtime-profile.tsv').read_text().splitlines())
def run(*args):return subprocess.check_output(args,text=True).strip()
if mode=='validate':
 supported={p:c['version'] for c in config.values() for p in c['packages']}
 for package,version in profile.items():assert supported[package]==version,('Unsupported baseline',package,version,supported[package])
 krb=set(config['krb5']['packages'])
 assert not(krb&profile.keys()) or krb<=profile.keys(),'Partial Kerberos runtime profile requires a matching standalone fixture'
 print('PASS exact supported frozen baseline');sys.exit()
source=sys.argv[3];item=config[source];eligible=any(p in profile for p in item['packages']);dsc=work/f"{source}_{item['version']}.dsc"
if mode=='dsc':print(dsc if eligible else '');sys.exit()
assert eligible
if mode=='dependencies':
 import runpy
 fields=runpy.run_path(str(here/'dsc-fields.py'))['parse_dsc_fields'](dsc.read_text())
 print(', '.join(fields[k] for k in ['Build-Depends','Build-Depends-Arch'] if k in fields));sys.exit()
assert mode=='prepare';root=work/('source-'+source);subprocess.run(['dpkg-source','--no-check','-x',str(dsc),str(root)],check=True)
env=os.environ|{'QUILT_PATCHES':'debian/patches','QUILT_PATCH_OPTS':'--fuzz=0'}
for patch in item['patches']:
 subprocess.run(['quilt','import',str(here/patch)],cwd=root,env=env,check=True);subprocess.run(['quilt','push'],cwd=root,env=env,check=True)
changelog=root/'debian/changelog';entry=f"{source} ({item['version']}+runtime1) trixie; urgency=medium\n\n  * Apply verified upstream maintenance backports.\n\n -- Runtime Maintainers <maintainers@example.invalid>  Sun, 25 Oct 2026 00:00:00 +0000\n\n";changelog.write_text(entry+changelog.read_text())
