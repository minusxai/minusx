#!/bin/sh
# Transport failed source evidence; only the external validator admits outputs.
set -eu
test "$#" = 1
phase=$1
case "$phase" in compile|snapshot) ;; *) exit 2;; esac
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p /out
test ! -e /out/build-execution.json
set +e
sh "$here/build.sh" "$phase-body"
source_status=$?
set -e

retain_raw() {
    work=/util-linux-work
    test -d "$work" || return 1
    test ! -e /out/pristine-original || return 1
    if test -d "$work/original"; then
        cp -a "$work/original" /out/pristine-original || return 1
    fi
    # Retain original payload/control identity and already-built installed
    # siblings, never the huge source/build tree or arbitrary working files.
    list=/out/raw-work-inputs.paths
    : > "$list" || return 1
    for name in original original-payload baseline.json runtime-config.h original-features.h; do
        if test -e "$work/$name"; then
            printf '%s\000' "$name" >> "$list" || return 1
        fi
    done
    if test -f "$work/original/resolver/installed-util-family"; then
        while IFS= read -r package; do
            case "$package" in ''|*[!a-z0-9+.-]*) return 1;; esac
            for path in "$work/$package"_*.deb; do
                if test -f "$path"; then
                    printf '%s\000' "${path##*/}" >> "$list" || return 1
                fi
            done
        done < "$work/original/resolver/installed-util-family"
    fi
    tar -C "$work" --numeric-owner --null --verbatim-files-from \
        -cpf /out/raw-work-inputs.tar --files-from "$list" || return 1
    sha256sum /out/raw-work-inputs.tar > /out/raw-work-inputs.sha256 || return 1
    if command -v python3 >/dev/null 2>&1; then
        python3 "$here/raw-inventory.py" "$work" /out/raw-input-inventory.json || return 1
    fi
}
set +e
retain_raw
export_status=$?
set -e
printf '{"schema":1,"kind":"util-evidence-transport","status":"raw-unadmitted","phase":"%s","source_exit_code":%s,"export_exit_code":%s,"installed_native_qualification":false}\n' \
    "$phase" "$source_status" "$export_status" > /out/build-execution.json
# Zero is transport success only. Both statuses must be zero AND every source
# proof must validate in the host step before the workflow can succeed.
exit 0
