# crosssection

In-browser calculator for 2D cross-section properties: **Iₓ**, **Iᵧ** (second moments of area) and **J** (St. Venant torsional constant). Static, local-only SPA; the heavy lifting is `sectionproperties` (Python) running in Pyodide.

## Status

- **Core compute + CLI test battery**: working. `npm test` runs five preset shapes through the Pyodide solver; expected values cite external references (closed forms, Roark, Timoshenko & Goodier) — no self-computed regression baselines.
- **Browser UI** (`web/`): direct-manipulation editor with rod/rectangle/extrusion presets, Paint/Erase/Add-Hole tools, snap-to-grid, and an animated zero-state landing that hides Pyodide boot time behind a closed-form-numbers carousel. Three readouts (Iₓ, Iᵧ, J) update on every edit.

## Layout

```
core/             TS library: types, presets, Pyodide bridge. Stack-neutral.
compute/          Python loaded into Pyodide (solve.py + closed_form.py).
pyodide-build/    Recipe + script for rebuilding the cytriangle wheel.
wheels/           Vendored built wheels (committed binaries; the artifact).
tests/            CLI battery + closed-form formulas + case definitions.
web/              Browser UI. Self-contained subdir with its own package.json.
                  Deletable without breaking anything in the rest of the project.
                    src/main.ts          composition root (wires panels)
                    src/core-boot.ts     Pyodide worker lifecycle + boot-failure UI
                    src/core-worker.ts   the Pyodide worker (boots from CDN)
                    src/editor.ts        shape edit engine (drag, hit-test, tools)
                    src/view-animator.ts halfSpan tween + zero-state RAF
                    src/canvas/          paint pipeline (grid, shape, handles, ...)
                    src/ui/              panels: start-pane, toolbar, readouts,
                                         debug-pane, zero-state
scripts/          Diagnostic spike scripts (probe-*, m0-*).
```

The root `package.json` declares **no bundler** — it depends only on `pyodide` (Node target), `tsx`, and `typescript`. All web tooling lives under `web/`. If Vite goes out of fashion, only `web/` changes.

## Architecture notes

- Compute runs in Pyodide using the [`sectionproperties`](https://github.com/robbievanleeuwen/section-properties) library by Robbie van Leeuwen. The dependency [`cytriangle`](https://github.com/m-clare/cytriangle) (a Cython wrapper around Shewchuk's [Triangle](https://www.cs.cmu.edu/~quake/triangle.html)) has no Pyodide wheel on PyPI; we build one ourselves and commit it under `wheels/`. The build (`pyodide-build/cytriangle/build.sh`) applies two mechanical patches: relax `numpy>=2.3.3` → `>=2.0`, and retag the wheel from `pyemscripten_2024_0_wasm32` → `emscripten_3_1_58_wasm32`. Both can go away when the npm `pyodide` package upgrades past 0.28.
- Internal shape representation is polygon-only (`Shape = Polygon[]`). Curves enter as fine polygons; a single uniform input format keeps curvature concerns confined to the mesher.
- Tests run under Pyodide-on-Node (`npm test`), not in a browser — same Python, same wheels, same numerics.
- Every expected value in `tests/cases.ts` cites an external source (closed form, textbook, standard). Self-computed regression baselines are not allowed: if the algorithm is wrong, a self-baseline is wrong, the test passes, wrong numbers ship.
- The browser worker (`web/src/core-worker.ts`) boots Pyodide at module top-level. Lazy-on-first-message deadlocks against a main thread waiting for `ready`. Boot is non-blocking from the user's perspective: the editor is interactive immediately and a failure overlay only appears if boot times out (45 s) or the worker errors.
- Coordinate-system invariant in the web UI: only `editor.ts` and `canvas/index.ts` cross the world↔CSS-pixel boundary. Submodules under `canvas/*` consume a `View` and emit pixels; they never reverse the transform themselves.

## Dev instructions

### Test (M1: core + correctness)

```bash
npm install
npm test            # full battery, 5 cases × 3 properties = 15 PASS, ~20s wall
npm run typecheck   # tsc --noEmit
```

`npm test` exits non-zero on any failure. Re-runs are unattended (wheels are local; Pyodide stdlib is pinned). This is the **canonical correctness gate**; the browser is just a presentation layer over the same code.

### Run the browser UI

```bash
cd web
npm install
npm run dev         # vite dev server at http://localhost:5173/
```

On first load, a muted carousel of demo cross-sections plays in the canvas while Pyodide boots. Click **Rod / Rectangle / Extrusion** in the left pane to enter the editor; a small W/H/S/D form appears over the canvas — type values, Enter confirms. Use **Paint Rect / Erase Rect / Add Hole** in the toolbar to compose; **Space** toggles snap-to-grid. Right-click a vertex to delete it; click an empty edge handle to insert one. The three readouts update after every edit; "computing…" fade indicates a solve in flight.

### Build the browser UI

```bash
cd web
npm run build       # static bundle in web/dist/
npm run preview     # serve dist/ for sanity check
```

### Deploy

The build output in `web/dist/` is plain static files — drop on any static host (Netlify/Pages/S3). The first page load fetches Pyodide's runtime (~5 MB) from the jsdelivr CDN; the cytriangle wheel and `sectionproperties` are served by the same host. To go fully offline, mirror the Pyodide files from `node_modules/pyodide/` into `web/public/pyodide/` and change `PYODIDE_INDEX` in `web/src/core-worker.ts` to `/pyodide/`.

### Rebuild the cytriangle wheel

Only needed when bumping cytriangle or Pyodide upstream:

```bash
# one-time toolchain setup (~2 GB for emsdk + xbuildenv)
python3 -m venv .venv-pyodide-build
source .venv-pyodide-build/bin/activate
pip install pyodide-build
pyodide xbuildenv install 0.27.7
pyodide xbuildenv install-emscripten

# rebuild
./pyodide-build/cytriangle/build.sh
# then update sha256 + filename in wheels/README.md
```
