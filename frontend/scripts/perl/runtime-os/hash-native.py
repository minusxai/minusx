"""Bind packaged ELF bytes to the final image without shipping fixture executables."""
import hashlib,json,pathlib,subprocess,sys,tempfile
out=pathlib.Path(sys.argv[1]);result={}
for package in sorted(out.glob('*.deb')):
    with tempfile.TemporaryDirectory(prefix='runtime-native-') as directory:
        root=pathlib.Path(directory)
        subprocess.run(['dpkg-deb','--extract',str(package),str(root)],check=True)
        for path in root.rglob('*'):
            if path.is_symlink() or not path.is_file():continue
            with path.open('rb') as stream:header=stream.read(4)
            if header!=b'\x7fELF':continue
            destination='/'+path.relative_to(root).as_posix()
            sha=hashlib.sha256(path.read_bytes()).hexdigest()
            if destination in result and result[destination]!=sha:raise ValueError('Conflicting native package payload: '+destination)
            result[destination]=sha
(out/'runtime-native-sha256.json').write_text(json.dumps(result,sort_keys=True)+'\n')
