#!/bin/sh
# Host-side CI only, creating a fresh remediation-owned source-test container.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
image=${1:?Pass matching source-builder image reference}
proof=${2:?Pass in-image path to run-keyring-source-proof.sh}
(cd "$here" && sha256sum -c SHA256SUMS)
# No existing container is claimed/reused. No host data, credentials or socket mount.
container=$(docker create --network none --cap-drop ALL \
 --label maintenance.owner=remediation-team \
 --label maintenance.task=kernel-keyring-source-proof \
 --security-opt no-new-privileges \
 --security-opt "seccomp=$here/keyring-seccomp-test.json" \
 --entrypoint /bin/sh "$image" "$proof")
cleanup() { docker rm "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM
owner=$(docker inspect --format '{{index .Config.Labels "maintenance.owner"}}' "$container")
task=$(docker inspect --format '{{index .Config.Labels "maintenance.task"}}' "$container")
test "$owner" = remediation-team
test "$task" = kernel-keyring-source-proof
test "$(docker inspect --format '{{.HostConfig.Privileged}}' "$container")" = false
test "$(docker inspect --format '{{len .Mounts}}' "$container")" -eq 0
test "$(docker inspect --format '{{len .HostConfig.Binds}}' "$container")" -eq 0
test "$(docker inspect --format '{{len .HostConfig.VolumesFrom}}' "$container")" -eq 0
test "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container")" = none
test "$(docker inspect --format '{{json .HostConfig.CapDrop}}' "$container")" = '["ALL"]'
test "$(docker inspect --format '{{len .HostConfig.CapAdd}}' "$container")" -eq 0
# Minimal creation/ownership record BEFORE starting, with no env/history/config dump.
printf 'CREATED_OWNED_SOURCE_CONTAINER id=%s owner=%s task=%s\n' "$container" "$owner" "$task"
docker inspect --format 'SOURCE_CONTAINER image={{.Image}} network={{.HostConfig.NetworkMode}} capdrop={{json .HostConfig.CapDrop}}' "$container"
docker inspect --format '{{json .HostConfig.SecurityOpt}}' "$container" | python3 -c '
import hashlib,json,pathlib,sys
options=json.load(sys.stdin)
assert any(item in ("no-new-privileges", "no-new-privileges:true") for item in options)
policy=pathlib.Path(sys.argv[1]).read_bytes()
actual=next(item[len("seccomp="):] for item in options if item.startswith("seccomp="))
assert json.loads(actual)==json.loads(policy)
print("SOURCE_CONTAINER_SECURITY no_new_privileges=true seccomp_sha256="+hashlib.sha256(policy).hexdigest())
' "$here/keyring-seccomp-test.json"
start_status=0
docker start --attach "$container" || start_status=$?
state=$(docker inspect --format '{{.State.Status}}' "$container")
exit_code=$(docker inspect --format '{{.State.ExitCode}}' "$container")
printf 'OWNED_SOURCE_CONTAINER_RESULT id=%s state=%s exit=%s\n' "$container" "$state" "$exit_code"
test "$start_status" -eq 0 && test "$state" = exited && test "$exit_code" -eq 0
