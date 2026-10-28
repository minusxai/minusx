"""Select installed APT graph members; validate closure using Debian's resolver."""
import pathlib,subprocess,tempfile

def select_members(names,records,seeds):
 selected={name:records[name] for name in names if records.get(name,{}).get('Status')=='install ok installed'}
 chosen={}
 for block in selected.values():
  name=block['Package'];assert name not in chosen or chosen[name]==block,'Conflicting tool package aliases'
  chosen[name]=block
 assert set(seeds)<=set(chosen),'Required seed package missing from actual installed closure'
 return chosen,sorted(set(names)-set(selected))

def validate_closure(chosen,architecture):
 with tempfile.TemporaryDirectory(prefix='perl-tools-status-') as temporary:
  root=pathlib.Path(temporary)
  (root/'status').write_text('\n\n'.join('\n'.join(k+': '+v for k,v in block.items()) for block in chosen.values())+'\n')
  control=root/'control';control.write_text('Source: disposable-tools\n\nPackage: disposable-tools\nArchitecture: any\nDescription: tools-only closure\n')
  for name,block in chosen.items():
   depends=', '.join(block[k] for k in ['Pre-Depends','Depends'] if block.get(k))
   conflicts=', '.join(block[k] for k in ['Breaks','Conflicts'] if block.get(k))
   subprocess.run(['dpkg-checkbuilddeps','--admindir='+temporary,'-I','-a',architecture,'-d',depends,'-c',conflicts,str(control)],check=True)
 return {'status':'passed','resolver':'actual dpkg-checkbuilddeps against only selected installed tool packages, retaining versioned Provides','packages':sorted(chosen)}
