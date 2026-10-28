"""Source-only tool admission must follow frozen profile and precede use."""
import pathlib,shlex,subprocess,tempfile,os
script=pathlib.Path(__file__).with_name('build-network.sh').read_text()
def check(source):
 lines=source.splitlines();use=next(i for i,line in enumerate(lines) if 'python3 "$here/prepare-curl-source.py"' in line);snapshot=next(i for i,line in enumerate(lines) if 'snapshot /network-work/baseline.json' in line);tools=set()
 for line in lines[:use]:
  words=shlex.split(line)
  if words[:2]==['apt-get','install']:
   assert lines.index(line)>snapshot or not {'git','gpgv','autoconf','automake','libtool'}&set(words),'Source tools must follow frozen payload profile'
   tools.update(word for word in words[2:] if not word.startswith('-'))
 assert {'git','gpgv','autoconf','automake','libtool','gnupg'}<=tools,('Missing mandatory source-preparation package',{'git','gpgv','autoconf','automake','libtool','gnupg'}-tools)
check(script)
for old,new in [('dpkg-dev git pkg-config','dpkg-dev pkg-config'),('gnupg gpgv libssl-dev','gnupg libssl-dev')]:
 try:check(script.replace(old,new))
 except AssertionError:pass
 else:raise AssertionError('Missing explicit package regression was not rejected: '+old)
# Execute the exact shell admission block against controlled executable inventories.
# These are command-availability controls, not claims that Linux builds ran.
block=script.split('# BEGIN source-tool-admission\n',1)[1].split('# END source-tool-admission',1)[0]
tools=block.split('for tool in ',1)[1].split(';do',1)[0].split()
with tempfile.TemporaryDirectory() as directory:
 root=pathlib.Path(directory)
 for name in tools:
  f=root/name;f.write_text('#!/bin/sh\nexit 0\n');f.chmod(0o755)
 def admission():return subprocess.run(['/bin/sh','-c',block],env={'PATH':directory},capture_output=True,text=True)
 assert admission().returncode==0
 for name in ['git','gpgv']:
  f=root/name;f.unlink();result=admission();assert result.returncode==1 and name in result.stderr,result
  f.write_text('#!/bin/sh\nexit 0\n');f.chmod(0o755)
 for name in ['git','gpgv']:(root/name).unlink()
 result=admission();assert 'git' in result.stderr and 'gpgv' in result.stderr,result
print('PASS: frozen-profile prerequisites; missing git/gpgv package controls; actual shell all-tools/missing-tools admission')
