"""Real Debian resolver self-conflict semantics; no package installation."""
import json,subprocess,tempfile,sys
from pathlib import Path
with tempfile.TemporaryDirectory(prefix='util-self-conflict-') as tmp:
    root=Path(tmp);control=root/'control'
    control.write_text('Source: fixture\n\nPackage: fixture\nArchitecture: any\nDescription: data-only resolver fixture\n')
    own='Package: util-linux\nVersion: 2\nArchitecture: amd64\nStatus: install ok installed\nProvides: hardlink\nConflicts: hardlink\n'
    other='Package: other-provider\nVersion: 1\nArchitecture: amd64\nStatus: install ok installed\nProvides: hardlink\n'
    results={}
    for name,text,expected in [('own-in-full-state',own,False),('self-excluded','',True),('other-provider-retained',other,False),('both-providers',own+'\n'+other,False)]:
        state=root/name;state.mkdir();(state/'status').write_text(text)
        result=subprocess.run(['dpkg-checkbuilddeps','--admindir='+str(state),'-I','-a','amd64','-d','','-c','hardlink',str(control)],capture_output=True,text=True)
        assert (result.returncode==0)==expected, (name,result.returncode)
        results[name]={'exit_code':result.returncode,'expected_success':expected}
    Path(sys.argv[1]).write_text(json.dumps({'kind':'util-real-resolver-self-conflict-controls','status':'diagnostic-only-unadmitted','native_qualified':False,'controls':results},indent=2)+'\n')
