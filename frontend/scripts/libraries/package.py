"""Retain frozen original packages, overlay rebuilt native payloads, verify ABI/deps."""
import hashlib,json,os,re,shutil,subprocess,sys
from pathlib import Path
here=Path(sys.argv[1]);work=Path('/libraries-work');config=json.loads((here/'config.json').read_text());profile=dict(l.split('\t',1) for l in (work/'runtime-profile.tsv').read_text().splitlines());roots={}
def run(*args):return subprocess.check_output(args,text=True).strip()
def exports(p):return {tuple(l.split()[-2:]) for l in run('objdump','-T',str(p)).splitlines() if len(l.split())>=7 and '*UND*' not in l and '*ABS*' not in l}
def soname(p):
 m=re.search(r'\(SONAME\).*\[(.*?)\]',run('readelf','-d',str(p)));return m.group(1) if m else None
def native(p):return p.is_file() and not p.is_symlink() and p.open('rb').read(4)==b'\x7fELF'
for package,version in profile.items():
 source,item=next((s,c) for s,c in config.items() if package in c['packages']);frozen=work/'baseline'/package
 candidates=[p for p in work.glob('*.deb') if run('dpkg-deb','-f',str(p),'Package')==package];assert len(candidates)==1,(package,candidates)
 assert run('dpkg-deb','-f',str(candidates[0]),'Version')==version+'+runtime1'
 built=work/'built-packages'/package;built.parent.mkdir(exist_ok=True);subprocess.run(['dpkg-deb','-R',str(candidates[0]),str(built)],check=True)
 root=work/'packages'/package;root.parent.mkdir(exist_ok=True);shutil.copytree(frozen/'root',root,symlinks=True);payload={};abi=[]
 for old in (frozen/'root').rglob('*'):
  if not native(old):continue
  rel=old.relative_to(frozen/'root');new=built/rel;assert native(new),('Missing replacement',package,rel)
  old_exports=exports(old);assert not old_exports-exports(new),('Lost exports',package,rel,old_exports-exports(new))
  assert soname(old)==soname(new),('Changed SONAME',package,rel)
  dest=root/rel;shutil.copy2(new,dest);stat=old.stat();os.chown(dest,stat.st_uid,stat.st_gid);dest.chmod(stat.st_mode&0o7777)
  payload['/'+str(rel)]=hashlib.sha256(new.read_bytes()).hexdigest();abi.append({'path':str(rel),'exports_preserved':len(old_exports),'soname':soname(old),'original_sha256':hashlib.sha256(old.read_bytes()).hexdigest()})
 assert payload,('No native payload replacements',package)
 control=root/'DEBIAN';shutil.copytree(frozen/'control',control);fields={};key=None
 for line in (frozen/'status').read_text().splitlines():
  if line.startswith((' ','\t')):
   if key in fields:fields[key]+='\n'+line
  elif ':' in line:
   # Empty headers still terminate the previous field's continuation lines.
   key,value=line.split(':',1);value=value.lstrip()
   if key not in ['Status','Conffiles','Installed-Size','Version','Source']:fields[key]=value
 fields.update(Version=version+'+runtime1',Source=source)
 generated=run('dpkg-deb','-f',str(candidates[0]),'Depends');fields['Depends']=', '.join(dict.fromkeys(x.strip() for x in (fields.get('Depends','')+','+generated).split(',') if x.strip()))
 for other,oldversion in profile.items():fields['Depends']=re.sub(r'(?<![\w+.-])'+re.escape(other)+r'\s*\([^)]*\)',other+' (>= '+oldversion+'+runtime1)',fields['Depends'])
 doc=root/'usr/share/doc/runtime-libraries'/package;doc.mkdir(parents=True,exist_ok=True)
 for name in ['config.json','downloads.json','SHA256SUMS','applicability.json']:shutil.copy2(here/name,doc/name)
 (doc/'runtime-source.json').write_text(json.dumps({'package':package,'version':version+'+runtime1','original_version':version,'source':source,'patches':{name:hashlib.sha256((here/name).read_bytes()).hexdigest() for name in item['patches']},'native_sha256':payload,'abi':abi,'original_files_controls_modes_preserved':True},indent=2)+'\n')
 (control/'control').write_text(''.join(k+': '+v+'\n' for k,v in fields.items()))
 (control/'md5sums').write_text(''.join(hashlib.md5(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(root))+'\n' for p in sorted(root.rglob('*')) if p.is_file() and not p.is_symlink() and control not in p.parents));roots[package]=root
for package,root in roots.items():subprocess.run(['dpkg-deb','--build',str(root),'/out/'+package+'.deb'],check=True)
