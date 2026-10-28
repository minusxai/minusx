/* config.h.  Generated from config.h.in by configure.  */
/* config.h.in.  Generated from configure.ac by autoheader.  */

/* Enable agetty --reload feature */
#define AGETTY_RELOAD 1

/* Should chfn and chsh require the user to enter the password? */
#define CHFN_CHSH_PASSWORD 1

/* Path to hwclock adjtime file */
#define CONFIG_ADJTIME_PATH "/etc/adjtime"

/* NTFS mounttype */
/* #undef CONFIG_UL_NTFS_MOUNTTYPE */

/* Define if cryptsetup is to be loaded via dlopen */
#define CRYPTSETUP_VIA_DLOPEN 1

/* Define to 1 if translation of program messages to the user's native
   language is requested. */
#define ENABLE_NLS 1

/* search path for fs helpers */
#define FS_SEARCH_PATH "/sbin:/sbin/fs.d:/sbin/fs"

/* Define to 1 if you have the <asm/io.h> header file. */
/* #undef HAVE_ASM_IO_H */

/* Define if btrfs stuff is available */
#define HAVE_BTRFS_SUPPORT 1

/* Define to 1 if you have the <byteswap.h> header file. */
#define HAVE_BYTESWAP_H 1

/* Define to 1 if you have the 'cachestat' function. */
/* #undef HAVE_CACHESTAT */

/* Define to 1 if you have the Mac OS X function CFLocaleCopyCurrent in the
   CoreFoundation framework. */
/* #undef HAVE_CFLOCALECOPYCURRENT */

/* Define to 1 if you have the Mac OS X function CFPreferencesCopyAppValue in
   the CoreFoundation framework. */
/* #undef HAVE_CFPREFERENCESCOPYAPPVALUE */

/* Define to 1 if you have the 'clearenv' function. */
#define HAVE_CLEARENV 1

/* Define to 1 if you have the 'clock_gettime' function. */
#define HAVE_CLOCK_GETTIME 1

/* Define to 1 if you have the 'close_range' function. */
#define HAVE_CLOSE_RANGE 1

/* Define to 1 if you have the 'copy_file_range' function. */
#define HAVE_COPY_FILE_RANGE 1

/* Define to 1 if the system has the type 'cpu_set_t'. */
#define HAVE_CPU_SET_T 1

/* Define if cryptsetup is available */
#define HAVE_CRYPTSETUP 1

/* Define if crypt_activate_by_signed_key exist in -lcryptsetup */
#define HAVE_CRYPT_ACTIVATE_BY_SIGNED_KEY 1

/* Define to 1 if you have the <crypt.h> header file. */
#define HAVE_CRYPT_H 1

/* Define if the GNU dcgettext() function is already present or preinstalled.
   */
#define HAVE_DCGETTEXT 1

/* Define to 1 if you have the declaration of 'BLK_ZONE_REP_CAPACITY', and to
   0 if you don't. */
#define HAVE_DECL_BLK_ZONE_REP_CAPACITY 1

/* Define to 1 if you have the declaration of 'CPU_ALLOC', and to 0 if you
   don't. */
#define HAVE_DECL_CPU_ALLOC 1

/* Define to 1 if you have the declaration of 'dirfd', and to 0 if you don't.
   */
/* #undef HAVE_DECL_DIRFD */

/* Define to 1 if you have the declaration of 'PR_REP_CAPACITY', and to 0 if
   you don't. */
#define HAVE_DECL_PR_REP_CAPACITY 0

/* Define to 1 if you have the declaration of 'sd_device_new_from_devname',
   and to 0 if you don't. */
#define HAVE_DECL_SD_DEVICE_NEW_FROM_DEVNAME 1

/* Define to 1 if you have the declaration of 'sd_device_new_from_syspath',
   and to 0 if you don't. */
#define HAVE_DECL_SD_DEVICE_NEW_FROM_SYSPATH 1

/* Define to 1 if you have the declaration of 'sd_device_open', and to 0 if
   you don't. */
#define HAVE_DECL_SD_DEVICE_OPEN 1

/* Define to 1 if you have the declaration of 'sd_session_get_username', and
   to 0 if you don't. */
#define HAVE_DECL_SD_SESSION_GET_USERNAME 1

/* Define to 1 if you have the declaration of 'tzname', and to 0 if you don't.
   */
/* #undef HAVE_DECL_TZNAME */

/* Define to 1 if you have the declaration of 'VMADDR_CID_LOCAL', and to 0 if
   you don't. */
#define HAVE_DECL_VMADDR_CID_LOCAL 1

/* Define to 1 if you have the declaration of '_NL_TIME_WEEK_1STDAY', and to 0
   if you don't. */
#define HAVE_DECL__NL_TIME_WEEK_1STDAY 1

/* Define to 1 if you have the 'dirfd' function. */
#define HAVE_DIRFD 1

/* Define to 1 if 'dd_fd' is a member of 'DIR'. */
/* #undef HAVE_DIR_DD_FD */

/* Define to 1 if you have the <dlfcn.h> header file. */
#define HAVE_DLFCN_H 1

/* Define to 1 if you have the 'eaccess' function. */
#define HAVE_EACCESS 1

/* Define if econf_readConfig exist in -leconf */
/* #undef HAVE_ECONF_READCONFIG */

/* Define to 1 if you have the <endian.h> header file. */
#define HAVE_ENDIAN_H 1

/* Define to 1 if the system has the type 'enum fsconfig_command'. */
#define HAVE_ENUM_FSCONFIG_COMMAND 1

