"""Ordinary loopback TLS transfers for each installed libcurl ABI; SSH round trips.

Builder: check-network.py --staged /network-work
Final: check-network.py --ssh-server /test-tools/sshd --ssh-libexec /test-tools
The supplied sshd/helpers are disposable test tools, not runtime dependencies.
"""
import sysconfig,argparse,ctypes,functools,http.server,json,os,pwd,shlex,shutil,socket,ssl,subprocess,tempfile,threading
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--staged',type=Path);p.add_argument('--ssh-server',type=Path);p.add_argument('--ssh-libexec',type=Path);args=p.parse_args()
def run(cmd,**kw):return subprocess.check_output([str(x) for x in cmd],text=True,stderr=subprocess.STDOUT,**kw).strip()
triplet=sysconfig.get_config_var('MULTIARCH');assert triplet, 'Python must expose matching native MULTIARCH'
if args.staged:
 baseline=json.loads((args.staged/'baseline.json').read_text());curl=args.staged/'stage-openssl/usr/bin/curl';ssh=args.staged/'stage-openssh/usr/bin/ssh';bindir=ssh.parent
 libs=[args.staged/stage/'usr/lib'/triplet/family for pkg,stage,family in [('libcurl4t64','stage-openssl','libcurl.so.4'),('libcurl3t64-gnutls','stage-gnutls','libcurl-gnutls.so.4')] if pkg in baseline]
 args.ssh_server=args.staged/'openssh/sshd';args.ssh_libexec=args.staged/'openssh'
else:
 baseline={pkg:True for pkg in ['curl','libcurl4t64','libcurl3t64-gnutls','openssh-client','openssh-server','openssh-sftp-server'] if subprocess.run(['dpkg-query','-W','-f=${db:Status-Status}',pkg],capture_output=True,text=True).stdout=='installed'}
 curl=Path('/usr/bin/curl');ssh=Path('/usr/bin/ssh');bindir=ssh.parent
 if 'openssh-server' in baseline:
  # Validate the installed production server payload, not a mounted test server.
  args.ssh_server=Path('/usr/sbin/sshd');args.ssh_libexec=Path('/usr/lib/openssh')
 libs=[Path('/usr/lib')/triplet/family for pkg,family in [('libcurl4t64','libcurl.so.4'),('libcurl3t64-gnutls','libcurl-gnutls.so.4')] if pkg in baseline]
if not args.staged:
 import runpy
 verify=runpy.run_path(str(Path(__file__).with_name('network-proof.py')))['verify']
 for package in baseline:verify(Path('/'),Path('/usr/share/doc/runtime-network')/package,package)
