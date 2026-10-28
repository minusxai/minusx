"""Authenticated disposable resolver closure. Never install into the consumer root."""
import hashlib,json,os,pathlib,re,shlex,shutil,subprocess,sys,runpy
out=pathlib.Path(sys.argv[1]);out.mkdir();archives=out/'archives';archives.mkdir();root=out/'root';root.mkdir()
def run(args,**kw):return subprocess.check_output(args,text=True,**kw)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
seeds=['dpkg-dev','perl','python3','dpkg','binutils']
# Keep the frozen worker's owned vendorarch available without copying ambient files.
# Its Text::CharWidth native module is package-authenticated in this disposable root.
original_vendorarch_package=subprocess.run(['dpkg-query','-W','-f=${db:Status-Status}', 'libtext-charwidth-perl'],text=True,capture_output=True)
if original_vendorarch_package.returncode==0 and original_vendorarch_package.stdout=='installed':seeds.append('libtext-charwidth-perl')
# APT's installed dependency graph includes Depends/Pre-Depends; recommendations are excluded.
graph=run(['apt-cache','depends','--recurse','--installed','--no-recommends','--no-suggests','--no-conflicts','--no-breaks','--no-replaces','--no-enhances',*seeds])
names=sorted(set(line for line in graph.splitlines() if re.fullmatch(r'[a-z0-9][a-z0-9+.-]*(?::[a-z0-9]+)?',line)))
assert set(seeds)<=set(names)
parse=runpy.run_path(str(pathlib.Path(__file__).with_name('dsc-fields.py')))['parse_fields']
selection=runpy.run_path(str(pathlib.Path(__file__).with_name('tool-dependencies.py')))
status={}
for name in names:
 query=subprocess.run(['dpkg-query','-s',name],text=True,capture_output=True)
 block=parse(query.stdout) if query.returncode==0 else {'Package':name,'Status':'unknown ok not-installed'}
 status[name]=block
chosen,skipped=selection['select_members'](names,status,seeds)
closure=selection['validate_closure'](chosen,run(['dpkg','--print-architecture']).strip())
(out/'dependency-selection.json').write_text(json.dumps(dict(chosen=sorted(chosen),unselected_alternatives=skipped,closure=closure))+'\n')
names=sorted(chosen)
records=[];seen=set()
for name in names:
 fields=run(['dpkg-query','-W','-f=${Package}\t${Version}\t${Architecture}\t${source:Package}\t${source:Version}\t${db:Status-Status}',name]).split('\t')
 assert fields[-1]=='installed',fields
 package,version,arch,source,sourceversion,_=fields
 if (package,version,arch) in seen:continue
 seen.add((package,version,arch))
 metadata=run(['apt-cache','show',package+'='+version]);sha=re.search(r'^SHA256: ([0-9a-f]{64})$',metadata,re.M);assert sha,(package,version)
 before=set(archives.iterdir());subprocess.run(['apt-get','download',package+'='+version],cwd=archives,check=True)
 added=set(archives.iterdir())-before;assert len(added)==1,(package,added)
 archive=added.pop();assert digest(archive)==sha[1],package
 subprocess.run(['dpkg-deb','-x',str(archive),str(root)],check=True)
 records.append(dict(package=package,version=version,architecture=arch,source=source,source_version=sourceversion,archive=archive.name,sha256=sha[1]))
inc=json.loads(run(['perl','-MJSON::PP','-e','print encode_json([grep {-d $_ && m{^/usr/}} @INC])']))
assert '/usr/share/perl/5.40' in inc or '/usr/share/perl/5.40.1' in inc
mapped=['/qualification-tools'+s for s in inc]
empty=runpy.run_path(str(pathlib.Path(__file__).with_name('tool-empty-directories.py')))
original_empty=json.loads(pathlib.Path('/perl-work/original-tool-empty-dirs.json').read_text());restored_empty={}
for path in inc:
 if not (root/path.lstrip('/')).exists():restored_empty[path]=empty['restore'](path,root,original_empty)
 resolved=(root/path.lstrip('/')).resolve();assert resolved.is_dir() and resolved.is_relative_to(root.resolve()),path
