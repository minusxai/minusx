"""Download pinned source controls/archives and verify DSC archive checksums."""
import hashlib,json,shutil,sys,urllib.request
from pathlib import Path
here,out=map(Path,sys.argv[1:]);out.mkdir(parents=True,exist_ok=True)
for item in json.loads((here/'downloads.json').read_text()):
 dest=out/item['name'];local=here/item['name']
 if local.exists():shutil.copyfile(local,dest)
 else:
  with urllib.request.urlopen(item['url'],timeout=120) as src,dest.open('wb') as dst:shutil.copyfileobj(src,dst)
 assert hashlib.sha256(dest.read_bytes()).hexdigest()==item['sha256'],item['name']
for dsc in out.glob('*.dsc'):
 block=dsc.read_text().split('Checksums-Sha256:\n',1)[1]
 for line in block.splitlines():
  if not line.startswith(' '):break
  sha,size,name=line.split();data=(out/name).read_bytes();assert len(data)==int(size) and hashlib.sha256(data).hexdigest()==sha,name
