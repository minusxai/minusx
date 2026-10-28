"""Compare complete pristine technical graph with raw source-family snapshots.

Read-only and independent of compiled .debs, subprocesses, APT or installed tools.
Only Essential/Protected absent and explicit no share dpkg's false semantics.
No raw status, graph, control, ownership or payload bytes are rewritten.
"""
from email.parser import Parser
import hashlib
import json
from pathlib import Path
import re
import sys


GRAPH_FIELDS = {'Package', 'Architecture', 'Version', 'Status', 'Source',
    'Essential', 'Protected', 'Multi-Arch', 'Pre-Depends', 'Depends',
    'Recommends', 'Suggests', 'Enhances', 'Provides', 'Conflicts', 'Breaks', 'Replaces'}


def field_value(field, value):
    normalized = re.sub(r'\s+', ' ', value or '').strip()
    if field in ('Essential', 'Protected'):
        assert normalized in ('', 'yes', 'no'), ('Invalid pristine boolean', field)
        return normalized or 'no'
    return normalized


def source_identity(item):
    source = field_value('Source', item['Source'])
    if not source:
        return item['Package'], item['Version']
    match = re.fullmatch(r'([a-z0-9][a-z0-9+.-]*)(?: \(([^()\s]+)\))?', source)
    assert match, 'Malformed captured Source field'
    return match.group(1), match.group(2) or item['Version']


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compare_pristine(original):
    original = Path(original)
    resolver = original / 'resolver'
    required = {'raw-status.sha256', 'resolver-status', 'package-source-map',
                'architecture', 'foreign-architectures', 'installed-util-family'}
    assert {p.name for p in resolver.iterdir()} == required, 'Incomplete pristine resolver profile'
    raw_database_hash = (resolver / 'raw-status.sha256').read_text()
    assert re.fullmatch('[0-9a-f]{64}\n', raw_database_hash)
    architecture = (resolver / 'architecture').read_text().strip()
    rows = [line.split('\t') for line in (resolver / 'package-source-map').read_text().splitlines()]
    assert rows and all(len(row) == 6 for row in rows)
    graph = [Parser().parsestr(block) for block in
             (resolver / 'resolver-status').read_text().strip().split('\n\n')]
    for item in graph:
        assert len(item.keys()) == len(GRAPH_FIELDS) and set(item.keys()) == GRAPH_FIELDS, 'Incomplete or unexpected technical graph fields'
        for field in ('Essential', 'Protected'):
            field_value(field, item[field])
    graph_map = {(item['Package'], item['Architecture']): item for item in graph}
    assert len(graph_map) == len(graph) == len(rows), 'Incomplete whole installed resolver graph'
    for package, source, source_version, version, status, arch in rows:
        item = graph_map[(package, arch)]
        assert item['Version'] == version and item['Status'].split()[-1] == status
        assert source_identity(item) == (source, source_version), ('Whole graph/source-map identity mismatch', package, arch)
    expected = [row[0] for row in rows if row[1] == 'util-linux' and row[4] == 'installed']
    assert all(row[5] in (architecture, 'all') for row in rows if row[0] in expected)
    family = (resolver / 'installed-util-family').read_text().splitlines()
    assert family == expected and family and len(set(family)) == len(family), 'Source-family graph mismatch'
    assert {p.name for p in original.iterdir()} == set(family) | {'resolver'}
    evidence = {}
    for package in family:
        assert re.fullmatch('[a-z0-9][a-z0-9+.-]*', package)
        snapshot = original / package
        for name in ['status', 'paths', 'present-paths', 'absent-documentation', 'control-list', 'payload.tar']:
            assert (snapshot / name).is_file(), ('Missing pristine family input', package, name)
        controls = set((snapshot / 'control-list').read_text().splitlines()) - {'list'}
        assert {p.name for p in (snapshot / 'controls').iterdir()} == controls, 'Incomplete original controls'
        control = Parser().parsestr((snapshot / 'status').read_text())
        assert control['Package'] == package and control['Architecture'] in (architecture, 'all')
        graph_control = graph_map[(package, control['Architecture'])]
        for field in graph_control.keys():
            assert field_value(field, control.get(field, '')) == field_value(field, graph_control[field]), ('Pristine graph/control mismatch', package, field)
        evidence[package] = {'architecture': control['Architecture'],
            'compared_graph_fields': list(graph_control.keys()),
            'raw_status_sha256': sha256(snapshot / 'status'),
            'payload_archive_sha256': sha256(snapshot / 'payload.tar'),
            'control_sha256': {name: sha256(snapshot / 'controls' / name) for name in sorted(controls)}}
    dpkg_rows = [row for row in rows if row[0] == 'dpkg' and row[5] == architecture and row[4] == 'installed']
    assert len(dpkg_rows) <= 1, 'Ambiguous installed native dpkg'
    installed_dpkg = None
    if dpkg_rows:
        package, source, source_version, version, status, arch = dpkg_rows[0]
        installed_dpkg = {'version': version, 'architecture': arch,
            'source_package': source, 'source_version': source_version}
    return {'kind': 'util-pristine-profile-comparison', 'status': 'pristine-technical-profile-matched',
        'source_compiled': False, 'metadata_accepted': False, 'native_qualified': False,
        'installed_dpkg': installed_dpkg,
        'dpkg_version_binding': 'captured-whole-graph-and-source-map' if installed_dpkg else 'unknown-no-installed-native-dpkg-row',
        'family_packages': family, 'whole_graph_package_arch_count': len(graph),
        'captured_raw_database_sha256': raw_database_hash.strip(),
        'resolver_status_sha256': sha256(resolver / 'resolver-status'),
        'source_map_sha256': sha256(resolver / 'package-source-map'),
        'boolean_default_semantics_fields': ['Essential', 'Protected'], 'family': evidence}


if __name__ == '__main__':
    assert len(sys.argv) == 3, 'Expected original snapshot directory and output JSON'
    result = compare_pristine(Path(sys.argv[1]))
    Path(sys.argv[2]).write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
