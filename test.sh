#!/usr/bin/env bash
# Top-level integration entry. Runs each module's test battery in turn and
# exits non-zero on the first failure. Claude and humans both run this.
#
# - solver/: Pyodide-on-Node FEM correctness battery (~20 s).
# - geom/:   Pure-function geometry kernel battery (added in plan phase B).
#
# No bundler at the root. Each module knows how to run its own tests; this
# script is just the dispatcher.

set -euo pipefail

cd "$(dirname "$0")"

echo "=== solver/tests ==="
node --import tsx solver/tests/run-battery.ts

echo
echo "=== geom/tests ==="
node --import tsx --test 'geom/tests/**/*.test.ts'

echo
echo "all batteries green"