/* Define to 1 if have **environ prototype */
#define HAVE_ENVIRON_DECL 1

/* Define to 1 if you have the 'err' function. */
#define HAVE_ERR 1

/* Define to 1 if you have the <errno.h> header file. */
#define HAVE_ERRNO_H 1

/* Define to 1 if you have the 'errx' function. */
#define HAVE_ERRX 1

/* Define to 1 if you have the <err.h> header file. */
#define HAVE_ERR_H 1

/* Define to 1 if you have the 'explicit_bzero' function. */
#define HAVE_EXPLICIT_BZERO 1

/* Define to 1 if you have the 'fallocate' function. */
#define HAVE_FALLOCATE 1

/* Define to 1 if you have the <fcntl.h> header file. */
#define HAVE_FCNTL_H 1

/* Define to 1 if you have the 'fnmatch' function. */
#define HAVE_FNMATCH 1

/* Define to 1 if you have the 'fpurge' function. */
/* #undef HAVE_FPURGE */

/* Define to 1 if you have the 'fsconfig' function. */
#define HAVE_FSCONFIG 1

/* Define to 1 if fseeko (and ftello) are declared in stdio.h. */
#define HAVE_FSEEKO 1

/* Define to 1 if you have the 'fsmount' function. */
#define HAVE_FSMOUNT 1

/* Define to 1 if you have the 'fsopen' function. */
#define HAVE_FSOPEN 1

/* Define to 1 if you have the 'fspick' function. */
#define HAVE_FSPICK 1

/* Define to 1 if you have the 'fstatat' function. */
#define HAVE_FSTATAT 1

/* Define to 1 if you have the 'fsync' function. */
#define HAVE_FSYNC 1

/* Define to 1 if you have the 'fts_open' function. */
#define HAVE_FTS_OPEN 1

/* Define to 1 if you have the 'futimens' function. */
#define HAVE_FUTIMENS 1

/* Define to 1 if you have the 'getauxval' function. */
#define HAVE_GETAUXVAL 1

/* Define to 1 if you have the 'getdomainname' function. */
#define HAVE_GETDOMAINNAME 1

/* Define to 1 if you have the 'getdtablesize' function. */
#define HAVE_GETDTABLESIZE 1

/* Define to 1 if you have the 'getexecname' function. */
/* #undef HAVE_GETEXECNAME */

/* Define to 1 if you have the 'getmntinfo' function. */
/* #undef HAVE_GETMNTINFO */

/* Define to 1 if you have the <getopt.h> header file. */
#define HAVE_GETOPT_H 1

/* Define to 1 if you have the 'getrandom' function. */
#define HAVE_GETRANDOM 1

/* Define to 1 if you have the 'getrlimit' function. */
#define HAVE_GETRLIMIT 1

/* Define to 1 if you have the 'getsgnam' function. */
#define HAVE_GETSGNAM 1

/* Define if the GNU gettext() function is already present or preinstalled. */
#define HAVE_GETTEXT 1

/* Define to 1 if you have the 'getttynam' function. */
#define HAVE_GETTTYNAM 1

/* Define to 1 if you have the 'getusershell' function. */
#define HAVE_GETUSERSHELL 1

/* Define if you have the iconv() function and it works. */
/* #undef HAVE_ICONV */

/* Define to 1 if you have the 'inotify_init' function. */
#define HAVE_INOTIFY_INIT 1

/* Define to 1 if you have the 'inotify_init1' function. */
#define HAVE_INOTIFY_INIT1 1

/* Define to 1 if you have the <inttypes.h> header file. */
#define HAVE_INTTYPES_H 1

/* Define to 1 if you have the 'ioperm' function. */
#define HAVE_IOPERM 1

/* Define to 1 if you have the 'iopl' function. */
#define HAVE_IOPL 1

/* Define to 1 if you have the 'isnan' function. */
#define HAVE_ISNAN 1

/* Define to 1 if you have the 'jrand48' function. */
#define HAVE_JRAND48 1

/* Define to 1 if you have the 'landlock_add_rule' function. */
/* #undef HAVE_LANDLOCK_ADD_RULE */

/* Define to 1 if you have the 'landlock_create_ruleset' function. */
/* #undef HAVE_LANDLOCK_CREATE_RULESET */

/* Define to 1 if you have the 'landlock_restrict_self' function. */
/* #undef HAVE_LANDLOCK_RESTRICT_SELF */

/* Define if langinfo.h defines ALTMON_x constants */
#define HAVE_LANGINFO_ALTMON 1

/* Define to 1 if you have the <langinfo.h> header file. */
#define HAVE_LANGINFO_H 1

/* Define if langinfo.h defines _NL_ABALTMON_x constants */
#define HAVE_LANGINFO_NL_ABALTMON 1

/* Define to 1 if you have the <lastlog.h> header file. */
#define HAVE_LASTLOG_H 1

/* Define to 1 if you have the 'lchown' function. */
#define HAVE_LCHOWN 1

/* Define to 1 if you have the 'lgetxattr' function. */
#define HAVE_LGETXATTR 1

/* Define to 1 if you have the 'audit' library (-laudit). */
#define HAVE_LIBAUDIT 1

/* Define to 1 if you have the -lblkid. */
#define HAVE_LIBBLKID 1

/* Define to 1 if you have the 'cap-ng' library (-lcap-ng). */
#define HAVE_LIBCAP_NG 1

/* Define if libeconf is available */
/* #undef HAVE_LIBECONF */

/* Define to 1 if you have the -llastlog2. */
#define HAVE_LIBLASTLOG2 1

