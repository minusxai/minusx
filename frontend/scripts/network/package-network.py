"""Repackage only pre-existing runtime packages, preserving controls and ABI exports."""
import ctypes,hashlib,json,os,re,shutil,subprocess,sys
from pathlib import Path

def run(*args):return subprocess.check_output(args,text=True).strip()
def norm(p):return '/usr'+p if p.startswith(('/bin/','/sbin/','/lib/')) else p
def copy(s,d):
 d.parent.mkdir(parents=True,exist_ok=True)
 if d.exists() or d.is_symlink():d.unlink()
 shutil.copy2(s,d,follow_symlinks=False)
def exports(p):
 return {tuple(x.split()[-2:]) for x in run('objdump','-T',str(p)).splitlines() if len(x.split())>=7 and '*UND*' not in x and '*ABS*' not in x}
def soname(p):
 m=re.search(r'\(SONAME\).*\[(.*?)\]',run('readelf','-d',str(p)));assert m,p;return m.group(1)
from network_common import capabilities
mode,arg=sys.argv[1:]
triplet=run('dpkg-architecture','-qDEB_HOST_MULTIARCH');arch=run('dpkg','--print-architecture')
if mode=='snapshot':
 profile_path=os.environ.get('RUNTIME_PROFILE_TSV')
 assert profile_path,'Explicit pre-bootstrap runtime profile is required'
 profile=dict(line.split('\t',1) for line in Path(profile_path).read_text().splitlines())
 for name,expected in profile.items():assert run('dpkg-query','-W','-f=${Version}',name)==expected,('Bootstrap changed runtime package',name,expected)
 data={}
 for name in ['curl','libcurl4t64','libcurl3t64-gnutls','openssh-client','openssh-server','openssh-sftp-server']:
  if name not in profile:continue
  q=subprocess.run(['dpkg-query','-W','-f=${db:Status-Status}',name],capture_output=True,text=True)
  if q.stdout!='installed':continue
  files=run('dpkg-query','-L',name).splitlines()
  controls={}
  for suffix in ['preinst','postinst','prerm','postrm','triggers','conffiles','shlibs','symbols']:
   for p in [Path('/var/lib/dpkg/info')/(name+':'+arch+'.'+suffix),Path('/var/lib/dpkg/info')/(name+'.'+suffix)]:
    if p.exists():controls[suffix]={'text':p.read_text(),'mode':p.stat().st_mode&0o7777};break
  data[name]={'status':run('dpkg-query','-s',name),'files':files,'controls':controls,'metadata':{p:{'mode':Path(p).stat().st_mode&0o7777,'uid':Path(p).stat().st_uid,'gid':Path(p).stat().st_gid} for p in files if Path(p).is_file() and not Path(p).is_symlink()},'exports':{p:sorted(exports(p)) for p in files if '.so.' in p and Path(p).is_file() and not Path(p).is_symlink()},'curl_version':run('curl','--version') if name=='curl' else None}
  if name.startswith('libcurl'):
   real=next(p for p in files if '.so.' in p and Path(p).is_file() and not Path(p).is_symlink());data[name]['library_capabilities']=capabilities(real)
 Path(arg).write_text(json.dumps(data,indent=2)+'\n');sys.exit()
if mode=='rename-gnutls':
 lib=Path(arg)/'usr/lib'/triplet
 real=[p for p in lib.glob('libcurl.so.4.*') if not p.is_symlink()];assert len(real)==1
 dest=real[0].with_name(real[0].name.replace('libcurl.','libcurl-gnutls.'))
 real[0].rename(dest);subprocess.run(['patchelf','--set-soname','libcurl-gnutls.so.4',str(dest)],check=True)
 (lib/'libcurl-gnutls.so.4').symlink_to(dest.name)
 sys.exit()
