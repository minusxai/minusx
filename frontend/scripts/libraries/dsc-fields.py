"""Strict single-paragraph Deb822 source-control fields from a clearsigned DSC."""
import re

def parse_dsc_fields(text):
    fields = {}
    key = None
    started = False
    for line in text.splitlines():
        if not started:
            if not line.startswith('Format:'):
                continue
            started = True
        if line == '-----BEGIN PGP SIGNATURE-----':
            break
        if not line.strip():
            key = None
            continue
        if line.startswith((' ', '\t')):
            if key is None:
                raise ValueError('Continuation without a source-control field')
            fields[key] += ' ' + line.strip()
            continue
        match = re.fullmatch(r'([A-Za-z0-9][A-Za-z0-9-]*):[ \t]*(.*)', line)
        if match is None:
            raise ValueError('Invalid source-control field header')
        key, value = match.groups()
        if key in fields:
            raise ValueError('Duplicate source-control field: ' + key)
        fields[key] = value
    if not started or fields.get('Format') != '3.0 (quilt)':
        raise ValueError('Unsupported or missing source-control Format')
    return fields
