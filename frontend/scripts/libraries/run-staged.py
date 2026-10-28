"""Run ordinary fixtures against rebuilt, packaged library payloads before export."""
from pathlib import Path
import json,os,shutil,subprocess
work=Path('/libraries-work');profile=dict(l.split('\t',1) for l in (work/'runtime-profile.tsv').read_text().splitlines());triplet=subprocess.check_output(['dpkg-architecture','-qDEB_HOST_MULTIARCH'],text=True).strip();libs=work/'test-libs';libs.mkdir()
for package in profile:
 for p in (work/'packages'/package/'usr/lib'/triplet).glob('*.so*'):shutil.copy2(p,libs/p.name,follow_symlinks=False)
env=os.environ|{'LD_LIBRARY_PATH':str(libs)}
for fixture,packages in [('krb5',['libgssapi-krb5-2','libkrb5-3']),('p11',['libp11-kit0']),('elf',['libelf1t64']),('freetype',['libfreetype6'])]:
 if set(packages)&profile.keys():subprocess.run(['/out/check-'+fixture],env=env,check=True,timeout=30);print('PASS staged replacement native public API fixture:',fixture)