/* Define if libmount available. */
#define HAVE_LIBMOUNT 1

/* Define if ncurses library available */
/* #undef HAVE_LIBNCURSES */

/* Define if ncursesw library available */
#define HAVE_LIBNCURSESW 1

/* Define if libpthred exist */
#define HAVE_LIBPTHREAD 1

/* Define to 1 if you have the 'readline' library (-lreadline). */
#define HAVE_LIBREADLINE 1

/* Define if librtas exists */
/* #undef HAVE_LIBRTAS */

/* Define if SELinux is available */
#define HAVE_LIBSELINUX 1

/* Define if libsystemd is available */
#define HAVE_LIBSYSTEMD 1

/* Define if libtinfo or libtinfow available. */
#define HAVE_LIBTINFO 1

/* Define to 1 if you have the 'udev' library (-ludev). */
#define HAVE_LIBUDEV 1

/* Define if libuser is available */
/* #undef HAVE_LIBUSER */

/* Define to 1 if you have the 'utempter' library (-lutempter). */
/* #undef HAVE_LIBUTEMPTER */

/* Define to 1 if you have the 'util' library (-lutil). */
#define HAVE_LIBUTIL 1

/* Define to 1 if you have the <libutil.h> header file. */
/* #undef HAVE_LIBUTIL_H */

/* Define to 1 if you have the -luuid. */
#define HAVE_LIBUUID 1

/* Define to 1 if you have the <linux/audit.h> header file. */
#define HAVE_LINUX_AUDIT_H 1

/* Define to 1 if you have the <linux/blkpg.h> header file. */
#define HAVE_LINUX_BLKPG_H 1

/* Define to 1 if you have the <linux/blkzoned.h> header file. */
#define HAVE_LINUX_BLKZONED_H 1

/* Define to 1 if you have the <linux/bpf.h> header file. */
#define HAVE_LINUX_BPF_H 1

/* Define to 1 if you have the <linux/btrfs.h> header file. */
#define HAVE_LINUX_BTRFS_H 1

/* Define to 1 if you have the <linux/capability.h> header file. */
#define HAVE_LINUX_CAPABILITY_H 1

/* Define to 1 if you have the <linux/cdrom.h> header file. */
#define HAVE_LINUX_CDROM_H 1

/* Define to 1 if you have the <linux/compiler.h> header file. */
/* #undef HAVE_LINUX_COMPILER_H */

/* Define to 1 if you have the <linux/falloc.h> header file. */
#define HAVE_LINUX_FALLOC_H 1

/* Define to 1 if you have the <linux/fd.h> header file. */
#define HAVE_LINUX_FD_H 1

/* Define to 1 if you have the <linux/fiemap.h> header file. */
#define HAVE_LINUX_FIEMAP_H 1

/* Define to 1 if you have the <linux/fs.h> header file. */
#define HAVE_LINUX_FS_H 1

/* Define to 1 if you have the <linux/gsmmux.h> header file. */
#define HAVE_LINUX_GSMMUX_H 1

/* Define to 1 if you have the <linux/kcmp.h> header file. */
#define HAVE_LINUX_KCMP_H 1

/* Define to 1 if you have the <linux/landlock.h> header file. */
#define HAVE_LINUX_LANDLOCK_H 1

/* Define to 1 if you have the <linux/major.h> header file. */
#define HAVE_LINUX_MAJOR_H 1

/* Define to 1 if you have the <linux/mount.h> header file. */
#define HAVE_LINUX_MOUNT_H 1

/* Define to 1 if you have the <linux/net_namespace.h> header file. */
#define HAVE_LINUX_NET_NAMESPACE_H 1

/* Define to 1 if you have the <linux/nsfs.h> header file. */
#define HAVE_LINUX_NSFS_H 1

/* Define to 1 if you have the <linux/openat2.h> header file. */
#define HAVE_LINUX_OPENAT2_H 1

/* Define to 1 if you have the <linux/pr.h> header file. */
#define HAVE_LINUX_PR_H 1

/* Define to 1 if you have the <linux/raw.h> header file. */
/* #undef HAVE_LINUX_RAW_H */

/* Define to 1 if you have the <linux/seccomp.h> header file. */
#define HAVE_LINUX_SECCOMP_H 1

/* Define to 1 if you have the <linux/securebits.h> header file. */
#define HAVE_LINUX_SECUREBITS_H 1

/* Define to 1 if you have the <linux/tiocl.h> header file. */
#define HAVE_LINUX_TIOCL_H 1

/* Define to 1 if you have the <linux/version.h> header file. */
#define HAVE_LINUX_VERSION_H 1

/* Define to 1 if you have the <linux/vm_sockets_diag.h> header file. */
#define HAVE_LINUX_VM_SOCKETS_DIAG_H 1

/* Define to 1 if you have the <linux/watchdog.h> header file. */
#define HAVE_LINUX_WATCHDOG_H 1

/* Define to 1 if you have the 'llistxattr' function. */
#define HAVE_LLISTXATTR 1

/* Define to 1 if you have the 'llseek' function. */
/* #undef HAVE_LLSEEK */

/* Define to 1 if you have the <locale.h> header file. */
#define HAVE_LOCALE_H 1

/* Define to 1 if the system has the type 'loff_t'. */
#define HAVE_LOFF_T 1

/* Define to 1 if you have the libmagic present. */
/* #undef HAVE_MAGIC */

/* Define to 1 if you have the 'mempcpy' function. */
#define HAVE_MEMPCPY 1

/* Define to 1 if you have the <minix/config.h> header file. */
/* #undef HAVE_MINIX_CONFIG_H */

