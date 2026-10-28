"""Require completed typed package-only gates before a native transaction."""
import json,sys
from pathlib import Path
r=json.loads(Path(sys.argv[1]).read_text())
assert set(r)=={'kind','status','source_compiled','native_admitted','exit_codes'}
assert r['kind']=='util-package-transport' and r['status']=='package-only-unadmitted'
assert r['source_compiled'] is False and r['native_admitted'] is False
assert set(r['exit_codes'])=={'source','mount','plan'}
assert all(type(code)is int and code==0 for code in r['exit_codes'].values()), 'Unadmitted package postprocessor failed or was not reached'
