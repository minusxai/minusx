-----BEGIN PGP SIGNED MESSAGE-----
Hash: SHA384

Format: 3.0 (quilt)
Source: perl
Binary: perl-base, perl-doc, perl-debug, libperl5.40, libperl-dev, perl-modules-5.40, perl
Architecture: any all
Version: 5.40.1-6+deb13u1
Maintainer: Niko Tyni <ntyni@debian.org>
Uploaders: Dominic Hargreaves <dom@earth.li>
Homepage: https://dev.perl.org/perl5/
Standards-Version: 3.9.8
Vcs-Browser: https://salsa.debian.org/perl-team/interpreter/perl
Vcs-Git: https://salsa.debian.org/perl-team/interpreter/perl.git
Testsuite: autopkgtest
Testsuite-Triggers: build-essential, cpio, db-util, dist, dpkg-dev, gdbmtool, libapt-pkg-perl, libdpkg-perl, pkg-perl-autopkgtest
Build-Depends: file, cpio, dpkg-dev (>= 1.22.5), libcrypt-dev, libdb-dev, libgdbm-dev (>= 1.18-3), libgdbm-compat-dev, netbase <!nocheck>, procps [!hurd-any] <!nocheck>, debhelper-compat (= 13), zlib1g-dev | libz-dev, libbz2-dev, dist (>= 3.5-236), libc6-dev (>= 2.37-8) [ppc64el], libc6-dev (>= 2.19-9) [s390x]
Package-List:
 libperl-dev deb libdevel optional arch=any
 libperl5.40 deb libs optional arch=any
 perl deb perl standard arch=any
 perl-base deb perl required arch=any essential=yes
 perl-debug deb devel optional arch=any
 perl-doc deb doc optional arch=all
 perl-modules-5.40 deb libs optional arch=all
Checksums-Sha1:
 82d1edc45031c917619d2c412c6d5c34a50fde0a 421056 perl_5.40.1.orig-regen-configure.tar.xz
 4ffe5246c791df884363aed05ba81ba41cb02084 13930924 perl_5.40.1.orig.tar.xz
 1c181a089b69ccda8f7adce847dd5d8984e247a7 186360 perl_5.40.1-6+deb13u1.debian.tar.xz
Checksums-Sha256:
 4ea023d08101443f6ed9dc3bdd9bb5f5e08087678dc9e443d195df22da36209a 421056 perl_5.40.1.orig-regen-configure.tar.xz
 dfa20c2eef2b4af133525610bbb65dd13777ecf998c9c5b1ccf0d308e732ee3f 13930924 perl_5.40.1.orig.tar.xz
 5ee76db601d6f4638433ab9b0f5bd5cfb15b102a79d902ff282e762becb7e724 186360 perl_5.40.1-6+deb13u1.debian.tar.xz
Files:
 9b3f5231e0354423504e64e80b0a8be6 421056 perl_5.40.1.orig-regen-configure.tar.xz
 bab3547a5cdf2302ee0396419d74a42e 13930924 perl_5.40.1.orig.tar.xz
 25a497217f31c1bd9abec448d442a144 186360 perl_5.40.1-6+deb13u1.debian.tar.xz

-----BEGIN PGP SIGNATURE-----

iKcEARMJAC8WIQTuZv2Xfg2x/uVxefeK/rNkDrE5sgUCaphfyBEcbnR5bmlAZGVi
aWFuLm9yZwAKCRCK/rNkDrE5sqjVAYC2qsf0vw3ecsayDZXrZfQUoSNzoAZ2GN5q
Rnp+I7Cpz2KrAGLjD/qow7fv9qV7gXMBf2OOHhZURvy6m/xWMLcXBUaLKPS4DGl9
EFlGkNJvo5MJQ3gycqjwjewH9QKDsWNKng==
=As3Y
-----END PGP SIGNATURE-----
