#!/bin/sh
# Seal the one original-target SQLite archive under its canonical package name.
set -eu
test "$#" -eq 2
source=$1
destination=$2
test ! -e "$destination"
set -- "$source"/*.deb
test "$#" -eq 1
test -f "$1" && test ! -L "$1"
test "$(dpkg-deb -f "$1" Package)" = libsqlite3-0
test "$(dpkg-deb -f "$1" Version)" = '3.46.1-7+deb13u2+runtime1'
test "$(dpkg-deb -f "$1" Architecture)" = amd64
mkdir "$destination"
cp "$1" "$destination/libsqlite3-0.deb"
