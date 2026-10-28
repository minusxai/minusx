"""Small actual Debian resolver controls; no source build or host package installation."""
import hashlib,pathlib,subprocess,sys,tempfile
here=pathlib.Path(__file__).resolve().parent
architecture=subprocess.check_output(['dpkg','--print-architecture'],text=True).strip()
version='5.40.1-6+deb13u1';new=version+'+runtime1'

def block(name,ver='1',**fields):
 return '\n'.join(key+': '+value for key,value in {'Package':name,'Status':'install ok installed','Architecture':architecture,'Version':ver,**fields}.items())+'\n'
for control in ('pass','reverse-version','reverse-conflict','forward-missing','absent-companion','stale-companion','architecture'):
 with tempfile.TemporaryDirectory(prefix='perl-closure-control-') as temporary:
  root=pathlib.Path(temporary);work=root/'work';work.mkdir();debs=root/'debs';debs.mkdir()
  (work/'runtime-profile.tsv').write_text('perl-base\t'+version+'\nperl\t'+version+'\n')
  reverse={'Depends':'perl-base (>= '+version+')'}
  if control=='reverse-version':reverse={'Depends':'perl-base (= '+version+')'}
  if control=='reverse-conflict':reverse={'Conflicts':'perl-base (>= '+new+')'}
  status=block('perl-base',version)+ '\n'+block('perl',version,Depends='perl-base (= '+version+')')+'\n'+block('ordinary-reverse',**reverse)
  if control!='forward-missing':status+='\n'+block('ordinary-library','2')
  (work/'baseline-dpkg-status').write_text(status)
  for name in ('perl-base','perl'):
   package=root/name;(package/'DEBIAN').mkdir(parents=True)
   depends='ordinary-library (>= 2)' if name=='perl-base' else 'perl-base (= '+new+')'
   if control=='absent-companion' and name=='perl-base':depends+=', perl-modules-5.40 (= '+new+')'
   if control=='stale-companion' and name=='perl':depends='perl-base (= '+version+')'
   arch=('all' if architecture!='all' else 'amd64') if control=='architecture' and name=='perl-base' else architecture
   (package/'DEBIAN/control').write_text('Package: '+name+'\nVersion: '+new+'\nArchitecture: '+arch+'\nMaintainer: Fixture <fixture@example.invalid>\nDescription: Isolated closure fixture\nDepends: '+depends+'\n')
   subprocess.run(['dpkg-deb','--build','-Znone',str(package),str(debs/(name+'.deb'))],check=True,stdout=subprocess.DEVNULL)
  before={path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in debs.iterdir()}
  result=subprocess.run([sys.executable,str(here/'check-dependencies.py'),str(work),'--read-only-debs','--deb-directory',str(debs)],capture_output=True,text=True)
  assert (result.returncode==0)==(control=='pass'),(control,result.stdout,result.stderr)
  if control!='pass':
   expected={'reverse-version':'Unmet build dependencies','reverse-conflict':'Build conflicts','forward-missing':'Unmet build dependencies','absent-companion':'Unmet build dependencies','stale-companion':'Stale original Perl constraint','architecture':'Candidate architecture differs from original runtime'}[control]
   assert expected.lower() in result.stderr.lower(),(control,'Unexpected nonsemantic failure',result.stderr)
   assert "Can't locate" not in result.stderr and 'error while loading shared libraries' not in result.stderr
  assert before=={path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in debs.iterdir()},'Fresh consumer resolver modified qualified debs'
  print('PASS actual Debian isolated resolver control:',control)