/* Define to 1 if you have the 'mkostemp' function. */
#define HAVE_MKOSTEMP 1

/* Define to 1 if you have the <mntent.h> header file. */
#define HAVE_MNTENT_H 1

/* Define to 1 if you want to use mount API based on FDs. */
#define HAVE_MOUNTFD_API 1

/* Define to 1 if you have the 'mount_setattr' function. */
#define HAVE_MOUNT_SETATTR 1

/* Define to 1 if you have the 'move_mount' function. */
#define HAVE_MOVE_MOUNT 1

/* Define to 1 if you have the <mqueue.h> header file. */
#define HAVE_MQUEUE_H 1

/* Define to 1 if you have the 'nanosleep' function. */
#define HAVE_NANOSLEEP 1

/* Define to 1 if you have the <ncursesw/ncurses.h> header file. */
#define HAVE_NCURSESW_NCURSES_H 1

/* Define to 1 if you have the <ncursesw/term.h> header file. */
#define HAVE_NCURSESW_TERM_H 1

/* Define to 1 if you have the <ncurses.h> header file. */
/* #undef HAVE_NCURSES_H */

/* Define to 1 if you have the <ncurses/ncurses.h> header file. */
/* #undef HAVE_NCURSES_NCURSES_H */

/* Define to 1 if you have the <ncurses/term.h> header file. */
/* #undef HAVE_NCURSES_TERM_H */

/* Define to 1 if you have the <netinet/in.h> header file. */
#define HAVE_NETINET_IN_H 1

/* Define to 1 if you have the <net/if_dl.h> header file. */
/* #undef HAVE_NET_IF_DL_H */

/* Define to 1 if you have the <net/if.h> header file. */
#define HAVE_NET_IF_H 1

/* Define to 1 if you have the 'newlocale' function. */
#define HAVE_NEWLOCALE 1

/* Define to 1 if you have the 'ntp_gettime' function. */
#define HAVE_NTP_GETTIME 1

/* Define to 1 if OPAL status ioctl is defined */
#define HAVE_OPAL_GET_STATUS 1

/* Define to 1 if you have the 'openat' function. */
#define HAVE_OPENAT 1

/* Define to 1 if you have the 'open_memstream' function. */
#define HAVE_OPEN_MEMSTREAM 1

/* Define to 1 if you have the 'open_tree' function. */
#define HAVE_OPEN_TREE 1

/* Define to 1 if you have the <paths.h> header file. */
#define HAVE_PATHS_H 1

/* Define to 1 if you have the 'personality' function. */
#define HAVE_PERSONALITY 1

/* Define to 1 if you have the 'pidfd_getfd' function. */
#define HAVE_PIDFD_GETFD 1

/* Define to 1 if you have the 'pidfd_open' function. */
#define HAVE_PIDFD_OPEN 1

/* Define to 1 if you have the 'pidfd_send_signal' function. */
#define HAVE_PIDFD_SEND_SIGNAL 1

/* Define to 1 if you have the 'posix_fadvise' function. */
#define HAVE_POSIX_FADVISE 1

/* Define to 1 if you have the 'posix_fallocate' function. */
#define HAVE_POSIX_FALLOCATE 1

/* Define to 1 if you have the 'prctl' function. */
#define HAVE_PRCTL 1

/* Have valid prlimit() function */
#define HAVE_PRLIMIT 1

/* Define if program_invocation_short_name is defined */
#define HAVE_PROGRAM_INVOCATION_SHORT_NAME 1

/* have PTY support */
#define HAVE_PTY 1

/* Define to 1 if you have the <pty.h> header file. */
#define HAVE_PTY_H 1

/* Define to 1 if you have the 'qsort_r' function. */
#define HAVE_QSORT_R 1

/* Define to 1 if you have the 'reallocarray' function. */
#define HAVE_REALLOCARRAY 1

/* Define to 1 if you have the 'reboot' function. */
#define HAVE_REBOOT 1

/* Define to 1 if you have the 'renameat2' function. */
#define HAVE_RENAMEAT2 1

/* Define if curses library has the resizeterm(). */
#define HAVE_RESIZETERM 1

/* Define to 1 if you have the 'rpmatch' function. */
#define HAVE_RPMATCH 1

/* Define if struct sockaddr contains sa_len */
/* #undef HAVE_SA_LEN */

/* Define to 1 if you have the 'scandirat' function. */
#define HAVE_SCANDIRAT 1

/* Define to 1 if you have the 'sched_setattr' function. */
#define HAVE_SCHED_SETATTR 1

/* Define to 1 if you have the 'sched_setscheduler' function. */
#define HAVE_SCHED_SETSCHEDULER 1

/* Define to 1 if you have the 'secure_getenv' function. */
#define HAVE_SECURE_GETENV 1

/* Define to 1 if you have the 'security_get_initial_context' function. */
#define HAVE_SECURITY_GET_INITIAL_CONTEXT 1

/* Define to 1 if you have the <security/openpam.h> header file. */
/* #undef HAVE_SECURITY_OPENPAM_H */

/* Define to 1 if you have the <security/pam_appl.h> header file. */
#define HAVE_SECURITY_PAM_APPL_H 1

/* Define to 1 if you have the <security/pam_misc.h> header file. */
#define HAVE_SECURITY_PAM_MISC_H 1

/* Define to 1 if you have the <security/pam_modules.h> header file. */
#define HAVE_SECURITY_PAM_MODULES_H 1

/* Define to 1 if you have the <semaphore.h> header file. */
#define HAVE_SEMAPHORE_H 1

