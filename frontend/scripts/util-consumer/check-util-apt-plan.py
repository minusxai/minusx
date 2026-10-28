"""Validate retained apt-get -s --no-download --no-remove install output.
Caller must bind stdout, zero exit, exact argv, candidate hashes and fresh status.
This parser never invokes apt or installs packages.
"""
import json,re,sys
from pathlib import Path
def validate(text, plan):
    names={'util-linux','libmount1','login','mount'}
    assert set(plan['packages'])==names
    found={'Inst':{},'Conf':{}}
    # APT3.0.3 pkgSimulate::RealInstall/ShortBreaks emits transient
    # old-consumer Pre-Depends annotations during this exact reviewed plan.
    allowed_annotations={'util-linux:amd64 on libmount1:amd64','mount:amd64 on libmount1:amd64','util-linux:amd64 mount:amd64 ','mount:amd64 '}
    for line in text.splitlines():
        if line.startswith(('Remv ','Purg ','E:','W:')): raise AssertionError('Unreviewed removal/error/warning')
        if not line.startswith(('Inst ','Conf ')): continue
        action_line,separator,suffix=line.partition(') [')
        if separator:
            action_line+=')'
            annotations=re.findall(r'\[([^\[\]]+)\]', '['+suffix)
            assert annotations and ' '.join('['+a+']' for a in annotations)=='['+suffix, 'Unsupported APT annotation grammar'
            assert all(a in allowed_annotations for a in annotations), 'Unreviewed transient relationship annotation'
        match=re.fullmatch(r'(Inst|Conf) ([a-z0-9][a-z0-9+.-]*)(?: \[([^\]]+)\])? \(([^ ()]+)(?: [^()]*)?\)',action_line)
        assert match, 'Unsupported APT action grammar: '+repr(line)
        action,name,old,new=match.groups()
        assert name in names and name not in found[action]
        spec=plan['packages'][name]
        assert new==spec['candidate_version']
        if action=='Inst': assert old==spec['original_version'], 'New names or unexpected original versions rejected'
        else: assert old is None
        found[action][name]=new
    assert set(found['Inst'])==names and set(found['Conf'])==names, 'All four existing candidates must be installed/configured'
    return {'kind':'util-exact-apt-plan','status':'simulation-only-unadmitted','native_qualified':False,'install_names':sorted(names),'removals':[],'new_names':[]}
if __name__=='__main__':
    print(json.dumps(validate(Path(sys.argv[1]).read_text(),json.loads(Path(sys.argv[2]).read_text())),sort_keys=True))
