#!/usr/bin/env bash
# Rebuild cytriangle Pyodide wheel and stage it under ../../wheels/.
# Requires: .venv-pyodide-build set up at repo root, xbuildenv 0.27.7 installed.
# See README.md for one-time toolchain setup.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_DIR="${SRC_DIR:-/tmp/cytriangle}"
PYODIDE_VERSION="0.27.7"
CYTRIANGLE_REF="${CYTRIANGLE_REF:-v3.0.2}"

if [[ ! -d "$REPO_ROOT/.venv-pyodide-build" ]]; then
  echo "Missing $REPO_ROOT/.venv-pyodide-build — see README.md for toolchain setup" >&2
  exit 1
fi

# Fresh checkout
rm -rf "$SRC_DIR"
git clone --depth 1 --branch "$CYTRIANGLE_REF" https://github.com/m-clare/cytriangle.git "$SRC_DIR"

# Activate envs and build
source "$HOME/.cache/.pyodide-xbuildenv-0.34.1/$PYODIDE_VERSION/emsdk/emsdk_env.sh"
source "$REPO_ROOT/.venv-pyodide-build/bin/activate"

cd "$SRC_DIR"

# Patch: cytriangle 3.0.2 declares numpy>=2.3.3, but Pyodide 0.27.7 ships numpy 2.0.2.
# numpy 2.x has stable ABI, so loosen the constraint to >=2.0. Lift this if/when
# Pyodide upgrades numpy past the upstream pin.
sed -i 's/numpy = ">=2.3.3"/numpy = ">=2.0"/' pyproject.toml

pyodide build

# Retag platform: pyodide-build 0.34 emits "pyemscripten_2024_0_wasm32" but
# Pyodide 0.27.7's micropip only recognizes the legacy "emscripten_3_1_58_wasm32".
# When the runtime npm package is upgraded to >=0.28 this step can be dropped.
WHEEL=$(ls dist/cytriangle-*.whl | head -1)
cp "$WHEEL" "$REPO_ROOT/wheels/"
cd "$REPO_ROOT/wheels"
wheel tags --remove --platform-tag emscripten_3_1_58_wasm32 "$(basename "$WHEEL")"

FINAL=$(ls cytriangle-*emscripten_3_1_58_wasm32.whl | head -1)
echo
echo "Wheel staged: $REPO_ROOT/wheels/$FINAL"
sha256sum "$FINAL"
echo
echo "Update wheels/README.md inventory if filename or sha256 changed."