/* Define to 1 if you have the 'sem_close' function. */
#define HAVE_SEM_CLOSE 1

/* Define to 1 if you have the 'sendfile' function. */
#define HAVE_SENDFILE 1

/* Define to 1 if you have the 'setitimer' function. */
/* #undef HAVE_SETITIMER */

/* Have valid setns() function */
#define HAVE_SETNS 1

/* Define to 1 if you have the 'setprogname' function. */
/* #undef HAVE_SETPROGNAME */

/* Define to 1 if you have the 'setresgid' function. */
#define HAVE_SETRESGID 1

/* Define to 1 if you have the 'setresuid' function. */
#define HAVE_SETRESUID 1

/* Define to 1 if you have the <shadow.h> header file. */
#define HAVE_SHADOW_H 1

/* Define to 1 if you have the 'shm_open' function. */
#define HAVE_SHM_OPEN 1

/* Define to 1 if the system has the type 'sighandler_t'. */
#define HAVE_SIGHANDLER_T 1

/* Define to 1 if you have the 'sigqueue' function. */
#define HAVE_SIGQUEUE 1

/* Define to 1 if the system has the type 'sigset_t'. */
#define HAVE_SIGSET_T 1

/* Define to 1 if you have the <slang.h> header file. */
/* #undef HAVE_SLANG_H */

/* Define to 1 if you have the <slang/slang.h> header file. */
/* #undef HAVE_SLANG_SLANG_H */

/* Define to 1 if you have the <slang/slcurses.h> header file. */
/* #undef HAVE_SLANG_SLCURSES_H */

/* Define to 1 if you have the <slcurses.h> header file. */
/* #undef HAVE_SLCURSES_H */

/* Add SMACK support */
#define HAVE_SMACK 1

/* Define to 1 if you have the 'srandom' function. */
#define HAVE_SRANDOM 1

/* Define to 1 if you want to use statmount API. */
#define HAVE_STATMOUNT_API 1

/* Define to 1 if you have the 'statx' function. */
#define HAVE_STATX 1

/* Define to 1 if you have the <stdint.h> header file. */
#define HAVE_STDINT_H 1

/* Define to 1 if you have the <stdio_ext.h> header file. */
#define HAVE_STDIO_EXT_H 1

/* Define to 1 if you have the <stdio.h> header file. */
#define HAVE_STDIO_H 1

/* Define to 1 if you have the <stdlib.h> header file. */
#define HAVE_STDLIB_H 1

/* Define to 1 if you have the <strings.h> header file. */
#define HAVE_STRINGS_H 1

/* Define to 1 if you have the <string.h> header file. */
#define HAVE_STRING_H 1

/* Define to 1 if you have the 'strnchr' function. */
/* #undef HAVE_STRNCHR */

/* Define to 1 if you have the 'strndup' function. */
#define HAVE_STRNDUP 1

/* Define to 1 if you have the 'strnlen' function. */
#define HAVE_STRNLEN 1

/* Define to 1 if have strsignal function prototype */
#define HAVE_STRSIGNAL_DECL 1

/* Define to 1 if you have the 'strtod_l' function. */
#define HAVE_STRTOD_L 1

/* Define to 1 if the system has the type 'struct fanotify_event_info_header'.
   */
#define HAVE_STRUCT_FANOTIFY_EVENT_INFO_HEADER 1

/* Define to 1 if the system has the type 'struct mount_attr'. */
#define HAVE_STRUCT_MOUNT_ATTR 1

/* Define to 1 if the system has the type 'struct nsfs_file_handle'. */
#define HAVE_STRUCT_NSFS_FILE_HANDLE 1

/* Define to 1 if the system has the type 'struct statx'. */
#define HAVE_STRUCT_STATX 1

/* Define to 1 if 'stx_mnt_id' is a member of 'struct statx'. */
#define HAVE_STRUCT_STATX_STX_MNT_ID 1

/* Define to 1 if 'st_mtim.tv_nsec' is a member of 'struct stat'. */
#define HAVE_STRUCT_STAT_ST_MTIM_TV_NSEC 1

/* Define to 1 if 'c_line' is a member of 'struct termios'. */
#define HAVE_STRUCT_TERMIOS_C_LINE 1

/* Define to 1 if 'tm_zone' is a member of 'struct tm'. */
#define HAVE_STRUCT_TM_TM_ZONE 1

/* Define to 1 if you have the 'swapoff' function. */
#define HAVE_SWAPOFF 1

/* Define to 1 if you have the 'swapon' function. */
#define HAVE_SWAPON 1

/* Define to 1 if you have the 'sysconf' function. */
#define HAVE_SYSCONF 1

/* Define to 1 if you have the 'sysinfo' function. */
#define HAVE_SYSINFO 1

/* Define to 1 if you have the <sys/auxv.h> header file. */
#define HAVE_SYS_AUXV_H 1

/* Define to 1 if you have the <sys/disklabel.h> header file. */
/* #undef HAVE_SYS_DISKLABEL_H */

/* Define to 1 if you have the <sys/disk.h> header file. */
/* #undef HAVE_SYS_DISK_H */

/* Define to 1 if you have the <sys/endian.h> header file. */
/* #undef HAVE_SYS_ENDIAN_H */

/* Define to 1 if you have the <sys/file.h> header file. */
#define HAVE_SYS_FILE_H 1

/* Define to 1 if you have the <sys/ioccom.h> header file. */
/* #undef HAVE_SYS_IOCCOM_H */

/* Define to 1 if you have the <sys/ioctl.h> header file. */
#define HAVE_SYS_IOCTL_H 1