elf={}
for name in ['usr/bin/perl','usr/bin/python3.13','usr/bin/dpkg','usr/bin/dpkg-deb']:
 text=run(['readelf','-l',str(root/name)]);match=re.search(r'Requesting program interpreter: ([^\]]+)',text);assert match,name
 requested=match[1];loader=requested
 if not (root/loader.lstrip('/')).exists():loader='/usr'+requested
 assert (root/loader.lstrip('/')).exists(),(requested,loader)
 assert (root/loader.lstrip('/')).resolve().is_relative_to(root.resolve()),('Tool loader escapes root',loader)
 assert (root/name).resolve().is_relative_to(root.resolve()),('Tool executable escapes root',name)
 listing=run([str(root/loader.lstrip('/')),'--library-path',str(root/'usr/lib/x86_64-linux-gnu')+':'+str(root/'lib/x86_64-linux-gnu'),'--list',str(root/name)])
 assert 'not found' not in listing
 for resolved in re.findall(r'=> (/[^ ]+)',listing):
  assert pathlib.Path(resolved).resolve().is_relative_to(root.resolve()),('Tool ELF library escapes root',resolved)
 elf[name]=dict(interpreter=loader,requested_interpreter=requested,dynamic=run(['readelf','-d',str(root/name)]),resolved=listing)
loader='/qualification-tools'+elf['usr/bin/perl']['interpreter'];libs='/qualification-tools/usr/lib/x86_64-linux-gnu:/qualification-tools/lib/x86_64-linux-gnu'
launcher=root/'resolver-bin';launcher.mkdir()
# Replace @INC completely, so no consumer/local/ambient Perl module can satisfy a tool import.
code='BEGIN { @INC = ('+','.join(json.dumps(s) for s in mapped)+'); } my $p=shift; my $r=do $p; die $@ if $@; die "$p: $!" unless defined $r;'
script='#!/bin/sh\nexec '+shlex.join([loader,'--library-path',libs,'/qualification-tools/usr/bin/perl','-e',code,'/qualification-tools/usr/bin/dpkg-checkbuilddeps'])+' "$@"\n'
(launcher/'dpkg-checkbuilddeps').write_text(script);(launcher/'dpkg-checkbuilddeps').chmod(0o755)
probe='BEGIN { @INC = ('+','.join(json.dumps(str(root/s.lstrip('/'))) for s in inc)+'); } use Dpkg::Deps; use Dpkg::Compression::FileHandle; use JSON::PP; print encode_json(\\%INC);'
loaded=json.loads(run([str(root/elf['usr/bin/perl']['interpreter'].lstrip('/')),'--library-path',str(root/'usr/lib/x86_64-linux-gnu')+':'+str(root/'lib/x86_64-linux-gnu'),str(root/'usr/bin/perl'),'-e',probe]))
assert loaded and all(pathlib.Path(p).resolve().is_relative_to(root.resolve()) for p in loaded.values()),loaded
assert len({entry['interpreter'] for entry in elf.values()})==1,'Tool ELF interpreters differ'
(root/'tool-runtime.json').write_text(json.dumps(dict(loader=loader,library_path=libs,python='/qualification-tools/usr/bin/python3.13',perl='/qualification-tools/usr/bin/perl',inc=mapped))+'\n')
files={}
for p in sorted(root.rglob('*')):
 key='/'+str(p.relative_to(root));st=p.lstat()
 if p.is_symlink():files[key]=dict(mode=st.st_mode,link=os.readlink(p))
 elif p.is_file():files[key]=dict(mode=st.st_mode,sha256=digest(p))
apt=out/'apt-authentication';apt.mkdir()
for p in pathlib.Path('/var/lib/apt/lists').iterdir():
 if p.is_file():shutil.copyfile(p,apt/p.name)
receipt=dict(schema=1,seeds=seeds,dependency_graph=graph,dependency_closure=closure,unselected_alternatives=skipped,packages=records,files=files,perl_inc=mapped,restored_original_empty_directories=restored_empty,original_empty_directories=original_empty,loaded_probe_modules=loaded,elf=elf,apt_indexes={p.name:digest(p) for p in apt.iterdir()},authentication='apt-get update authenticated indexes; apt-get download archive bytes independently matched exact-version APT SHA256; extracted tool root only',consumer_changes='none',qualification=False)
(out/'tool-closure.json').write_text(json.dumps(receipt,sort_keys=True)+'\n')
