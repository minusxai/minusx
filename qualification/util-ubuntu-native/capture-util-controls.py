"""Bounded technical observations for four selected dpkg info sets; no acceptance."""
import hashlib,io,json,stat,subprocess,sys,tarfile
from pathlib import Path
import runpy
helpers=runpy.run_path(str(Path(__file__).with_name("check-util-final.py")))
package_prefixes=helpers["installed_prefixes"](helpers["statuses"](Path("/var/lib/dpkg/status")))
plan,debs,out=map(Path,sys.argv[1:]);plan=json.loads(plan.read_text());names={'libmount1','util-linux','mount'};assert set(plan['packages'])==names
result={}
for name in sorted(names):
    candidate=debs/(name+'.deb');assert hashlib.sha256(candidate.read_bytes()).hexdigest()==plan['packages'][name]['sha256']
    expected={}
    with tarfile.open(fileobj=io.BytesIO(subprocess.check_output(['dpkg-deb','--ctrl-tarfile',str(candidate)]))) as archive:
        for member in archive:
            label=member.name.removeprefix('./')
            if member.isdir() or label=='control':continue
            assert member.isfile() and '/' not in label
            content=archive.extractfile(member).read();expected[label]={'mode':member.mode,'uid':member.uid,'gid':member.gid,'size':len(content),'sha256':hashlib.sha256(content).hexdigest()}
    anchor=Path(subprocess.check_output(['dpkg-query','--control-path',name,'md5sums'],text=True).strip())
    assert anchor.parent==Path('/var/lib/dpkg/info')
    prefix=anchor.name.removesuffix('.md5sums');assert anchor.name==prefix+'.md5sums' and prefix in (name,name+':amd64')
    observed={}
    for path in sorted(anchor.parent.iterdir()):
        if helpers['info_owner'](path.name,package_prefixes) not in (name,name+':amd64'):continue
        info=path.lstat();item={'mode':stat.S_IMODE(info.st_mode),'uid':info.st_uid,'gid':info.st_gid,'size':info.st_size}
        if stat.S_ISREG(info.st_mode):item.update(kind='file',sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        elif path.is_symlink():item['kind']='symlink'
        elif path.is_dir():item['kind']='directory'
        else:item['kind']='unsupported'
        observed[path.name]=item
    result[name]={'selected_prefix':prefix,'queried_names':subprocess.check_output(['dpkg-query','--control-list',name],text=True).splitlines(),'candidate_controls':expected,'stored_files':observed}
out.write_text(json.dumps({'kind':'util-selected-control-observation','status':'diagnostic-only-unadmitted','native_qualified':False,'packages':result},sort_keys=True,indent=2)+'\n')