assert mode=='package'
baseline=json.loads(Path(arg).read_text());Path('/out').mkdir(exist_ok=True)
work=Path('/network-work');roots={};versions={p:('1:10.6p1-1+runtime1' if p.startswith('openssh-') else '8.23.0-1+runtime1') for p in baseline}
for package,original in baseline.items():
 root=work/'packages'/package;root.mkdir(parents=True,exist_ok=True);replaced=[]
 stage=work/('stage-openssh' if package.startswith('openssh-') else 'stage-gnutls' if package.endswith('gnutls') else 'stage-openssl')
 for path in original['files']:
  old=Path(path)
  if not(old.is_file() or old.is_symlink()):continue
  if package.startswith('libcurl') and '.so.' in old.name:continue
  candidate=stage/norm(path).lstrip('/')
  executable=norm(path).startswith(('/usr/bin/','/usr/sbin/','/usr/lib/openssh/'))
  if executable and package.startswith('openssh-') and old.is_file() and old.open('rb').read(4)!=b'\x7fELF':
   # Keep distro integration shell scripts (service cleanup and ssh-copy-id).
   copy(old,root/norm(path).lstrip('/'));continue
  if executable:
   # Debian adds ssh-copy-id and ssh-argv0, shell scripts/aliases outside upstream install.
   if package=='openssh-client' and old.name in ['ssh-copy-id','ssh-argv0']:
    if old.name=='ssh-copy-id':candidate=work/'openssh/contrib/ssh-copy-id'
    else:copy(old,root/norm(path).lstrip('/'));continue
   assert candidate.exists() or candidate.is_symlink(),f'Missing replacement {package}:{path}'
   copy(candidate,root/norm(path).lstrip('/'));replaced.append(path)
  else:copy(old,root/norm(path).lstrip('/'))
 if package=='openssh-server':
  # Upstream split helpers are required even if absent in the old inventory.
  for relative in ['usr/sbin/sshd','usr/lib/openssh/sshd-auth','usr/lib/openssh/sshd-session']:
   candidate=stage/relative;assert candidate.is_file(),candidate
   dest=root/relative
   if not dest.exists():copy(candidate,dest);replaced.append('/'+relative)
 if package.startswith('libcurl'):
  family='libcurl-gnutls.so.4' if package.endswith('gnutls') else 'libcurl.so.4'
  new=stage/'usr/lib'/triplet/family;assert new.exists();assert soname(new)==family
  prior=set(tuple(x) for values in original['exports'].values() for x in values)
  missing=prior-exports(new);assert not missing,f'Lost versioned ABI in{package}:{sorted(missing)}'
  for oldpath in original['files']:
   old=Path(oldpath)
   if '.so.' in old.name and old.is_symlink() and old.name!=family:
    dest=root/'usr/lib'/triplet/old.name;dest.parent.mkdir(parents=True,exist_ok=True)
    if not dest.exists() and not dest.is_symlink():dest.symlink_to(family)
  for p in new.parent.glob(family+'*'):
   copy(p,root/'usr/lib'/triplet/p.name);replaced.append('/usr/lib/'+triplet+'/'+p.name)
 # Retain original ownership/modes, including Debian ssh-agent group hardening.
 for path,meta in original['metadata'].items():
  dest=root/norm(path).lstrip('/')
  if dest.exists() and not dest.is_symlink():os.chown(dest,meta['uid'],meta['gid']);dest.chmod(meta['mode'])
 doc=root/'usr/share/doc/runtime-network'/package;doc.mkdir(parents=True,exist_ok=True)
 copy(Path(__file__).parent/'SHA256SUMS',doc/'runtime-recipe-SHA256SUMS')
 if package.startswith('openssh-') and 'openssh-server' in baseline:
  copy(Path(__file__).parent/'server-debian-provenance.json',doc/'runtime-distro-patches.json')
  copy(Path(__file__).parent/'server-debian-patches/copyright',doc/'copyright.distro-source')
 copy(work/('openssh/LICENCE' if package.startswith('openssh-') else 'openssl/COPYING'),doc/'COPYING.upstream')
 (doc/'runtime-source.json').write_text(json.dumps({'source':'openssh' if package.startswith('openssh-') else 'curl','version':versions[package],'replaced':replaced,'upstream_url':'https://www.openssh.org/' if package.startswith('openssh-') else 'https://curl.se/','source_archive_sha256':'a9dc9565dffe8640f64d863cd29a32bc4a3dbdec0566a7fc44c5d6ee767d5f39' if package.startswith('openssh-') else '8dadd7d2536a314f982ad05a651b713f426bf7d02cc2c76cffb9796f2218e6c5'},indent=2)+'\n')
 roots[package]=root
# Stage exact local ABI mappings for dependency discovery, retaining original dependencies too.
Path('debian').mkdir(exist_ok=True);Path('debian/control').write_text('Source: runtime-network\nMaintainer: Runtime Maintainers <maintainers@example.invalid>\n\n'+''.join('Package: '+p+'\nArchitecture: any\nDescription: upstream runtime\n\n' for p in roots))
shlibs=work/'shlibs.local';shlibs.write_text(''.join(('libcurl-gnutls' if p.endswith('gnutls') else 'libcurl')+' 4 '+p+' (>= '+versions[p]+')\n' for p in roots if p.startswith('libcurl')))
for package,root in roots.items():
 control=root/'DEBIAN';control.mkdir();fields={};key=None
 for line in baseline[package]['status'].splitlines():
  if line.startswith((' ','\t')):
   if key in fields:fields[key]+='\n'+line
  elif ': ' in line:
   key,value=line.split(': ',1)
   if key in ['Package','Section','Priority','Essential','Multi-Arch','Provides','Breaks','Replaces','Pre-Depends','Depends','Conflicts','Recommends','Suggests','Enhances','Homepage']:fields[key]=value
 fields.update(Package=package,Source='openssh' if package.startswith('openssh-') else 'curl',Version=versions[package],Architecture=arch,Maintainer='Runtime Maintainers <maintainers@example.invalid>',Description='Verified upstream network runtime')
 elf=[p for p in root.rglob('*') if p.is_file() and not p.is_symlink() and p.open('rb').read(4)==b'\x7fELF']
 deps=''
 if elf:
  cmd=['dpkg-shlibdeps','-O','-x'+package,'-L'+str(shlibs)]
  for stage in ['stage-openssl','stage-gnutls']:cmd+=['-l'+str(work/stage/'usr/lib'/triplet)]
  cmd+=['-e'+str(p) for p in elf]
  deps=next(x.split('=',1)[1] for x in run(*cmd).splitlines() if x.startswith('shlibs:Depends='))
 orig=fields.get('Depends','')
 for p in roots:orig=re.sub(r'(?<![\w+.-])'+re.escape(p)+r'\s*\([^)]*\)',p+' (>= '+versions[p]+')',orig)
 fields['Depends']=', '.join(dict.fromkeys(x.strip() for x in (orig+','+deps).split(',') if x.strip()))
 for suffix,item in baseline[package]['controls'].items():
  text=item['text']
  if suffix=='shlibs' and package.startswith('libcurl'):
   text=('libcurl-gnutls' if package.endswith('gnutls') else 'libcurl')+' 4 '+package+' (>= '+versions[package]+')\n'
  (control/suffix).write_text(text);(control/suffix).chmod(item['mode'])
 (control/'md5sums').write_text(''.join(hashlib.md5(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(root))+'\n' for p in sorted(root.rglob('*')) if p.is_file() and not p.is_symlink() and control not in p.parents))
 (control/'control').write_text(''.join(k+': '+v+'\n' for k,v in fields.items()))
 subprocess.run(['dpkg-deb','--build',str(root),'/out/'+package+'.deb'],check=True)
