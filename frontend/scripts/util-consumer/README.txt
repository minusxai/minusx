Utility runtime inputs

From the application build directory, authenticate the two pinned public inputs
on the host with GitHub Actions read access:

  python3 scripts/util-consumer/fetch-util-compile.py scripts/util-consumer/debian-compile.lock.json .qualified-util-source
  python3 scripts/util-consumer/fetch-success-input.py scripts/util-consumer/native-candidate.lock.json .qualified-util-native

Prepare the separate Perl input using scripts/perl/README.md, then run:

  docker compose build --no-cache

The two utility directories are separate named build contexts and are excluded
from the application context. Credentials remain on the host. Each current build
captures its own original package family, compares it with authenticated numeric
source evidence, reconstructs the existing mount package's metadata from the
actual target, and checks the complete dependency graph before installation.

Only the four already installed packages libmount1, util-linux, login and mount
are replaced. Mount retains its original payload; its exact libmount dependency
and version/source bookkeeping change. The other three payloads come from the
qualified source build. No utility C source compilation occurs in this consumer.

The default builder's namespace denial remains recorded in the isolated producer
receipts. Its separate capable-kernel proof is bound to the exact original and
candidate nsenter bytes. CI also tests the actual target image in a disposable
container with the capabilities required for namespace entry; deployment receives
no additional capabilities.

Source, isolated producer, fresh target transaction, and final application proof
are retained separately. Fetching or preparing inputs does not declare admission.