/* Define to 1 if you have the <sys/io.h> header file. */
#define HAVE_SYS_IO_H 1

/* Define to 1 if you have the <sys/mkdev.h> header file. */
/* #undef HAVE_SYS_MKDEV_H */

/* Define to 1 if you have the <sys/mman.h> header file. */
#define HAVE_SYS_MMAN_H 1

/* Define to 1 if you have the <sys/mount.h> header file. */
#define HAVE_SYS_MOUNT_H 1

/* Define to 1 if you have the <sys/param.h> header file. */
#define HAVE_SYS_PARAM_H 1

/* Define to 1 if you have the <sys/pidfd.h> header file. */
#define HAVE_SYS_PIDFD_H 1

/* Define to 1 if you have the <sys/prctl.h> header file. */
#define HAVE_SYS_PRCTL_H 1

/* Define to 1 if you have the <sys/resource.h> header file. */
#define HAVE_SYS_RESOURCE_H 1

/* Define to 1 if you have the <sys/sendfile.h> header file. */
#define HAVE_SYS_SENDFILE_H 1

/* Define to 1 if you have the <sys/signalfd.h> header file. */
#define HAVE_SYS_SIGNALFD_H 1

/* Define to 1 if you have the <sys/socket.h> header file. */
#define HAVE_SYS_SOCKET_H 1

/* Define to 1 if you have the <sys/sockio.h> header file. */
/* #undef HAVE_SYS_SOCKIO_H */

/* Define to 1 if you have the <sys/statfs.h> header file. */
#define HAVE_SYS_STATFS_H 1

/* Define to 1 if you have the <sys/stat.h> header file. */
#define HAVE_SYS_STAT_H 1

/* Define to 1 if you have the <sys/swap.h> header file. */
#define HAVE_SYS_SWAP_H 1

/* Define to 1 if you have the <sys/syscall.h> header file. */
#define HAVE_SYS_SYSCALL_H 1

/* Define to 1 if you have the <sys/sysmacros.h> header file. */
#define HAVE_SYS_SYSMACROS_H 1

/* Define to 1 if you have the <sys/timex.h> header file. */
#define HAVE_SYS_TIMEX_H 1

/* Define to 1 if you have the <sys/time.h> header file. */
#define HAVE_SYS_TIME_H 1

/* Define to 1 if you have the <sys/ttydefaults.h> header file. */
#define HAVE_SYS_TTYDEFAULTS_H 1

/* Define to 1 if you have the <sys/types.h> header file. */
#define HAVE_SYS_TYPES_H 1

/* Define to 1 if you have the <sys/ucred.h> header file. */
/* #undef HAVE_SYS_UCRED_H */

/* Define to 1 if you have the <sys/un.h> header file. */
#define HAVE_SYS_UN_H 1

/* Define to 1 if you have the <sys/vfs.h> header file. */
#define HAVE_SYS_VFS_H 1

/* Define to 1 if you have the <sys/xattr.h> header file. */
#define HAVE_SYS_XATTR_H 1

/* Define to 1 if you have the <term.h> header file. */
/* #undef HAVE_TERM_H */

/* Define to 1 if you have the 'timegm' function. */
#define HAVE_TIMEGM 1

/* Define if timer_create exist in -lrt -lpthread */
#define HAVE_TIMER_CREATE 1

/* Define to 1 if the target supports thread-local storage. */
#define HAVE_TLS 1

/* Does struct tm have a field tm_gmtoff? */
#define HAVE_TM_GMTOFF 1

/* Define to 1 if your 'struct tm' has 'tm_zone'. Deprecated, use
   'HAVE_STRUCT_TM_TM_ZONE' instead. */
#define HAVE_TM_ZONE 1

/* Define to 1 if you don't have 'tm_zone' but do have the external array
   'tzname'. */
/* #undef HAVE_TZNAME */

/* Define to 1 if the system has the type 'union semun'. */
/* #undef HAVE_UNION_SEMUN */

/* Define to 1 if you have the <unistd.h> header file. */
#define HAVE_UNISTD_H 1

/* Define to 1 if you have the 'unlinkat' function. */
#define HAVE_UNLINKAT 1

/* Have valid unshare() function */
#define HAVE_UNSHARE 1

/* Define to 1 if you have the 'updwtmpx' function. */
#define HAVE_UPDWTMPX 1

/* Define to 1 if you have the 'uselocale' function. */
#define HAVE_USELOCALE 1

/* Define if curses library has the use_default_colors(). */
#define HAVE_USE_DEFAULT_COLORS 1

/* Define to 1 if you have the 'usleep' function. */
#define HAVE_USLEEP 1

/* Define to 1 if you have the 'utimensat' function. */
#define HAVE_UTIMENSAT 1

/* Define to 1 if you have the <utmpx.h> header file. */
#define HAVE_UTMPX_H 1

/* Define to 1 if you have the <utmp.h> header file. */
#define HAVE_UTMP_H 1

/* Define to 1 if you want to use uuid daemon. */
#define HAVE_UUIDD 1

/* Define to 1 if you have the 'vwarnx' function. */
#define HAVE_VWARNX 1

/* Define if curses library has the vw_printw(). */
#define HAVE_VW_PRINTW 1

/* Define to 1 if you have the 'warn' function. */
#define HAVE_WARN 1

/* Define to 1 if you have the 'warnx' function. */
#define HAVE_WARNX 1

/* Define to 1 if you have the <wchar.h> header file. */
#define HAVE_WCHAR_H 1

/* Do we have wide character support? */
#define HAVE_WIDECHAR 1

