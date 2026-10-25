#!/bin/sh
# Fresh task-owned test container; never reuse or inspect another container.
set -eu
image=${1:?Supply the matching production image}
proof=${2:?Supply an absolute task-owned proof directory}
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$proof"
expected_image=$(docker image inspect --format '{{.Id}}' "$image")
container=$(docker create --network none \
 --label maintenance.owner=remediation-team --label maintenance.task=native-runtime-proof \
 --mount "type=bind,source=$here/check-runtime.cjs,target=/app/check-runtime.cjs,readonly" \
 --mount "type=bind,source=$proof,target=/runtime-proof" \
 --env NATIVE_PROOF_DIR=/runtime-proof --entrypoint node "$image" /app/check-runtime.cjs)
cleanup() { docker rm "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM
test "$(docker inspect --format '{{index .Config.Labels "maintenance.owner"}}' "$container")" = remediation-team
test "$(docker inspect --format '{{index .Config.Labels "maintenance.task"}}' "$container")" = native-runtime-proof
test "$(docker inspect --format '{{.Image}}' "$container")" = "$expected_image"
test "$(docker inspect --format '{{.HostConfig.Privileged}}' "$container")" = false
test "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container")" = none
docker inspect --format '{{json .Mounts}}' "$container" | python3 -c '
import json,sys
mounts=json.load(sys.stdin)
expected={"/app/check-runtime.cjs":(sys.argv[1],False),"/runtime-proof":(sys.argv[2],True)}
assert len(mounts)==2
for mount in mounts:
 assert mount["Type"]=="bind"
 assert (mount["Source"],mount["RW"])==expected[mount["Destination"]]
' "$here/check-runtime.cjs" "$proof"
printf 'CREATED_OWNED_NATIVE_CONTAINER id=%s image=%s owner=remediation-team task=native-runtime-proof\n' "$container" "$expected_image"
status=0
docker start --attach "$container" || status=$?
state=$(docker inspect --format '{{.State.Status}}' "$container")
exit_code=$(docker inspect --format '{{.State.ExitCode}}' "$container")
printf 'OWNED_NATIVE_CONTAINER_RESULT id=%s state=%s exit=%s\n' "$container" "$state" "$exit_code"
test "$status" -eq 0
test "$state" = exited
test "$exit_code" -eq 0
# Copy bytes from this SAME completed container in which Node loaded the module.
docker cp "$container:/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node" "$proof/loaded-sqlite.node"
python3 "$here/check-embedded-sqlite-exports.py" "$proof"
