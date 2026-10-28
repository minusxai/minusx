#!/usr/bin/env python3
"""Native tar ACL behavior and deterministic pathname-replacement regression."""
import argparse
import os
import pathlib
import subprocess
import tempfile


def run(*args, env=None):
    return subprocess.check_output(args, text=True, env=env)


def acl(path):
    return run('getfacl', '-cpn', str(path))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tar', required=True)
    parser.add_argument('--expect-vulnerable', action='store_true',
                        help='Negative control: require the historical caller to change the victim')
    args = parser.parse_args()
    tar = str(pathlib.Path(args.tar).resolve())
    helper = pathlib.Path(__file__).with_name('swap-acl-path.c')
    with tempfile.TemporaryDirectory(prefix='tar-acl-regression-') as directory:
        root = pathlib.Path(directory)
        so = root / 'swap.so'
        subprocess.run(['cc', '-Wall', '-Wextra', '-Werror', '-shared', '-fPIC', str(helper), '-ldl', '-o', str(so)], check=True)
        source = root / 'source'
        source.mkdir()
        (source / 'file').write_text('ordinary ACL content\n')
        (source / 'directory').mkdir()
        (source / 'empty-default').mkdir()
        run('setfacl', '-m', 'u:12345:r--', str(source / 'file'))
        run('setfacl', '-m', 'u:12345:r-x,d:u:12345:r-x', str(source / 'directory'))
        run('setfacl', '-m', 'u:12345:r-x', str(source / 'empty-default'))
        archive = root / 'ordinary.tar'
        run(tar, '--acls', '-cf', str(archive), '-C', str(source), 'file', 'directory', 'empty-default')
        output = root / 'ordinary'
        output.mkdir()
        run(tar, '--acls', '-xf', str(archive), '-C', str(output))
        for name in ('file', 'directory', 'empty-default'):
            assert acl(source / name) == acl(output / name), 'Ordinary/default ACL round trip failed'
        (source / 'link').symlink_to('file')
        for dereference in (False, True):
            link_archive = root / ('follow.tar' if dereference else 'link.tar')
            run(tar, '--acls', *(['--dereference'] if dereference else []), '-cf', str(link_archive), '-C', str(source), 'link')
            target = root / ('follow' if dereference else 'link')
            target.mkdir()
            run(tar, '--acls', '-xf', str(link_archive), '-C', str(target))
            assert (target / 'link').is_symlink() != dereference
            if dereference:
                assert acl(target / 'link') == acl(source / 'file')
                assert (target / 'link').read_bytes() == (source / 'file').read_bytes()
        for name in ('file', 'directory', 'empty-default'):
            case = root / ('race-' + name)
            case.mkdir()
            victim = case / 'victim'
            if name != 'file':
                victim.mkdir()
                run('setfacl', '-m', 'u:12346:r--,d:u:12346:r--', str(victim))
            else:
                victim.write_text('untouched victim\n')
                run('setfacl', '-m', 'u:12346:r--', str(victim))
            before = acl(victim)
            one = case / 'input.tar'
            run(tar, '--acls', '-cf', str(one), '-C', str(source), name)
            dest = case / 'out'
            dest.mkdir()
            if name == 'empty-default':
                run('setfacl', '-m', 'd:u:12346:r--', str(dest))
            marker = case / 'swapped'
            saved = case / 'pinned'
            env = dict(os.environ, LD_PRELOAD=str(so), ACL_SWAP_PATH=str(dest / name),
                       ACL_SWAP_SAVED=str(saved), ACL_SWAP_VICTIM=str(victim), ACL_SWAP_MARKER=str(marker),
                       ACL_SWAP_OPERATION='delete' if name == 'empty-default' else 'set')
            run(tar, '--acls', '-xf', str(one), '-C', str(dest), env=env)
            assert marker.exists() and (dest / name).is_symlink(), 'Race injector did not execute'
            changed = acl(victim) != before
            assert changed == args.expect_vulnerable, 'Unexpected symlink replacement safety result'
            if not args.expect_vulnerable:
                assert acl(saved) == acl(source / name), 'Pinned object lost its ACL'
        if not args.expect_vulnerable:
            creation = root / 'creation'
            creation.mkdir()
            (creation / 'source').write_text('source content\n')
            (creation / 'replacement').write_text('replacement content\n')
            run('setfacl', '-m', 'u:12345:r--', str(creation / 'source'))
            run('setfacl', '-m', 'u:12346:r--', str(creation / 'replacement'))
            marker = creation / 'swapped'
            env = dict(os.environ, LC_ALL='C', LD_PRELOAD=str(so), ACL_SWAP_OPERATION='open',
                       ACL_SWAP_BASENAME='source', ACL_SWAP_KIND='regular',
                       ACL_SWAP_PATH=str(creation / 'source'), ACL_SWAP_SAVED=str(creation / 'pinned'),
                       ACL_SWAP_VICTIM=str(creation / 'replacement'), ACL_SWAP_MARKER=str(marker))
            result = subprocess.run([tar, '--acls', '-cf', str(creation / 'race.tar'), '-C', str(creation), 'source'],
                                    text=True, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            assert marker.exists(), 'Creation stat/open replacement injector did not execute'
            assert 'Stale file handle' in result.stderr, 'Creation replacement was not rejected as stale'
            restored = creation / 'restored'
            restored.mkdir()
            run(tar, '--acls', '-xf', str(creation / 'race.tar'), '-C', str(restored))
            assert 'user:12346:' not in acl(restored / 'source'), 'Replacement ACL leaked into archive'
        print('PASS: ordinary/default ACLs, symlink preservation, explicit dereference, file/directory deterministic swap ' + ('historical negative' if args.expect_vulnerable else 'victim protection'))


if __name__ == '__main__':
    main()
