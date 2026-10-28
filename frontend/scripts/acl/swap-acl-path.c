#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* Test-only deterministic replacement at the ACL operation boundary. */
static void swap_path(const char *operation)
{
  const char *requested = getenv("ACL_SWAP_OPERATION");
  if (!requested || strcmp(requested, operation)) return;
  const char *path = getenv("ACL_SWAP_PATH");
  const char *saved = getenv("ACL_SWAP_SAVED");
  const char *victim = getenv("ACL_SWAP_VICTIM");
  const char *marker = getenv("ACL_SWAP_MARKER");
  if (!path || !saved || !victim || !marker)
    _exit(90);
  int fd = open(marker, O_WRONLY | O_CREAT | O_EXCL, 0600);
  if (fd < 0)
    return;
  close(fd);
  const char *kind = getenv("ACL_SWAP_KIND");
  if (rename(path, saved)
      || (kind && !strcmp(kind, "regular") ? rename(victim, path) : symlink(victim, path)))
    _exit(91);
}

int acl_set_file(const char *path, int type, void *acl)
{
  int (*real)(const char *, int, void *) = dlsym(RTLD_NEXT, "acl_set_file");
  if (!real) _exit(92);
  swap_path("set");
  return real(path, type, acl);
}

int acl_set_file_at(int fd, const char *path, int flags, int type, void *acl)
{
  int (*real)(int, const char *, int, int, void *) = dlsym(RTLD_NEXT, "acl_set_file_at");
  if (!real) _exit(93);
  swap_path("set");
  return real(fd, path, flags, type, acl);
}

int acl_delete_def_file(const char *path)
{
  int (*real)(const char *) = dlsym(RTLD_NEXT, "acl_delete_def_file");
  if (!real) _exit(94);
  swap_path("delete");
  return real(path);
}

int acl_delete_def_file_at(int fd, const char *path, int flags)
{
  int (*real)(int, const char *, int) = dlsym(RTLD_NEXT, "acl_delete_def_file_at");
  if (!real) _exit(95);
  swap_path("delete");
  return real(fd, path, flags);
}

#ifndef O_PATH
#define O_PATH 010000000
#endif

int openat(int fd, const char *path, int flags, ...)
{
  mode_t mode = 0;
  int needs_mode = flags & O_CREAT;
#ifdef O_TMPFILE
  needs_mode |= (flags & O_TMPFILE) == O_TMPFILE;
#endif
  if (needs_mode) {
    va_list args;
    va_start(args, flags);
    mode = va_arg(args, int);
    va_end(args);
  }
  const char *basename = getenv("ACL_SWAP_BASENAME");
  if ((flags & O_PATH) && basename && !strcmp(path, basename))
    swap_path("open");
  int (*real)(int, const char *, int, ...) = dlsym(RTLD_NEXT, "openat");
  if (!real) _exit(96);
  return needs_mode ? real(fd, path, flags, mode) : real(fd, path, flags);
}

/* The qualified producer is Linux amd64, where these entry points have the
   same ABI. Cover tar's large-file redirection as well as direct openat. */
#if defined(__linux__) && defined(__x86_64__)
int openat64(int fd, const char *path, int flags, ...)
  __attribute__((alias("openat")));
#endif
