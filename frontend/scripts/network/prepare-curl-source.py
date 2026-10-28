"""Authenticate maintained official source; prepare matching source-only TLS builds."""
import hashlib,json,pathlib,subprocess,sys,tarfile
assert len(sys.argv) in (3,4) and (len(sys.argv)==3 or sys.argv[3]=='--verify-only')
here,work=map(pathlib.Path,sys.argv[1:3]);proof=json.loads((here/'curl-maintenance-source.json').read_text());dsc=work/'curl_8.18.0-1ubuntu2.8.dsc'
r=subprocess.run(['gpgv','--status-fd','1','--keyring',str(here/'curl-maintenance-key.gpg'),str(dsc)],text=True,capture_output=True)
(work/'curl-maintenance-signature.log').write_text(r.stdout+r.stderr)
if r.returncode:print(r.stdout+r.stderr,flush=True);r.check_returncode()
assert 'VALIDSIG '+proof['source_signer_fingerprint']+' ' in r.stdout,'Unexpected source signer'
# Hashes bind every archive to the authenticated DSC as well as downloads.json.
section=dsc.read_text().split('Checksums-Sha256:\n',1)[1].split('\nFiles:',1)[0]
for line in section.splitlines():
 if not line.startswith(' '):continue
 sha,size,name=line.split();f=work/name;assert f.stat().st_size==int(size) and hashlib.sha256(f.read_bytes()).hexdigest()==sha,name
if len(sys.argv)==4:
 print('PASS: exact signed source and archive hashes verified')
 sys.exit(0)
vendor=work/'curl-maintenance-vendor';vendor.mkdir()
with tarfile.open(work/'curl_8.18.0-1ubuntu2.8.debian.tar.xz') as archive:archive.extractall(vendor,filter='data')
patches=vendor/'debian/patches';series=[line for line in (patches/'series').read_text().splitlines() if line.startswith('CVE-')]
assert series==list(proof['patches']),'Unexpected vendor patch selection/order'
for name,sha in proof['patches'].items():assert hashlib.sha256((patches/name).read_bytes()).hexdigest()==sha,name
for tls in ['openssl','gnutls']:
 root=work/tls;root.mkdir()
 with tarfile.open(work/'curl_8.18.0.orig.tar.gz') as archive:
  for member in archive.getmembers():
   member.name='/'.join(member.name.split('/')[1:])
   if member.name:archive.extract(member,root,filter='data')
 for name in series:
  patch=str((patches/name).resolve())
  subprocess.run(['git','apply','--check',patch],cwd=root,check=True)
  subprocess.run(['git','apply',patch],cwd=root,check=True)
 # Security backports change both sources and generated-build inputs.
 subprocess.run(['autoreconf','-fi'],cwd=root,check=True)
(work/'curl-maintenance-applied.json').write_text(json.dumps(proof,indent=2)+'\n')
