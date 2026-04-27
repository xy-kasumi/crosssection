# Building `cytriangle` for Pyodide

`cytriangle` is a Cython wrapper around Shewchuk's Triangle (the C mesher used by `sectionproperties`). It has no Pyodide-targeted wheel on PyPI, so we build one ourselves. The upstream package's existing `build_ext.py` already uses the right Triangle compile flags (`TRILIBRARY`, `NO_TIMER`, `VOID=void`, `REAL=double`), and Triangle.c compiles cleanly under Emscripten without source modifications. Only warnings, no errors.

Two patches the build applies before `pyodide build`:

1. **Relax `numpy>=2.3.3` to `numpy>=2.0`** — Pyodide 0.27.7 ships numpy 2.0.2; cytriangle's pin is overly tight. numpy 2.x has stable ABI so the runtime is fine.
2. **Retag wheel platform** from `pyemscripten_2024_0_wasm32` (pyodide-build 0.34's new ABI tag) to `emscripten_3_1_58_wasm32` (what Pyodide 0.27.7's micropip looks for). Drop this step when we upgrade the npm `pyodide` package to >=0.28.

## Pinned versions

- Pyodide: **0.27.7** (matches the `pyodide` npm package consumed by `core/pyodide-host.ts`)
- Cross-build environment: **0.27.7** (Python 3.12.7, Emscripten 3.1.58)
- cytriangle: **v3.0.2** (latest as of 2026-04, from <https://github.com/m-clare/cytriangle>)

When upgrading any of these, run a full rebuild and re-run `npm test` to confirm numerics are unchanged.

## One-time toolchain setup

```bash
# 1. Python venv with pyodide-build CLI
python3 -m venv .venv-pyodide-build
source .venv-pyodide-build/bin/activate
pip install --upgrade pip pyodide-build

# 2. Install Pyodide cross-build environment matching the runtime
pyodide xbuildenv install 0.27.7

# 3. Install matching Emscripten SDK
pyodide xbuildenv install-emscripten
```

This populates `~/.cache/.pyodide-xbuildenv-*/0.27.7/`.

## Build

See `build.sh` in this directory. It clones cytriangle, runs `pyodide build`, and copies the wheel into `../../wheels/`.

## Verifying the build

After building, run from the repo root:

```bash
npm test
```

If numerics drift from previous runs, the wheel is suspect — check the source commit, recompile, and diff the resulting wheel.
