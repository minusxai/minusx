"""Prove candidate closure against pre-bootstrap status, never builder-added packages.

Uses Debian's own relationship resolver on an isolated data-only status database.
Does not install packages or mutate the real dpkg state.
"""
import json,pathlib,re,subprocess,sys,runpy,argparse
parser=argparse.ArgumentParser();parser.add_argument('work',type=pathlib.Path);parser.add_argument('--deb-directory',type=pathlib.Path,default=pathlib.Path('/out'));parser.add_argument('--read-only-debs',action='store_true');args=parser.parse_args();work=args.work;profile=dict(line.split('\t',1) for line in (work/'runtime-profile.tsv').read_text().splitlines())
fields=runpy.run_path(str(pathlib.Path(__file__).parent/'dsc-fields.py'))['parse_fields']
def render(item):return ''.join(key+': '+value+'\n' for key,value in item.items())
baseline=[fields(block) for block in (work/'baseline-dpkg-status').read_text().split('\n\n') if block.strip()]
installed_blocks=[item for item in baseline if item.get('Status')=='install ok installed']
installed={item['Package']:item for item in installed_blocks}
assert len(installed)==len(installed_blocks),'Foreign multiarch duplicate names require explicit closure support'
eligible={'perl-base','perl','perl-modules-5.40','libperl5.40','libperl-dev'}
assert set(profile)==set(installed)&eligible,'Selected family must independently match complete original installed family'
assert not [name for name in installed if (name.startswith(('perl-','libperl')) or name=='perl') and name not in eligible],'Unsupported original native Perl package'
assert set(profile)<=installed.keys()
for name,version in profile.items():assert installed[name]['Version']==version
candidates={}
for name in profile:
 candidate=fields(subprocess.check_output(['dpkg-deb','-f',str(args.deb_directory/(name+'.deb'))],text=True));assert candidate['Package']==name
 candidate['Status']='install ok installed';assert candidate['Version']==profile[name]+'+runtime1'
 assert candidate['Architecture']==installed[name]['Architecture'],'Candidate architecture differs from original runtime'
 candidates[name]=candidate
relation_names=['Depends','Pre-Depends','Recommends','Suggests','Enhances','Breaks','Conflicts','Replaces','Provides']
for name,item in candidates.items():
 for relation in relation_names:
  for group in item.get(relation,'').split(','):
   for other,oldversion in profile.items():
    # Every literal current-version relation to an admitted Perl companion must advance.
    assert not re.search(r'(?<![\w+.-])'+re.escape(other)+r'(?:\s*\([^)]*?)'+re.escape(oldversion)+r'\s*\)',group),(name,relation,group,'Stale original Perl constraint')
# Current full baseline + only admitted candidate versions; build-only deps absent.
state=work/'closure-dpkg-state';state.mkdir(exist_ok=True)
(state/'status').write_text('\n'.join(render(candidates.get(item['Package'],item)) for item in baseline))
control=state/'control';control.write_text('Source: closure-check\n\nPackage: closure-check\nArchitecture: any\nDescription: data-only dependency check\n')
architecture=subprocess.check_output(['dpkg','--print-architecture'],text=True).strip()
checked=[]
for name,original in installed.items():
 item=candidates.get(name,original)
 # Check admitted candidates AND all original reverse dependencies/conflicts.
 relationships=' '.join(item.get(key,'') for key in ['Depends','Pre-Depends','Conflicts','Breaks'])
 if name not in candidates and not any(re.search(r'(?<![\w+.-])'+re.escape(other)+r'(?![\w+.-])',relationships) for other in profile):continue
 depends=', '.join(item[key] for key in ['Pre-Depends','Depends'] if item.get(key))
 conflicts=', '.join(item[key] for key in ['Breaks','Conflicts'] if item.get(key))
 subprocess.run(['dpkg-checkbuilddeps','--admindir='+str(state),'-I','-a',architecture,'-d',depends,'-c',conflicts,str(control)],check=True)
 checked.append(name)
result={'baseline':'Exact full dpkg status frozen before apt/bootstrap','admitted_packages':sorted(profile),'new_Perl_companions':[],'status_overlay':'Only admitted candidate packages replace original versions; build dependency installations excluded','checked_forward_and_reverse_packages':checked,'resolver':'dpkg-checkbuilddeps -I using isolated data-only status, required dependencies and conflicts','result':'PASS'}
(work/'dependency-closure.json').write_text(json.dumps(result,indent=2)+'\n')
for package in ([] if args.read_only_debs else profile):
 document=work/'packages'/package/'usr/share/doc/runtime-perl'/package/'dependency-closure.json';document.write_text(json.dumps(result,indent=2)+'\n')
 # Receipt was added after initial package creation; regenerate checksums/package.
 root=work/'packages'/package;control_dir=root/'DEBIAN'
 import hashlib
 (control_dir/'md5sums').write_text(''.join(hashlib.md5(f.read_bytes()).hexdigest()+'  '+str(f.relative_to(root))+'\n' for f in sorted(root.rglob('*')) if f.is_file() and not f.is_symlink() and control_dir not in f.parents))
 subprocess.run(['dpkg-deb','--build',str(root),'/out/'+package+'.deb'],check=True)
print('PASS candidate and reverse dependency closure against actual pre-bootstrap package state')
