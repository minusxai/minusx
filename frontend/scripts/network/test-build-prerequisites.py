"""Source-only tool admission must follow frozen profile and precede use."""
import pathlib,shlex
script=pathlib.Path(__file__).with_name('build-network.sh').read_text()
def check(source):
 lines=source.splitlines();use=next(i for i,line in enumerate(lines) if 'python3 "$here/prepare-curl-source.py"' in line);snapshot=next(i for i,line in enumerate(lines) if 'snapshot /network-work/baseline.json' in line);tools=set()
 for line in lines[:use]:
  words=shlex.split(line)
  if words[:2]==['apt-get','install']:
   assert lines.index(line)>snapshot or not {'git','autoconf','automake','libtool'}&set(words),'Source tools must follow frozen payload profile'
   tools.update(word for word in words[2:] if not word.startswith('-'))
 assert {'git','autoconf','automake','libtool','gnupg'}<=tools,('Missing mandatory source-preparation package',{'git','autoconf','automake','libtool','gnupg'}-tools)
check(script)
try:check(script.replace('dpkg-dev git pkg-config','dpkg-dev pkg-config'))
except AssertionError:pass
else:raise AssertionError('Missing git regression was not rejected')
print('PASS: explicit source prerequisites after frozen profile; missing git rejected')
