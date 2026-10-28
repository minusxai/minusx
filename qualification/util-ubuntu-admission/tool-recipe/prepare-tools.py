"""Authenticated disposable resolver closure. Never install into the consumer root."""
import hashlib,json,os,pathlib,re,shlex,shutil,subprocess,sys,runpy
out=pathlib.Path(sys.argv[1]);out.mkdir();archives=out/'archives';archives.mkdir();root=out/'root';root.mkdir()
def run(args,**kw):
 clean={key:value for key,value in os.environ.items() if not re.match(r'^(?:LD_|DYLD_|PERL|PYTHON)',key) and key!='GLIBC_TUNABLES'}
 clean.update(LC_ALL='C',PATH='/usr/sbin:/usr/bin:/sbin:/bin')
 kw.setdefault('env',clean)
 return subprocess.check_output(args,text=True,**kw)
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
archive_auth=runpy.run_path(str(pathlib.Path(__file__).with_name('apt-archive-hashes.py')))
records=[];seen=set()
for name in names:
 fields=run(['dpkg-query','-W','-f=${Package}\t${Version}\t${Architecture}\t${source:Package}\t${source:Version}\t${db:Status-Status}',name]).split('\t')
 assert fields[-1]=='installed',fields
 package,version,arch,source,sourceversion,_=fields
 if (package,version,arch) in seen:continue
 seen.add((package,version,arch))
 metadata=run(['apt-cache','show',package+'='+version]);expected=archive_auth['expected_hashes'](metadata,package,version,arch)
 before=set(archives.iterdir());subprocess.run(['apt-get','download',package+'='+version],cwd=archives,check=True)
 added=set(archives.iterdir())-before;assert len(added)==1,(package,added)
 archive=added.pop();local_sha256=archive_auth['verify_archive'](archive,expected)
 assert run(['dpkg-deb','-f',str(archive),'Package','Version','Architecture']).splitlines()==['Package: '+package,'Version: '+version,'Architecture: '+arch],package
 subprocess.run(['dpkg-deb','-x',str(archive),str(root)],check=True)
 records.append(dict(package=package,version=version,architecture=arch,source=source,source_version=sourceversion,archive=archive.name,sha256=local_sha256,apt_archive=expected,apt_metadata_sha256=hashlib.sha256(metadata.encode()).hexdigest()))
inc=json.loads(run(['perl','-MJSON::PP','-e','print encode_json([grep {-d $_ && m{^/usr/}} @INC])']))
capture=runpy.run_path(str(pathlib.Path(__file__).with_name('empty-tsv-to-json.py')))
original_profile=capture['parse_capture'](pathlib.Path('/perl-work/original-tool-empty-dirs.tsv').read_text())
perl_config_version=run(['perl','-MConfig','-e','print $Config{version}']).strip()
assert perl_config_version==original_profile['perl_version'], 'Tool APT changed original Perl interpreter version'
assert re.fullmatch(r'5\.\d+\.\d+',perl_config_version)
python_mm=str(sys.version_info.major)+'.'+str(sys.version_info.minor)
python_name='usr/bin/python'+python_mm
assert pathlib.Path(sys.executable).resolve()==pathlib.Path('/usr/bin/python'+python_mm).resolve(), 'Preparation did not use actual installed system Python'
assert inc and len(inc)==len(set(inc)) and all(path.startswith('/usr/') and '..' not in pathlib.PurePosixPath(path).parts for path in inc)
original_empty=original_profile['empty_directories']
pathlib.Path('/perl-work/original-tool-empty-dirs.json').write_text(json.dumps(original_empty,sort_keys=True)+'\n')
mapped=['/qualification-tools'+s for s in inc]
empty=runpy.run_path(str(pathlib.Path(__file__).with_name('tool-empty-directories.py')))
restored_empty={}
for path in inc:
 if not (root/path.lstrip('/')).exists():restored_empty[path]=empty['restore'](path,root,original_empty)
 resolved=(root/path.lstrip('/')).resolve();assert resolved.is_dir() and resolved.is_relative_to(root.resolve()),path
elf={}
for name in ['usr/bin/perl',python_name,'usr/bin/dpkg','usr/bin/dpkg-deb']:
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
python_probe='import json,sys,email.parser,subprocess,tempfile,hashlib; print(json.dumps({name:module.__file__ for name,module in sys.modules.items() if getattr(module,"__file__",None)}))'
python_env={'LC_ALL':'C','PATH':'/usr/bin:/bin','PYTHONHOME':str(root/'usr'),'PYTHONNOUSERSITE':'1','PYTHONDONTWRITEBYTECODE':'1'}
python_loaded=json.loads(run([str(root/elf[python_name]['interpreter'].lstrip('/')),'--library-path',str(root/'usr/lib/x86_64-linux-gnu')+':'+str(root/'lib/x86_64-linux-gnu'),str(root/python_name),'-s','-c',python_probe],env=python_env))
assert python_loaded and all(pathlib.Path(path).resolve().is_relative_to(root.resolve()) for path in python_loaded.values()), 'Python module escaped authenticated tool root'

(root/'tool-runtime.json').write_text(json.dumps(dict(loader=loader,library_path=libs,python='/qualification-tools/'+python_name,perl='/qualification-tools/usr/bin/perl',inc=mapped))+'\n')
files={}
for p in sorted(root.rglob('*')):
 key='/'+str(p.relative_to(root));st=p.lstat()
 if p.is_symlink():files[key]=dict(mode=st.st_mode,link=os.readlink(p))
 elif p.is_file():files[key]=dict(mode=st.st_mode,sha256=digest(p))
apt=out/'apt-authentication';apt.mkdir()
for p in pathlib.Path('/var/lib/apt/lists').iterdir():
 if p.is_file():shutil.copyfile(p,apt/p.name)
receipt=dict(schema=2,platform='Ubuntu actual-version tool closure',perl_config_version=perl_config_version,python_major_minor=python_mm,original_preapt_capture=original_profile,original_preapt_capture_sha256=digest(pathlib.Path('/perl-work/original-tool-empty-dirs.tsv')),seeds=seeds,dependency_graph=graph,installed_tool_status=chosen,dependency_closure=closure,unselected_alternatives=skipped,packages=records,files=files,perl_inc=mapped,restored_original_empty_directories=restored_empty,original_empty_directories=original_empty,loaded_probe_modules=loaded,python_loaded_probe_modules=python_loaded,elf=elf,apt_indexes={p.name:digest(p) for p in apt.iterdir()},authentication='apt-get update authenticated indexes; apt-get download archive bytes independently matched exact-identity APT size and every supplied SHA256/SHA512 digest; local SHA256 inventory computed independently; extracted tool root only',consumer_changes='none',qualification=False)
(out/'tool-closure.json').write_text(json.dumps(receipt,sort_keys=True)+'\n')
