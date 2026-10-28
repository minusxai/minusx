"""Require the preserved complete distro suite's terminal success summary."""
import hashlib
import json
from pathlib import Path
import re
import sys

log, output = map(Path, sys.argv[1:3])
expected = int(sys.argv[3])
data = log.read_bytes()
text = data.decode('utf-8', errors='strict')
summaries = re.findall(r'^\s*All ([0-9]+) tests PASSED\s*$', text, re.MULTILINE)
assert summaries == [str(expected)], ('Missing, repeated, or changed full-suite summary', summaries, expected)
# Known-failure/skip decisions are the distro's unchanged suite decisions.
# Record their presence without relabeling them as executed passing tests.
receipt = {'kind': 'util-source-distro-suite-summary', 'expected_suite_count': expected,
           'observed_suite_count': expected, 'source_log_sha256': hashlib.sha256(data).hexdigest(),
           'known_failed_lines': sum('KNOWN FAILED' in x for x in text.splitlines()),
           'skipped_lines': sum('SKIPPED' in x for x in text.splitlines()),
           'scope': 'Original distro suite summary, preserving original known-failure and skip decisions'}
output.write_text(json.dumps(receipt, indent=2, sort_keys=True) + '\n')
print(json.dumps(receipt, sort_keys=True))
