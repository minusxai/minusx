"""Record an actual pristine profile, never source/native qualification."""
import hashlib
import json
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True
from validate_transport import validate_transport

assert os.environ['QUALIFICATION_OS'] in ('debian', 'ubuntu')
sys.path.insert(0, str(Path(__file__).parent / (os.environ['QUALIFICATION_OS'] + '-phase')))
from compare_pristine import compare_pristine

root = Path(sys.argv[1])
validate_transport(root, 'snapshot')
comparison = compare_pristine(root / 'pristine-original')
assert comparison['installed_dpkg'], 'Actual installed dpkg identity required'
(root / 'pristine-comparison.json').write_text(json.dumps(comparison, indent=2, sort_keys=True) + '\n')
files = {}
for path in sorted(root.rglob('*')):
    assert not path.is_symlink(), 'Unexpected snapshot transport symlink'
    if path.is_file():
        files[str(path.relative_to(root))] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                             'size': path.stat().st_size}
record = {'kind': 'util-pristine-profile-evidence', 'status': 'snapshot-only-unadmitted',
          'source_compiled': False, 'metadata_accepted': False, 'native_qualified': False,
          'source_head': os.environ['SOURCE_HEAD'], 'run_id': int(os.environ['RUN_ID']),
          'run_attempt': int(os.environ['RUN_ATTEMPT']), 'os': os.environ['QUALIFICATION_OS'],
          'comparison': comparison, 'files': files}
(root / 'pristine-evidence.json').write_text(json.dumps(record, indent=2, sort_keys=True) + '\n')
