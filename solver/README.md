# solver

Pyodide+sectionproperties FEM kernel. Self-contained: TS facade, Python sources, vendored wheels, and the cytriangle wheel-build recipe all live here.

## Public surface

- `client.ts` — **browser entry**. `SolverClient` spawns the Pyodide worker, owns its lifecycle, and exposes `solve(...)` over postMessage. Web's only runtime touchpoint into solver.
- `compute.ts` — **Node entry**. `compute(shape, opts)` boots Pyodide-on-Node lazily and returns the same `SolveResult` as the worker path. Used by `tests/`.
- `shape.ts` — `SolverShape` (polygon-only) + `WireShape` + `toWire`. Curves enter as fine polygons; one uniform input format keeps curvature concerns confined to the mesher.

Everything else under `solver/` is internal to one of the two entries above.

## Layout

```
client.ts            web entry (Worker RPC)
worker.ts            the Pyodide worker (boots from CDN; uses ?raw and ?url Vite imports)
pyodide-host.ts      host-agnostic Pyodide bootstrap; browser-importable
node-host.ts         Node-only bootForNode (filesystem reads); ONLY file in solver/ that imports node:*
compute.ts           Node entry
shape.ts             SolverShape / WireShape / toWire
presets.ts           FEM-side primitives used by tests/
types.ts             worker postMessage types
python/              solve.py loaded into Pyodide
wheels/              vendored wheels (committed binaries)
tests/               run-battery.ts + cases.ts + closed-form.ts
pyodide-build/       cytriangle wheel-build recipe + setup-toolchain.sh
scripts/             diagnostic spike scripts (probe-*, m0-*)
```

## Build / typecheck

`tsconfig.json` excludes `worker.ts` and `client.ts` — those use DOM/Worker types and Vite-only imports (`?raw`, `?url`), so they're typechecked from `web/tsconfig.json` instead. Solver's own `tsc --noEmit` is Node-target.

## Tests

```bash
npm test           # run-battery.ts: 5 cases × 3 properties under Pyodide-on-Node
npm run typecheck
```

The Pyodide worker (`worker.ts`) boots eagerly at module top-level — lazy-on-first-message would deadlock against a main thread waiting for `ready`.

Every expected value in `tests/cases.ts` cites an external source (closed form, textbook, standard). Self-computed regression baselines are forbidden: if the algorithm is wrong, a self-baseline is wrong, the test passes, wrong numbers ship.
