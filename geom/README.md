# geom

Pure, immutable geometry kernel for the editor. No DOM, no canvas, no
Pyodide — runs unchanged under plain Node, which is the whole point.

## Public surface

```
import {
  apply,
  rodOf,
  type AuthoringShape,
  type Op,
  type ApplyResult,
  type Vec2,
} from "@geom";
```

- `AuthoringShape` carries its composed (solver-ready) form in its
  `composed` field. Construction goes only through preset constructors
  and `apply()`; both compose internally so `{data, composed}` cannot
  drift.
- `apply(shape, op)` returns one of:
  - `{kind: "ok",      shape}`        — clean commit
  - `{kind: "warn",    shape, reason}` — committable but lossy
  - `{kind: "err",     reason}`       — user intent rejected
  - `{kind: "invalid", reason}`       — bug; UI must surface and crash

## Invariants

- All data is `readonly`. `apply()` returns a fresh `AuthoringShape`.
- `Vec2` is the only positional vocabulary on the public surface — no
  `cx, cy, x, y` parameters anywhere external. Internals (in
  `internal.ts`) may use whatever the upstream library expects.
- `apply()` composes synchronously and eagerly. No lazy thunks.

## Dependencies

`geom` depends only on `@solver/shape.ts` (type-only, for `SolverShape`).
Nothing imports from `web/`. There are no cycles.
