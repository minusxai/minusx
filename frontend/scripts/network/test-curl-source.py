"""Actual gpgv+DSC/archive controls; no compilation or containers."""
import os,pathlib,subprocess,sys,tempfile
here=pathlib.Path(__file__).resolve().parent;source=pathlib.Path(sys.argv[1]).resolve();verifier=pathlib.Path(sys.argv[2]).resolve();env=os.environ.copy();env['PATH']=str(verifier.parent)+os.pathsep+env['PATH']
with tempfile.TemporaryDirectory() as directory:
 root=pathlib.Path(directory)
 names=['curl_8.18.0.orig.tar.gz','curl_8.18.0.orig.tar.gz.asc','curl_8.18.0-1ubuntu2.8.debian.tar.xz','curl_8.18.0-1ubuntu2.8.dsc']
 for name in names:(root/name).symlink_to(source/name)
 def check(success):
  r=subprocess.run([sys.executable,str(here/'prepare-curl-source.py'),str(here),str(root),'--verify-only'],env=env,text=True,capture_output=True);assert (r.returncode==0)==success,r.stdout+r.stderr
 check(True)
 dsc=root/names[-1];dsc.unlink();dsc.write_text((source/names[-1]).read_text().replace('Source: curl','Source: changed',1));check(False);dsc.unlink();dsc.symlink_to(source/names[-1])
 archive=root/names[0];archive.unlink();archive.write_bytes(b'ordinary changed archive');check(False)
 print('PASS: actual source authentication, tampered DSC and archive rejection')
