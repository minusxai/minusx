"""Validate exact installed backported libraries and ordinary public API fixtures."""
import argparse,hashlib,json,os,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--test-tools',type=Path,required=True);args=p.parse_args()
config=json.loads((Path(__file__).parent/'config.json').read_text());installed=set()
for source,item in config.items():
 for package in item['packages']:
  q=subprocess.run(['dpkg-query','-W','-f=${db:Status-Status}',package],text=True,capture_output=True)
  if q.stdout!='installed':continue
  installed.add(package);receipt=json.loads((Path('/usr/share/doc/runtime-libraries')/package/'runtime-source.json').read_text())
  version=subprocess.check_output(['dpkg-query','-W','-f=${Version}',package],text=True);assert version==receipt['version'],(package,version)
  for name,sha in receipt['native_sha256'].items():assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==sha,name
for source,packages in [('krb5',config['krb5']['packages']),('p11',['libp11-kit0']),('elf',['libelf1t64']),('freetype',['libfreetype6'])]:
 if not installed.intersection(packages):continue
 fixture=args.test_tools/('check-'+source);assert fixture.is_file(),fixture
 env=os.environ.copy();env.pop('LD_LIBRARY_PATH',None);subprocess.run([str(fixture)],check=True,env=env,timeout=30)
 print('PASS actual installed public API fixture:',source)
print('PASS exact native payload provenance for:',','.join(sorted(installed)))
