"""Convert strict PRE-APT core-Perl capture after Python tooling is installed."""
import json,pathlib,re,sys

def valid_path(value):
    assert re.fullmatch(r'/usr/[A-Za-z0-9_+./-]+',value), 'Invalid captured /usr path'
    assert '..' not in pathlib.PurePosixPath(value).parts
    assert str(pathlib.PurePosixPath(value))==value, 'Noncanonical captured path'
    return value

def parse_capture(text):
    assert text.endswith('\n') and '\r' not in text and '\x00' not in text
    lines=text.splitlines();assert len(lines)>=3
    assert lines[0]=='FORMAT\t1'
    header=lines[1].split('\t');assert len(header)==2 and header[0]=='PERL_VERSION'
    assert re.fullmatch(r'5\.\d+\.\d+',header[1])
    inc=[];empty={}
    for line in lines[2:]:
        parts=line.split('\t')
        if parts[0]=='INC':
            assert len(parts)==2
            name=valid_path(parts[1]);assert name not in inc;inc.append(name)
        else:
            assert len(parts)==5 and parts[0]=='EMPTY'
            name=valid_path(parts[1]);assert name in inc and name not in empty
            assert all(re.fullmatch(r'0|[1-9][0-9]*',x) for x in parts[2:])
            mode,uid,gid=map(int,parts[2:]);assert 0<=mode<=0o7777 and 0<=uid<2**32 and 0<=gid<2**32
            empty[name]={'type':'directory','mode':mode,'uid':uid,'gid':gid}
    assert inc and inc==sorted(inc)
    return {'format':1,'perl_version':header[1],'original_inc':inc,'empty_directories':empty}

if __name__=='__main__':
    assert len(sys.argv)==3
    result=parse_capture(pathlib.Path(sys.argv[1]).read_text())
    pathlib.Path(sys.argv[2]).write_text(json.dumps(result['empty_directories'],sort_keys=True)+'\n')