/* Define to 1 if you have the '__fpending' function. */
#define HAVE___FPENDING 1

/* Define to 1 if you have the '__fpurge' function. */
#define HAVE___FPURGE 1

/* Define if __progname is defined */
#define HAVE___PROGNAME 1

/* Define to 1 if you have the '__secure_getenv' function. */
/* #undef HAVE___SECURE_GETENV */

/* Should login chown /dev/vcsN? */
/* #undef LOGIN_CHOWN_VCS */

/* Should login stat() the mailbox? */
/* #undef LOGIN_STAT_MAIL */

/* Define to the sub-directory where libtool stores uninstalled libraries. */
#define LT_OBJDIR ".libs/"

/* "Multi-arch triplet for whereis library search path" */
#define MULTIARCHTRIPLET "x86_64-linux-gnu"

/* Define to 1 if assertions should be disabled. */
/* #undef NDEBUG */

/* Should chsh allow only shells in /etc/shells? */
#define ONLY_LISTED_SHELLS 1

/* Name of package */
#define PACKAGE "util-linux"

/* Define to the address where bug reports for this package should be sent. */
#define PACKAGE_BUGREPORT "kzak@redhat.com"

/* Define to the full name of this package. */
#define PACKAGE_NAME "util-linux"

/* Define to the full name and version of this package. */
#define PACKAGE_STRING "util-linux 2.42.2"

/* Define to the one symbol short name of this package. */
#define PACKAGE_TARNAME "util-linux"

/* Define to the home page for this package. */
#define PACKAGE_URL "https://www.kernel.org/pub/linux/utils/util-linux/"

/* Define to the version of this package. */
#define PACKAGE_VERSION "2.42.2"

/* Should pg ring the bell on invalid keys? */
#define PG_BELL 1

/* Define to 1 if all of the C89 standard headers exist (not just the ones
   required in a freestanding environment). This macro is provided for
   backward compatibility; new code need not use it. */
#define STDC_HEADERS 1

/* Fallback syscall number for close_range */
/* #undef SYS_close_range */

/* Fallback syscall number for copy_file_range */
/* #undef SYS_copy_file_range */

/* Fallback syscall number for fsconfig */
/* #undef SYS_fsconfig */

/* Fallback syscall number for fsmount */
/* #undef SYS_fsmount */

/* Fallback syscall number for fsopen */
/* #undef SYS_fsopen */

/* Fallback syscall number for fspick */
/* #undef SYS_fspick */

/* Fallback syscall number for ioprio_get */
/* #undef SYS_ioprio_get */

/* Fallback syscall number for ioprio_set */
/* #undef SYS_ioprio_set */

/* Fallback syscall number for listmount */
/* #undef SYS_listmount */

/* Fallback syscall number for mount_setattr */
/* #undef SYS_mount_setattr */

/* Fallback syscall number for move_mount */
/* #undef SYS_move_mount */

/* Fallback syscall number for open_tree */
/* #undef SYS_open_tree */

/* Fallback syscall number for pidfd_getfd */
/* #undef SYS_pidfd_getfd */

/* Fallback syscall number for pidfd_open */
/* #undef SYS_pidfd_open */

/* Fallback syscall number for pidfd_send_signal */
/* #undef SYS_pidfd_send_signal */

/* Fallback syscall number for pivot_root */
/* #undef SYS_pivot_root */

/* Fallback syscall number for prctl */
/* #undef SYS_prctl */

/* Fallback syscall number for prlimit64 */
/* #undef SYS_prlimit64 */

/* Fallback syscall number for renameat2 */
/* #undef SYS_renameat2 */

/* Fallback syscall number for sched_getaffinity */
/* #undef SYS_sched_getaffinity */

/* Fallback syscall number for sched_setattr */
/* #undef SYS_sched_setattr */

/* Fallback syscall number for setns */
/* #undef SYS_setns */

/* Fallback syscall number for statmount */
/* #undef SYS_statmount */

/* Fallback syscall number for swapoff */
/* #undef SYS_swapoff */

/* Fallback syscall number for swapon */
/* #undef SYS_swapon */

/* Fallback syscall number for unshare */
/* #undef SYS_unshare */

/* Define to 1 if your <sys/time.h> declares 'struct tm'. */
/* #undef TM_IN_SYS_TIME */

/* Enables colorized output from utils by default */
#define USE_COLORS_BY_DEFAULT 1

/* Define to 1 if want to use CMOS clock. */
#define USE_HWCLOCK_CMOS 1

/* use datetime parsing GPLv3 code to hwclock */
/* #undef USE_HWCLOCK_GPLv3_DATETIME */

/* Enable support for new mount FD based kernel API */
/* #undef USE_LIBMOUNT_MOUNTFD_SUPPORT */

/* Define to 1 if want to support namepaces. */
#define USE_LIBMOUNT_SUPPORT_NAMESPACES 1

/* Define if use udev support in libmount */
#define USE_LIBMOUNT_UDEV_SUPPORT 1

/* Define if program login writes lastlog entries */
/* #undef USE_LOGIN_LASTLOG */

/* Enable plymouth support feature for sulogin and agetty */
#define USE_PLYMOUTH_SUPPORT 1

/* Should sulogin use an emergency mount of /dev and /proc? */
/* #undef USE_SULOGIN_EMERGENCY_MOUNT */

/* Define if systemd support is wanted */
#define USE_SYSTEMD 1

