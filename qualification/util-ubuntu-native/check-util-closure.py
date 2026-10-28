"""Data-only closure gate. Caller authenticates producer and restores frozen inputs first.
Never installs packages; candidate output remains unadmitted.
Run inside disposable Linux resolver environment, not on the host.
"""
import argparse, hashlib, json, os, re, subprocess, tempfile
from pathlib import Path
from email.parser import Parser
NAMES = {'util-linux', 'libmount1', 'mount'}
FIELDS = ('Depends','Pre-Depends','Recommends','Suggests','Enhances','Breaks','Conflicts','Replaces','Provides')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def fields(text):
    parsed = Parser().parsestr(text)
    assert not parsed.defects
    assert len(parsed.keys()) == len(set(parsed.keys())), 'Duplicate control fields'
    return dict(parsed.items())
def run(argv):
    env = {k:v for k,v in os.environ.items() if not k.startswith(('LD_', 'DYLD_', 'PERL', 'GLIBC'))}
    env.update(PATH='/usr/bin:/bin', LC_ALL='C')
    return subprocess.check_output(argv, text=True, env=env, stderr=subprocess.STDOUT)
def closure(status, plan, debs, destination):
    assert set(plan) == {'kind','status','status_sha256','architecture','packages','target_binding_sha256','source_builder_status_not_runtime_binding'}
    assert plan['status']=='UNADMITTED-PACKAGE-PLAN' and plan['source_builder_status_not_runtime_binding']is True
    assert re.fullmatch('[0-9a-f]{64}',plan['target_binding_sha256'])
    assert plan['kind'] == 'util-ubuntu-three-package-review-candidate'
    assert sha(status) == plan['status_sha256'], 'Exact fresh pre-bootstrap status required'
    assert set(plan['packages']) == NAMES, 'Only reviewed three existing package names'
    blocks = [fields(b) for b in status.read_text().split('\n\n') if b.strip()]
    installed_blocks = [b for b in blocks if b.get('Status') == 'install ok installed']
    installed = {b['Package']:b for b in installed_blocks}
    assert len(installed) == len(installed_blocks), 'Multiarch duplicate requires separate review'
    assert NAMES <= installed.keys()
    assert re.fullmatch(r'[a-z0-9][a-z0-9-]*', plan['architecture'])
    candidates = {}
    for name in sorted(NAMES):
        spec = plan['packages'][name]
        assert set(spec) == {'original_version','candidate_version','sha256','source','mode'}
        assert spec['mode'] == ('metadata-only-original-payload' if name == 'mount' else 'retained-corrected-source-payload')
        assert installed[name]['Version'] == spec['original_version']
        path = debs/(name+'.deb')
        assert path.is_file() and not path.is_symlink() and sha(path) == spec['sha256']
        item = fields(run(['dpkg-deb','-f',str(path)]))
        assert item['Package'] == name and item['Version'] == spec['candidate_version']
        assert item['Architecture'] == installed[name]['Architecture'] == plan['architecture']
        assert item.get('Source', name) == spec['source'], 'Source bookkeeping differs'
        assert item['Version'] != installed[name]['Version']
        assert run(['dpkg','--compare-versions',item['Version'],'gt',installed[name]['Version']]) == ''
        item['Status'] = 'install ok installed'
        candidates[name] = item
    with tempfile.TemporaryDirectory(prefix='util-closure-') as tmp:
        state = Path(tmp)
        def render(item): return ''.join(k+': '+v+'\n' for k,v in item.items())
        (state/'status').write_text('\n'.join(render(candidates.get(b['Package'],b)) for b in blocks))
        control = state/'control'
        control.write_text('Source: closure-check\n\nPackage: closure-check\nArchitecture: any\nDescription: data-only closure check\n')
        for name, original in sorted(installed.items()):
            item = candidates.get(name, original)
            depends = ', '.join(item[k] for k in ('Pre-Depends','Depends') if item.get(k))
            conflicts = ', '.join(item[k] for k in ('Breaks','Conflicts') if item.get(k))
            # Every installed package is checked, including all reverse dependencies.
            run(['/qualification-tools/resolver-bin/dpkg-checkbuilddeps','--admindir='+str(state),'-I','-a',plan['architecture'],'-d',depends,'-c','',str(control)])
            if conflicts:
                # Binary packages may conflict with a virtual package they
                # themselves provide. dpkg excludes the package itself.
                conflict_state=state/'without-self'
                conflict_state.mkdir(exist_ok=True)
                (conflict_state/'status').write_text('\n'.join(render(candidates.get(b['Package'],b)) for b in blocks if b['Package'] != name))
                run(['/qualification-tools/resolver-bin/dpkg-checkbuilddeps','--admindir='+str(conflict_state),'-I','-a',plan['architecture'],'-d','','-c',conflicts,str(control)])
    result = {'kind':'util-data-only-closure','status':'closure-only-unadmitted','native_qualified':False,
              'baseline_sha256':sha(status),'plan_sha256':hashlib.sha256(json.dumps(plan,sort_keys=True).encode()).hexdigest(),
              'checked_installed_packages':len(installed),'candidate_names':sorted(NAMES),
              'candidate_deb_sha256':{n:plan['packages'][n]['sha256'] for n in sorted(NAMES)},
              'new_package_names':[], 'resolver':'dpkg-checkbuilddeps all installed forward/reverse Depends/Pre-Depends/Breaks/Conflicts'}
    destination.write_text(json.dumps(result,sort_keys=True,indent=2)+'\n')
if __name__ == '__main__':
    p=argparse.ArgumentParser(); p.add_argument('status',type=Path); p.add_argument('plan',type=Path); p.add_argument('debs',type=Path); p.add_argument('receipt',type=Path)
    a=p.parse_args(); closure(a.status,json.loads(a.plan.read_text()),a.debs,a.receipt)
