#!/usr/bin/env bash
# One-time host-side toolchain setup for rebuilding the cytriangle Pyodide wheel.
# Creates solver/.venv-pyodide-build with pyodide-build CLI, then installs the
# matching cross-build environment and Emscripten SDK (~2 GB on disk).
#
# Re-run only when bumping PYODIDE_VERSION below or recreating the venv.

set -euo pipefail

SOLVER_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYODIDE_VERSION="0.27.7"
VENV_DIR="$SOLVER_ROOT/.venv-pyodide-build"

if [[ -d "$VENV_DIR" ]]; then
  echo "Reusing existing venv at $VENV_DIR"
else
  echo "Creating venv at $VENV_DIR"
  python3 -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

pip install --upgrade pip pyodide-build

pyodide xbuildenv install "$PYODIDE_VERSION"
pyodide xbuildenv install-emscripten

echo
echo "Toolchain ready. Run cytriangle/build.sh to produce a wheel."
