#!/bin/sh
# Preparation-only reviewed scope. Never install candidate packages here.
set -eu
checks=/checks
python3 "$checks/bind-ubuntu-evidence.py" --failed-source /failed --recovery /recovered --target /target --checks "$checks" --destination /binding --review-authorization /review/preparation-review.json --review-authorization-sha256 "$1"
cp -R /binding/output /out
UTIL_UBUNTU_RECOVERY_AUTH_SHA256=$(sha256sum /out/ubuntu-recovery-authorization.json | cut -d' ' -f1)
export UTIL_UBUNTU_RECOVERY_AUTH_SHA256
python3 "$checks/package.py" package /recipe /binding/work
python3 "$checks/mount-metadata-target.py" /binding/target-work/original/mount /out/mount.deb > /out/mount-preparation.json
UTIL_UBUNTU_TARGET_BINDING_SHA256=$(sha256sum /out/target-binding.json | cut -d' ' -f1)
export UTIL_UBUNTU_TARGET_BINDING_SHA256
python3 "$checks/prepare-plan.py" "$checks" /binding/work /out /candidate /binding/target-work/original /out/target-binding.json
mkdir /candidate/packages
for package in util-linux libmount1 mount; do cp "/out/$package.deb" "/candidate/packages/$package.deb"; done
cp /out/evidence-binding.json /out/ubuntu-recovery-authorization.json /out/target-binding.json /out/external-preparation-review.json /out/mount-preparation.json /candidate/
printf '{"kind":"ubuntu-util-package-preparation","status":"three-packages-prepared-unadmitted","source_recompiled":false,"candidate_installed":false,"native_qualified":false}\n' > /candidate/package-status.json
