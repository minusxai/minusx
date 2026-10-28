#!/usr/bin/env bash
set -euo pipefail
[[ "$(go env GOVERSION)" == "go1.27.3" ]] || { echo "Go 1.27.3 required"; exit 1; }
export CGO_ENABLED=0 GOTOOLCHAIN=local
build_dir=$(mktemp -d)
trap 'rm -rf "$build_dir"' EXIT
versions=$(node -e 'const p=require("./package-lock.json").packages; console.log([...new Set(Object.entries(p).filter(([k])=>k.endsWith("/esbuild")).map(([,v])=>v.version))].join(" "))')
for version in $versions; do
  case "$version" in 0.28.1|0.28.2) ;; *) echo "Unreviewed esbuild version"; exit 1 ;; esac
  mkdir -p "$build_dir/$version" "$build_dir/out/$version"
  (
    cd "$build_dir/$version"
    go mod init build-source
    go mod download "github.com/evanw/esbuild@v$version"
    cp -R "$(go env GOPATH)/pkg/mod/github.com/evanw/esbuild@v$version/." .
    chmod -R u+w .
    go mod edit -require=golang.org/x/sys@v0.44.0
    go mod download golang.org/x/sys
    go build -trimpath -ldflags='-s -w' -o "$build_dir/out/$version/esbuild" ./cmd/esbuild
    test "$("$build_dir/out/$version/esbuild" --version)" = "$version"
  )
done
ESBUILD_REBUILT_DIR="$build_dir/out" node scripts/patch-esbuild.mjs
node -e 'const assert=require("node:assert/strict"); const e=require("esbuild"); assert.match(e.transformSync("const value: number = 42", {loader:"ts"}).code, /42/); console.log("esbuild TypeScript transform passed")'
