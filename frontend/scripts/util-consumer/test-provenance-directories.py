"""Policy controls only; no native installation is asserted."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

module = importlib.util.spec_from_file_location('policy', Path(__file__).with_name('check-provenance-directories.py'))
policy = importlib.util.module_from_spec(module)
module.loader.exec_module(policy)
raw = Path(sys.argv[2]).read_bytes()
spec = json.loads(Path(sys.argv[1]).read_text())
assert len(spec['paths']) == 6
assert set(spec['paths']) == {'/usr/share/doc/' + name + '/runtime-security' + suffix for name in ('libmount1', 'util-linux', 'login') for suffix in ('', '/patches')}
for inspect in (lambda path: None, lambda path: spec['paths'][path], lambda path: None if path.endswith('/patches') else spec['paths'][path]):
    policy.check(spec, raw, inspect)
negatives = 0
def reject(candidate, data, inspect):
    global negatives
    try:
        policy.check(candidate, data, inspect)
    except (AssertionError, KeyError, TypeError):
        negatives += 1
        return
    raise AssertionError('Invalid directory policy accepted')
for key, value in [('kind', 'file'), ('kind', 'symlink'), ('mode', 0o777), ('uid', 1), ('gid', 1)]:
    reject(spec, raw, lambda path, k=key, v=value: {**spec['paths'][path], k: v})
for path in ['/usr/bin/unexpected', '/usr/share/doc/libmount1/runtime-security/../escape', '/usr/share/doc/libmount1/other']:
    changed = copy.deepcopy(spec)
    changed['paths'][path] = next(iter(spec['paths'].values()))
    reject(changed, raw, lambda path: None)
for key, value in [('uid', False), ('mode', 0o777), ('kind', 'file')]:
    changed = copy.deepcopy(spec)
    changed['paths'][next(iter(changed['paths']))][key] = value
    reject(changed, raw, lambda path: None)
reject(spec, raw + b'changed', lambda path: None)
changed = copy.deepcopy(spec)
no_rule = b'path-exclude /usr/share/other/*\n'
changed['dpkg_policy_sha256'] = hashlib.sha256(no_rule).hexdigest()
reject(changed, no_rule, lambda path: None)
print(json.dumps({'kind': 'provenance-directory-policy-controls', 'status': 'controls-only-unadmitted', 'positive': 3, 'negative_controls': negatives, 'candidate_directory_count': len(spec['paths'])}))