/* Enable extensions on AIX, Interix, z/OS.  */
#ifndef _ALL_SOURCE
# define _ALL_SOURCE 1
#endif
/* Enable extensions on Cosmopolitan Libc. */
#ifndef _COSMO_SOURCE
# define _COSMO_SOURCE 1
#endif
/* Enable general extensions on macOS.  */
#ifndef _DARWIN_C_SOURCE
# define _DARWIN_C_SOURCE 1
#endif
/* Enable general extensions on Solaris.  */
#ifndef __EXTENSIONS__
# define __EXTENSIONS__ 1
#endif
/* Enable GNU extensions on systems that have them.  */
#ifndef _GNU_SOURCE
# define _GNU_SOURCE 1
#endif
/* Enable X/Open compliant socket functions that do not require linking
   with -lxnet on HP-UX 11.11.  */
#ifndef _HPUX_ALT_XOPEN_SOCKET_API
# define _HPUX_ALT_XOPEN_SOCKET_API 1
#endif
/* Identify the host operating system as Minix.
   This macro does not affect the system headers' behavior.
   A future release of Autoconf may stop defining this macro.  */
#ifndef _MINIX
/* # undef _MINIX */
#endif
/* Enable general extensions on NetBSD.
   Enable NetBSD compatibility extensions on Minix.  */
#ifndef _NETBSD_SOURCE
# define _NETBSD_SOURCE 1
#endif
/* Enable OpenBSD compatibility extensions on NetBSD.
   Oddly enough, this does nothing on OpenBSD.  */
#ifndef _OPENBSD_SOURCE
# define _OPENBSD_SOURCE 1
#endif
/* Define to 1 if needed for POSIX-compatible behavior.  */
#ifndef _POSIX_SOURCE
/* # undef _POSIX_SOURCE */
#endif
/* Define to 2 if needed for POSIX-compatible behavior.  */
#ifndef _POSIX_1_SOURCE
/* # undef _POSIX_1_SOURCE */
#endif
/* Enable POSIX-compatible threading on Solaris.  */
#ifndef _POSIX_PTHREAD_SEMANTICS
# define _POSIX_PTHREAD_SEMANTICS 1
#endif
/* Enable extensions specified by ISO/IEC TS 18661-5:2014.  */
#ifndef __STDC_WANT_IEC_60559_ATTRIBS_EXT__
# define __STDC_WANT_IEC_60559_ATTRIBS_EXT__ 1
#endif
/* Enable extensions specified by ISO/IEC TS 18661-1:2014.  */
#ifndef __STDC_WANT_IEC_60559_BFP_EXT__
# define __STDC_WANT_IEC_60559_BFP_EXT__ 1
#endif
/* Enable extensions specified by ISO/IEC TS 18661-2:2015.  */
#ifndef __STDC_WANT_IEC_60559_DFP_EXT__
# define __STDC_WANT_IEC_60559_DFP_EXT__ 1
#endif
/* Enable extensions specified by C23 Annex F.  */
#ifndef __STDC_WANT_IEC_60559_EXT__
# define __STDC_WANT_IEC_60559_EXT__ 1
#endif
/* Enable extensions specified by ISO/IEC TS 18661-4:2015.  */
#ifndef __STDC_WANT_IEC_60559_FUNCS_EXT__
# define __STDC_WANT_IEC_60559_FUNCS_EXT__ 1
#endif
/* Enable extensions specified by C23 Annex H and ISO/IEC TS 18661-3:2015.  */
#ifndef __STDC_WANT_IEC_60559_TYPES_EXT__
# define __STDC_WANT_IEC_60559_TYPES_EXT__ 1
#endif
/* Enable extensions specified by ISO/IEC TR 24731-2:2010.  */
#ifndef __STDC_WANT_LIB_EXT2__
# define __STDC_WANT_LIB_EXT2__ 1
#endif
/* Enable extensions specified by ISO/IEC 24747:2009.  */
#ifndef __STDC_WANT_MATH_SPEC_FUNCS__
# define __STDC_WANT_MATH_SPEC_FUNCS__ 1
#endif
/* Enable extensions on HP NonStop.  */
#ifndef _TANDEM_SOURCE
# define _TANDEM_SOURCE 1
#endif
/* Enable X/Open extensions.  Define to 500 only if necessary
   to make mbstate_t available.  */
#ifndef _XOPEN_SOURCE
/* # undef _XOPEN_SOURCE */
#endif


/* Should wall and write be installed setgid tty? */
#define USE_TTY_GROUP 1

/* Define to 1 to remove /bin and /sbin from PATH env.variable */
#define USE_USRDIR_PATHS_ONLY 1

/* Define to 1 to use vendordir */
/* #undef USE_VENDORDIR */

/* Version number of package */
#define VERSION "2.42.2"

/* Enable MAP_ANON in sys/mman.h on Mac OS X */
#define _DARWIN_C_SOURCE 1

/* Number of bits in a file offset, on hosts where this is settable. */
/* #undef _FILE_OFFSET_BITS */

/* Define to 1 if necessary to make fseeko visible. */
/* #undef _LARGEFILE_SOURCE */

/* Define to 1 on platforms where this makes off_t a 64-bit type. */
/* #undef _LARGE_FILES */

/* Number of bits in time_t, on hosts where this is settable. */
/* #undef _TIME_BITS */

/* Define to 1 on platforms where this makes time_t a 64-bit type. */
/* #undef __MINGW_USE_VC2005_COMPAT */

/* Define to empty if 'const' does not conform to ANSI C. */
/* #undef const */

/* Define to empty if the keyword 'volatile' does not work. Warning: valid
   code using 'volatile' can become incorrect without. Disable with care. */
/* #undef volatile */
