"""Ordinary CA-verified HTTP/3 transfers against disposable official example servers.

Builder only: LD_LIBRARY_PATH is scoped to each staged curl process. Neither
servers nor this override are installed in the runtime image.
"""
import hashlib,json,os,pathlib,socket,subprocess,tempfile,time,sys,shutil
work=pathlib.Path('/network-work')
transformed='--transformed' in sys.argv
triplet=subprocess.check_output(['dpkg-architecture','-qDEB_HOST_MULTIARCH'],text=True).strip()
with tempfile.TemporaryDirectory(prefix='ordinary-http3-') as directory:
 root=pathlib.Path(directory);payload=b'ordinary HTTP3 transfer fixture\n';(root/'fixture.txt').write_bytes(payload)
 cert=root/'cert.pem';key=root/'key.pem'
 subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-keyout',str(key),'-out',str(cert)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 evidence=[]
 for tls,server_name in [('openssl','osslserver'),('gnutls','gtlsserver')]:
  server=work/'ngtcp2-fixture/examples'/server_name
  assert server.is_file(),('Missing required official HTTP3 fixture server',server)
  with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as reservation:
   reservation.bind(('127.0.0.1',0));port=reservation.getsockname()[1]
  log=(root/(tls+'.log')).open('w+')
  process=subprocess.Popen([str(server),'-q','-d',str(root),'127.0.0.1',str(port),str(key),str(cert)],stdout=log,stderr=subprocess.STDOUT)
  try:
   stage=work/('stage-'+tls);curl=stage/'usr/bin/curl';environment={k:v for k,v in os.environ.items() if not k.startswith(('LD_','DYLD_'))}
   library=stage/'usr/lib'/triplet/('libcurl-gnutls.so.4' if transformed and tls=='gnutls' else 'libcurl.so.4')
   if transformed and tls=='gnutls':
    curl=root/'curl-gnutls';shutil.copy2(stage/'usr/bin/curl',curl)
    subprocess.run(['patchelf','--replace-needed','libcurl.so.4','libcurl-gnutls.so.4',str(curl)],check=True)
   environment['LD_LIBRARY_PATH']=str(stage/'usr/lib'/triplet)
   body=root/(tls+'.body');last=None
   for attempt in range(20):
    assert process.poll() is None,('HTTP3 fixture server exited',server,log.name)
    last=subprocess.run([str(curl),'--silent','--show-error','--fail','--http3-only','--noproxy','*','--max-time','3','--cacert',str(cert),'--resolve',f'localhost:{port}:127.0.0.1','--output',str(body),'--write-out','%{http_version}',f'https://localhost:{port}/fixture.txt'],env=environment,capture_output=True,text=True)
    if last.returncode==0:break
    time.sleep(.15)
   assert last is not None and last.returncode==0,(tls,last)
   assert last.stdout.strip()=='3',(tls,last.stdout)
   assert body.read_bytes()==payload,(tls,'HTTP3 payload differs')
   evidence.append({'tls_variant':tls,'http_version':'3','ca_verified':True,'sha256':hashlib.sha256(payload).hexdigest(),'staged_libcurl_sha256':hashlib.sha256(library.read_bytes()).hexdigest(),'library_path':str(library),'phase':'post-transform' if transformed else 'upstream-staged'})
  finally:
   process.terminate()
   try:process.wait(timeout=5)
   except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
   log.close()
 (work/('http3-transformed-proof.json' if transformed else 'http3-ordinary-proof.json')).write_text(json.dumps(evidence,indent=2)+'\n')
 print('PASS ordinary CA-verified HTTP3-only transfer, both original TLS variants',flush=True)
