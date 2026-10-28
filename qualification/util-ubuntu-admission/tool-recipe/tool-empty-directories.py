"""Preserve only verified empty original Perl search directories in a tool root."""
import json,os,pathlib,stat,subprocess,sys

def metadata(path):
 st=path.lstat();assert stat.S_ISDIR(st.st_mode) and not path.is_symlink(),str(path)
 return dict(type='directory',mode=stat.S_IMODE(st.st_mode),uid=st.st_uid,gid=st.st_gid)

def capture(paths,source=pathlib.Path('/')):
 result={}
 for name in paths:
  assert name.startswith('/usr/') and '..' not in pathlib.PurePosixPath(name).parts,name
  path=source/name.lstrip('/')
  assert path.resolve().is_relative_to(source.resolve()),name
  if path.is_dir() and not path.is_symlink() and not any(path.iterdir()):result[name]=metadata(path)
 return result

def restore(name,root,original,source=pathlib.Path('/')):
 assert name in original,('Missing authenticated original empty directory',name)
 path=source/name.lstrip('/');assert metadata(path)==original[name],name
 assert not any(path.iterdir()),('Original directory acquired ambient modules',name)
 target=root/name.lstrip('/');assert target.resolve().is_relative_to(root.resolve()),name
 assert not target.exists() and not target.is_symlink(),name
 target.mkdir(parents=True);os.chmod(target,original[name]['mode']);os.chown(target,original[name]['uid'],original[name]['gid'])
 assert metadata(target)==original[name] and not any(target.iterdir()),name
 return original[name]

if __name__=='__main__':
 paths=json.loads(subprocess.check_output(['perl','-MJSON::PP','-e','print encode_json([grep {-d $_ && m{^/usr/}} @INC])'],text=True))
 pathlib.Path(sys.argv[1]).write_text(json.dumps(capture(paths),sort_keys=True)+'\n')
