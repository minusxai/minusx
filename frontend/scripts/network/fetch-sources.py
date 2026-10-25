"""Retrieve checksum-pinned official archives/signatures; never execute remote scripts."""
import hashlib,json,shutil,sys,urllib.request
from pathlib import Path
here,out=map(Path,sys.argv[1:]);out.mkdir(parents=True,exist_ok=True)
for item in json.loads((here/'downloads.json').read_text()):
 if 'error' in item:continue
 dest=out/item['file'];local=here/item['file']
 if local.exists():shutil.copyfile(local,dest)
 else:
  with urllib.request.urlopen(item['url'],timeout=120) as src,dest.open('wb') as dst:shutil.copyfileobj(src,dst)
 assert hashlib.sha256(dest.read_bytes()).hexdigest()==item['sha256'],item['file']
