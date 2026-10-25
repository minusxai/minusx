"""Fail-closed staged, transformed and installed native artifact binding."""
import hashlib,json
from pathlib import Path

def verify(root, doc, package):
 root=Path(root);doc=Path(doc)
 native=json.loads((doc/'runtime-native.json').read_text());assert native,'Empty native inventory'
 for path,digest in native.items():
  assert path.startswith('/usr/') and '..' not in Path(path).parts,path
  actual=root/path.lstrip('/');assert actual.is_file(),path
  assert hashlib.sha256(actual.read_bytes()).hexdigest()==digest,('Installed native hash mismatch',path)
 if package.startswith('libcurl'):
  variant='gnutls' if package.endswith('gnutls') else 'openssl'
  before=[x for x in json.loads((doc/'runtime-build-http3-proof.json').read_text()) if x['tls_variant']==variant]
  after=[x for x in json.loads((doc/'runtime-transformed-http3-proof.json').read_text()) if x['tls_variant']==variant]
  assert len(before)==len(after)==1
  before,after=before[0],after[0]
  for row,phase in [(before,'upstream-staged'),(after,'post-transform')]:
   assert row['phase']==phase and row['http_version']=='3' and row['ca_verified'] is True
  family='libcurl-gnutls.so.4' if variant=='gnutls' else 'libcurl.so.4'
  libraries=[path for path in native if Path(path).name.startswith(family+'.')]
  assert len(libraries)==1,libraries
  assert native[libraries[0]]==after['staged_libcurl_sha256'],'Packaged library differs from tested transformed artifact'
  if variant=='gnutls':
   transform=json.loads((doc/'runtime-soname-transform.json').read_text())
   assert transform=={'operation':'patchelf --set-soname','from':'libcurl.so.4','to':'libcurl-gnutls.so.4','before_sha256':before['staged_libcurl_sha256'],'after_sha256':after['staged_libcurl_sha256']}
  else:assert before['staged_libcurl_sha256']==after['staged_libcurl_sha256']
 return native
