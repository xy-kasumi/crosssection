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
  - `{kind: "ok",      shape, preselect?}`         — clean commit
  - `{kind: "warning", shape, preselect?, ...w}`   — committable but lossy (`w: WarnTag`)
  - `{kind: "error",   ...e}`                      — geometry rejected (`e: ErrorTag`)
  - `{kind: "invalid", reason}`                    — bug; consumer must surface and crash

`ErrorTag` and `WarnTag` are shared with `compose()` — from the caller's
view there's no "compose" layer, just "did this op produce a valid
geometry?" Indexed variants carry an optional `holeIndex` for UI
highlighting; the text rendering doesn't need it.

No human-language strings live in `geom/`. The dev-facing `OpInvalid.reason`
is the one exception, and only because it never reaches end-user surfaces
(consumers are expected to throw on `invalid`).

## Invariants

- All data is `readonly`. `apply()` returns a fresh `AuthoringShape`.
- `Vec2` is the only positional vocabulary on the public surface — no
  `cx, cy, x, y` parameters anywhere external. Internals (in
  `internal.ts`) may use whatever the upstream library expects.
- `apply()` composes synchronously and eagerly. No lazy thunks.

## Dependencies

`geom` depends only on `@solver/shape.ts` (type-only, for `SolverShape`).
Nothing imports from `web/`. There are no cycles.
