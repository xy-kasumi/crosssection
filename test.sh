#!/usr/bin/env bash
# Top-level integration entry. Dispatches into each module's test battery in
# turn and exits non-zero on the first failure. Claude and humans both run this.
#
# - solver/: Pyodide-on-Node FEM correctness battery (~20 s).
# - geom/:   Pure-function geometry kernel battery (~0.5 s).
#
# Each module owns its own package.json; this script is just the dispatcher.

set -euo pipefail

cd "$(dirname "$0")"

echo "=== solver/tests ==="
(cd solver && npm test --silent)

echo
echo "=== geom/tests ==="
(cd geom && npm test --silent)

echo
echo "all batteries green"
