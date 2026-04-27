# Vendored Pyodide wheels

These wheels are loaded at runtime by `solver/pyodide-host.ts`. They are committed to the repo as build artifacts so that the project is reproducible offline and isn't hostage to upstream PyPI / npm uptime.

## Inventory

| File | Source | Built how | sha256 |
|------|--------|-----------|--------|
| `cytriangle-3.0.2-cp312-cp312-emscripten_3_1_58_wasm32.whl` | <https://github.com/m-clare/cytriangle> v3.0.2 with `numpy>=2.3.3` constraint relaxed to `numpy>=2.0` (numpy 2.x has stable ABI; Pyodide 0.27.7 ships 2.0.2). | Built locally with `pyodide build` against the 0.27.7 cross-build environment (Emscripten 3.1.58), then `wheel tags` retagged from `pyemscripten_2024_0_wasm32` (the new pyodide-build 0.34 default) to `emscripten_3_1_58_wasm32` (which Pyodide 0.27.7's micropip recognizes). See `../pyodide-build/cytriangle/README.md`. | `81e75ada8cfe68cb062152aaa58d02a593e9527883017dffbe3cf0947b7d1982` |

`sectionproperties` itself is a pure-Python wheel, available from the standard Pyodide wheel index — no need to vendor it. `numpy`, `scipy`, `shapely`, `matplotlib` are part of the Pyodide standard distribution.

## Refreshing

```bash
solver/pyodide-build/cytriangle/build.sh
```

The script clones cytriangle into `/tmp`, runs `pyodide build`, retags the wheel, and copies it into this directory. Verify the resulting sha256 matches what `./test.sh` consumes; update this README when versions change.
