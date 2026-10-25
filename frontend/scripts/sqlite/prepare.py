#!/usr/bin/env python3
"""Fetch exact Debian source, apply strict upstream backports and source fixtures."""
import hashlib,json,pathlib,shutil,subprocess,sys,urllib.request

def add_receipts(dest, recipe):
    """Stage receipts through the original Debian install target's DESTDIR."""
    shutil.copyfile(recipe/'provenance.json', dest/'runtime-source.json')
    shutil.copytree(recipe/'patches', dest/'runtime-patches')
    rules = dest/'debian/rules'
    text = rules.read_text()
    anchor = '\t$(MAKE) install DESTDIR=$(DESTDIR)\n'
    if text.count(anchor) != 1:
        raise SystemExit('Unexpected Debian install target')
    commands = ('\t# Begin runtime SQLite receipt staging\n'
                '\tinstall -d "$(DESTDIR)/usr/share/sqlite-runtime/patches"\n'
                '\tinstall -m 0644 runtime-source.json "$(DESTDIR)/usr/share/sqlite-runtime/runtime-source.json"\n'
                '\tinstall -m 0644 runtime-patches/* "$(DESTDIR)/usr/share/sqlite-runtime/patches/"\n'
                '\t# End runtime SQLite receipt staging\n')
    rules.write_text(text.replace(anchor, anchor + commands))
    install = dest/'debian/libsqlite3-0.install'
    install.write_text(install.read_text() + '\nusr/share/sqlite-runtime\n')

recipe=pathlib.Path(__file__).resolve().parent
cache=pathlib.Path(sys.argv[1]).resolve(); dest=pathlib.Path(sys.argv[2]).resolve()
cache.mkdir(parents=True,exist_ok=True)
if dest.exists(): raise SystemExit('Refusing to reuse source directory')
for name,record in json.loads((recipe/'sources.json').read_text()).items():
    file=cache/name
    if not file.exists(): urllib.request.urlretrieve(record['url'],file)
    if hashlib.sha256(file.read_bytes()).hexdigest()!=record['sha256']: raise SystemExit('Bad source checksum: '+name)
subprocess.run(['dpkg-source','-x',str(cache/'sqlite3_3.46.1-7+deb13u2.dsc'),str(dest)],check=True)
for issue,target in [('50812','session9.test'),('50813','sessionC.test')]:
    subprocess.run(['patch','--batch','--fuzz=0','-p1','-i',str(recipe/'patches'/(issue+'.patch'))],cwd=dest,check=True)
    file=dest/'ext/session'/target
    text=file.read_text()
    if text.count('\nfinish_test')!=1: raise SystemExit('Unexpected fixture layout')
    file.write_text(text.replace('\nfinish_test','\n'+(recipe/'patches'/('regression-'+issue+'.tcl')).read_text()+'\nfinish_test'))
subprocess.run(['patch','--batch','--fuzz=0','-p1','-i',str(recipe/'patches/50813-prerequisite.patch')],cwd=dest,check=True)
# Quilt local source changes are intentional; binary-only package build.
changelog=dest/'debian/changelog'
changelog.write_text('sqlite3 (3.46.1-7+deb13u2+runtime1) trixie; urgency=medium\n\n  * Backport upstream session bounds corrections, preserving Debian features.\n\n -- Runtime Builder <builder@example.invalid>  Sun, 25 Oct 2026 00:00:00 +0000\n\n'+changelog.read_text())

# Ship backport receipts outside /usr/share/doc, which slim images exclude.
add_receipts(dest, recipe)
