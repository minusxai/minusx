"""Verify downloaded archives against exact identity in authenticated APT records."""
import hashlib,re

def expected_hashes(metadata,package,version,architecture):
    matches=[]
    for paragraph in re.split(r"\n[ \t]*\n",metadata.strip()):
        fields={}
        for line in paragraph.splitlines():
            if line.startswith((' ', '\t')): continue
            key,sep,value=line.partition(':')
            if not sep or key in fields: raise ValueError('Malformed or duplicate APT field')
            fields[key]=value.strip()
        if (fields.get('Package'),fields.get('Version'),fields.get('Architecture')) != (package,version,architecture):
            raise ValueError('APT identity differs from exact requested package')
        # apt-cache can also print the installed status record, which has no index filename.
        if 'Filename' not in fields: continue
        filename=fields['Filename']
        if not re.fullmatch(r'pool/[A-Za-z0-9+._/%~-]+(?:/[A-Za-z0-9+._%~-]+)*\.deb',filename) or '..' in filename.split('/'):
            raise ValueError('Unexpected APT archive filename')
        hashes={}
        for field,algorithm,length in [('SHA256','sha256',64),('SHA512','sha512',128)]:
            if field in fields:
                if not re.fullmatch('[0-9a-f]{'+str(length)+'}',fields[field]):
                    raise ValueError('Malformed strong APT digest')
                hashes[algorithm]=fields[field]
        if not hashes: raise ValueError('APT record has no supported strong digest')
        size=fields.get('Size','')
        if not re.fullmatch(r'[1-9][0-9]*',size): raise ValueError('Missing APT archive size')
        matches.append(dict(filename=filename,size=int(size),hashes=hashes))
    if not matches or any(record!=matches[0] for record in matches):
        raise ValueError('Missing or ambiguous exact APT archive record')
    return matches[0]

def verify_archive(path,record):
    data=path.read_bytes()
    if len(data)!=record['size']: raise ValueError('APT archive size mismatch')
    for algorithm,expected in record['hashes'].items():
        if hashlib.new(algorithm,data).hexdigest()!=expected:
            raise ValueError('APT archive '+algorithm+' mismatch')
    return hashlib.sha256(data).hexdigest()
