"""Retain unadmitted prepared packages even when a postprocessor gate rejects."""
import json,subprocess,shutil,sys
from pathlib import Path
checks,recipe,work,output=map(Path,sys.argv[1:]);export=Path('/package-export');export.mkdir()
steps=[('source', ['python3',str(recipe/'package.py'),'package',str(recipe),str(work)]),('mount',['python3',str(checks/'mount-metadata-only.py'),str(work/'original/mount'),str(output/'mount.deb')]),('plan',['python3',str(checks/'prepare-plan.py'),str(checks),str(work),str(output),'/acceptance-inputs'])]
results={name:None for name,_ in steps}
for name,argv in steps:
    with (export/(name+'.stdout')).open('wb') as stdout,(export/(name+'.stderr')).open('wb') as stderr:
        result=subprocess.run(argv,stdout=stdout,stderr=stderr)
    results[name]=result.returncode
    if result.returncode:break
status={'kind':'util-package-transport','status':'package-only-unadmitted','source_compiled':False,'native_admitted':False,'exit_codes':results}
(export/'package-status.json').write_text(json.dumps(status,sort_keys=True,indent=2)+'\n')
Path('/package-status.json').write_bytes((export/'package-status.json').read_bytes())
for name in ['libmount1','util-linux','login','mount']:
    path=output/(name+'.deb')
    if path.is_file():
        (export/'packages').mkdir(exist_ok=True);shutil.copy2(path,export/'packages'/path.name)
for name in ['package-relationship-diagnostics.json','mount-postprocess.json']:
    path=output/name
    if path.is_file():shutil.copy2(path,export/name)
inputs=Path('/acceptance-inputs')
if inputs.exists():
    for path in inputs.iterdir():
        assert path.is_file() and not path.is_symlink();shutil.copy2(path,export/path.name)
# An export transport success is never package/native admission. Both the host
# and the native stage independently require every typed phase exit code zero.
