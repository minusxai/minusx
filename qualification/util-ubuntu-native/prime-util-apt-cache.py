"""Prime only four authenticated local archives for APT3.0.3 --no-download.
No fetch, dependency change, package extraction or installation is performed.
"""
import hashlib,json,os,re,stat,sys
from pathlib import Path

def prime(plan,debs,cache):
    assert set(plan['packages'])=={'libmount1','util-linux','mount'}
    assert cache.is_dir() and not cache.is_symlink() and cache.resolve()==cache
    assert cache.stat().st_uid==0 and not stat.S_IMODE(cache.stat().st_mode)&0o022
    result={}
    for name,spec in sorted(plan['packages'].items()):
        version=spec['candidate_version']
        assert re.fullmatch(r'[0-9][A-Za-z0-9.+:~\-]*',version)
        assert plan['architecture']=='amd64'
        # APT QuoteString(name,"_:")/version("_:")/arch("_:.").
        # These reviewed names/architecture contain none; only epoch colon needs quoting.
        filename=name+'_'+version.replace(':','%3a')+'_amd64.deb'
        source=debs/(name+'.deb');assert source.is_file() and not source.is_symlink()
        data=source.read_bytes();digest=hashlib.sha256(data).hexdigest();assert digest==spec['sha256']
        destination=cache/filename
        if destination.exists() or destination.is_symlink():
            assert destination.is_file() and not destination.is_symlink()
            assert destination.read_bytes()==data, 'Existing cache archive differs; never overwrite'
        else:
            fd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
            os.fchmod(fd,0o644)
            with os.fdopen(fd,'wb') as stream:stream.write(data)
        info=destination.lstat()
        assert stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode)==0o644 and info.st_uid==info.st_gid==0
        assert info.st_size==len(data) and hashlib.sha256(destination.read_bytes()).hexdigest()==digest
        result[name]={'cache_filename':filename,'sha256':digest,'size':len(data)}
    return {'kind':'util-local-apt-cache-priming','status':'cache-only-unadmitted','native_qualified':False,'network_fetches':0,'packages':result}
if __name__=='__main__':
    plan,debs,cache,out=map(Path,sys.argv[1:]);assert os.geteuid()==0
    out.write_text(json.dumps(prime(json.loads(plan.read_text()),debs,cache),sort_keys=True,indent=2)+'\n')