with tempfile.TemporaryDirectory(prefix='network-fixture-') as td:
 t=Path(td);(t/'payload').write_text('ordinary loopback transfer\n')
 cert=t/'cert.pem';key=t/'key.pem'
 run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'])
 class Quiet(http.server.SimpleHTTPRequestHandler):
  def log_message(self,*a):pass
 server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=td));ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(cert,key);server.socket=ctx.wrap_socket(server.socket,server_side=True)
 thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();url='https://localhost:'+str(server.server_port)+'/payload'
 try:
  for library in libs:
   lib=ctypes.CDLL(str(library));lib.curl_version.restype=ctypes.c_char_p;version=lib.curl_version().decode();assert '8.18.0' in version,version
   assert ('GnuTLS' in version) == ('gnutls' in library.name),version
   if args.staged:
    from network_common import capabilities
    pkg='libcurl3t64-gnutls' if 'gnutls' in library.name else 'libcurl4t64'
    old=baseline[pkg]['library_capabilities'];new=capabilities(library)
    assert old['features'] & new['features']==old['features'],(pkg,old,new)
    assert set(old['protocols'])<=set(new['protocols']),(pkg,old,new)
   lib.curl_easy_init.restype=ctypes.c_void_p;lib.curl_easy_setopt.argtypes=[ctypes.c_void_p,ctypes.c_int];lib.curl_easy_perform.argtypes=[ctypes.c_void_p];lib.curl_easy_cleanup.argtypes=[ctypes.c_void_p]
   handle=lib.curl_easy_init();assert handle;received=[]
   callback_type=ctypes.CFUNCTYPE(ctypes.c_size_t,ctypes.c_void_p,ctypes.c_size_t,ctypes.c_size_t,ctypes.c_void_p)
   @callback_type
   def callback(data,size,count,_):
    received.append(ctypes.string_at(data,size*count));return size*count
   values=[url.encode(),str(cert).encode(),b'']
   try:
    for opt,value in [(10002,ctypes.c_char_p(values[0])),(10065,ctypes.c_char_p(values[1])),(10004,ctypes.c_char_p(values[2])),(20011,callback),(13,ctypes.c_long(10)),(45,ctypes.c_long(1))]:assert lib.curl_easy_setopt(handle,opt,value)==0
    assert lib.curl_easy_perform(handle)==0,version
    assert b''.join(received)==(t/'payload').read_bytes()
   finally:lib.curl_easy_cleanup(handle)
   print('PASS TLS transfer:',library.name,version)
  if 'curl' in baseline:
   env=os.environ.copy()
   if args.staged:env['LD_LIBRARY_PATH']=str(args.staged/'stage-openssl/usr/lib'/triplet)
   version=run([curl,'--version'],env=env);assert version.startswith('curl 8.18.0'),version
   if args.staged:
    old=baseline['curl']['curl_version'];oldlines=old.splitlines();newlines=version.splitlines()
    for prefix in ['Protocols:','Features:']:
     oldset=set(next(x for x in oldlines if x.startswith(prefix)).split()[1:]);newset=set(next(x for x in newlines if x.startswith(prefix)).split()[1:]);assert oldset<=newset,(prefix,oldset-newset)
   assert run([curl,'--fail','--silent','--show-error','--noproxy','*','--cacert',cert,url],env=env)=='ordinary loopback transfer'
   print('PASS curl CLI TLS/protocol/feature preservation')
 finally:server.shutdown();server.server_close()
 if 'openssh-client' in baseline:
  assert 'OpenSSH_10.6p1' in run([ssh,'-V'])
  config_dump=run([ssh,'-G','-F','/dev/null','-oGSSAPIKeyExchange=yes','localhost'])
  assert 'gssapikeyexchange yes' in config_dump
  assert args.ssh_server and args.ssh_server.exists(),'Supply disposable test sshd; skipping is not allowed'
  # Disposable validation container only; sshd privilege separation prerequisites.
  assert os.getuid()==0,'SSH fixture requires a disposable root validation container'
  Path('/run/sshd').mkdir(mode=0o755,parents=True,exist_ok=True)
  try:pwd.getpwnam('sshd')
  except KeyError:run(['useradd','--system','--no-create-home','--home-dir','/run/sshd','--shell','/usr/sbin/nologin','sshd'])
  client=t/'client';host=t/'host';run([bindir/'ssh-keygen','-q','-t','ed25519','-N','','-f',client]);run([bindir/'ssh-keygen','-q','-t','ed25519','-N','','-f',host])
  authorized=t/'authorized_keys';authorized.write_text(client.with_suffix('.pub').read_text());config=t/'sshd_config'
  config.write_text('\n'.join(['HostKey '+str(host),'AuthorizedKeysFile '+str(authorized),'StrictModes no','PasswordAuthentication no','KbdInteractiveAuthentication no',('UsePAM yes' if 'openssh-server' in baseline else 'UsePAM no'),'PermitRootLogin prohibit-password','PidFile '+str(t/'pid'),('Subsystem sftp '+str(args.ssh_libexec/'sftp-server') if 'openssh-sftp-server' in baseline else 'Subsystem sftp internal-sftp'),'LogLevel ERROR'])+'\n')
  if 'openssh-server' in baseline:
   assert 'OpenSSH_10.6' in run([args.ssh_server,'-V'])
   effective=run([args.ssh_server,'-T','-f',config,'-oGSSAPIAuthentication=yes','-oGSSAPIKeyExchange=yes'])
   for setting in ['usepam yes','gssapiauthentication yes','gssapikeyexchange yes']:assert setting in effective,setting
  # -i uses a private inherited stream rather than exposing a listening port.
  proxy=' '.join(shlex.quote(str(x)) for x in [args.ssh_server,'-i','-f',config])
  if args.ssh_libexec:
   proxy+=' '+shlex.quote('-oSshdSessionPath='+str(args.ssh_libexec/'sshd-session'))+' '+shlex.quote('-oSshdAuthPath='+str(args.ssh_libexec/'sshd-auth'))
  options=['-F','/dev/null','-i',str(client),'-oBatchMode=yes','-oIdentitiesOnly=yes','-oStrictHostKeyChecking=accept-new','-oUserKnownHostsFile='+str(t/'known_hosts'),'-oProxyCommand='+proxy]
  who=pwd.getpwuid(os.getuid()).pw_name
  if os.getuid()==0:
   import atexit,secrets
   who='netfixture'+str(os.getpid())
   password_hash=run(['openssl','passwd','-6','-stdin'],input=secrets.token_urlsafe(32))
   run(['useradd','--system','--no-create-home','--home-dir',td,'--shell','/bin/sh','--password',password_hash,who])
   atexit.register(lambda:subprocess.run(['userdel',who],check=False,capture_output=True))
   account=pwd.getpwnam(who)
   for item in [t,*t.rglob('*')]:os.chown(item,account.pw_uid,account.pw_gid)
  target=who+'@localhost'
  assert run([ssh,*options,target,'printf fixture-ok']).endswith('fixture-ok')
  # Normal SFTP-backed scp upload/download checks actual transfer behavior.
  remote=t/'remote';download=t/'download'
  run([bindir/'scp',*options,t/'payload',target+':'+str(remote)])
  run([bindir/'scp',*options,target+':'+str(remote),download]);assert download.read_bytes()==(t/'payload').read_bytes()
  agent=run([bindir/'ssh-agent','-s']);env=os.environ.copy()
  for k in ['SSH_AUTH_SOCK','SSH_AGENT_PID']:
   import re
   env[k]=re.search(k+r'=([^;]+)',agent).group(1)
  try:
   run([bindir/'ssh-add',client],env=env);assert 'ED25519' in run([bindir/'ssh-add','-l'],env=env)
  finally:run([bindir/'ssh-agent','-k'],env=env)
  print('PASS SSH command, authenticated SFTP/scp roundtrip, agent key lifecycle')
print('PASS existing network runtime gates; absent packages were not introduced')
