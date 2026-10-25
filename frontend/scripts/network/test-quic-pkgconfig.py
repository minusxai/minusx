"""Actual pkg-config resolver controls using exact upstream QUIC .pc templates."""
import hashlib,os,pathlib,subprocess,sys,tarfile,tempfile
here=pathlib.Path(__file__).resolve().parent;binary=pathlib.Path(sys.argv[1]).resolve();archive=pathlib.Path(sys.argv[2])
assert hashlib.sha256(archive.read_bytes()).hexdigest()=='2a34d2484ba17847a5d11965704e9dd0fac4c6d8efc75ffe1ec7de66d8c6b6fb'
with tempfile.TemporaryDirectory() as directory:
 root=pathlib.Path(directory);prefix=root/'private';pc=prefix/'lib/pkgconfig';pc.mkdir(parents=True);system=root/'native';system.mkdir();tools=root/'tools';tools.mkdir();(tools/'pkg-config').symlink_to(binary)
 with tarfile.open(archive) as source:
  for module,path in [('libngtcp2','lib'),('libngtcp2_crypto_ossl','crypto/ossl'),('libngtcp2_crypto_gnutls','crypto/gnutls')]:
   data=source.extractfile('ngtcp2-1.25.0/'+path+'/'+module+'.pc.in').read().decode()
   for key,value in {'prefix':str(prefix),'exec_prefix':'${prefix}','libdir':'${prefix}/lib','includedir':'${prefix}/include','VERSION':'1.25.0'}.items():data=data.replace('@'+key+'@',value)
   (pc/(module+'.pc')).write_text(data)
 for tls in ['openssl','gnutls']:(system/(tls+'.pc')).write_text('Name: '+tls+'\nDescription: ordinary native dependency fixture\nVersion: 3.5.7\nLibs: -l'+tls+'\n')
 env=dict(os.environ,PATH=str(tools)+os.pathsep+os.environ['PATH'],PKG_CONFIG_PATH=str(pc),PKG_CONFIG_LIBDIR=str(system))
 def check(success,environment=env):
  result=subprocess.run([sys.executable,str(here/'check-quic-pkgconfig.py'),str(prefix)],env=environment,text=True,capture_output=True);assert (result.returncode==0)==success,result.stdout+result.stderr;return result
 check(True)
 # Replay curl8.18 prefix-valued option: only the private directory is searched.
 hidden=dict(env,PKG_CONFIG_LIBDIR=str(pc));failure=check(False,hidden);assert 'openssl' in failure.stderr or 'gnutls' in failure.stderr
 file=pc/'libngtcp2_crypto_ossl.pc';original=file.read_text();file.write_text(original.replace('Version: 1.25.0','Version: 1.24.0'));check(False);file.write_text(original)
 file.write_text(original.replace('libdir=${prefix}/lib','libdir=/ordinary/wrong/provider'));check(False);file.write_text(original)
 (system/'gnutls.pc').unlink();check(False)
 print('PASS: actual pkg-config bothTLS resolution; hiddenTLS, wrongversion/provider and missingTLS rejected')
