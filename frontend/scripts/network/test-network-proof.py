import hashlib,json,runpy,tempfile,unittest
from pathlib import Path
verify=runpy.run_path(str(Path(__file__).with_name('network-proof.py')))['verify']
class Binding(unittest.TestCase):
 def test_binding_and_tampering(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);doc=root/'doc';doc.mkdir();lib=root/'usr/lib/test/libcurl-gnutls.so.4.0.0';lib.parent.mkdir(parents=True);lib.write_bytes(b'final native fixture');digest=hashlib.sha256(lib.read_bytes()).hexdigest()
   before='a'*64
   values={'runtime-native.json':{'/usr/lib/test/libcurl-gnutls.so.4.0.0':digest},'runtime-build-http3-proof.json':[{'tls_variant':'gnutls','phase':'upstream-staged','http_version':'3','ca_verified':True,'staged_libcurl_sha256':before}],'runtime-transformed-http3-proof.json':[{'tls_variant':'gnutls','phase':'post-transform','http_version':'3','ca_verified':True,'staged_libcurl_sha256':digest}],'runtime-soname-transform.json':{'operation':'patchelf --set-soname','from':'libcurl.so.4','to':'libcurl-gnutls.so.4','before_sha256':before,'after_sha256':digest}}
   def write():
    for name,value in values.items():(doc/name).write_text(json.dumps(value))
   write();verify(root,doc,'libcurl3t64-gnutls')
   for filename,key,value in [('runtime-soname-transform.json','to','other.so'),('runtime-soname-transform.json','before_sha256','b'*64)]:
    old=values[filename][key];values[filename][key]=value;write()
    with self.assertRaises(AssertionError):verify(root,doc,'libcurl3t64-gnutls')
    values[filename][key]=old
   values['runtime-transformed-http3-proof.json'][0]['staged_libcurl_sha256']='c'*64;write()
   with self.assertRaises(AssertionError):verify(root,doc,'libcurl3t64-gnutls')
   values['runtime-transformed-http3-proof.json'][0]['staged_libcurl_sha256']=digest;write();lib.write_bytes(b'tampered')
   with self.assertRaises(AssertionError):verify(root,doc,'libcurl3t64-gnutls')
if __name__=='__main__':unittest.main()
