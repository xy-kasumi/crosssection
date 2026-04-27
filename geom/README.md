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
  - `{kind: "ok",      shape, preselect?}`    — clean commit
  - `{kind: "warning", shape, preselect?, tag}` — committable but lossy (`tag: WarnTag`)
  - `{kind: "error",   tag, ...}`             — user intent rejected (`tag: ApplyErrorTag`)
  - `{kind: "invalid", reason}`               — bug; UI must surface and crash

Tag vocabulary (warning, apply-error, compose-error) is exhaustively
listed in `apply.ts` / `shape.ts`. No human-language strings live in
`geom/`; the web layer renders tags to text. Dev-facing `OpInvalid.reason`
is exempt — it surfaces only via thrown exception → `window.onerror`.

## Invariants

- All data is `readonly`. `apply()` returns a fresh `AuthoringShape`.
- `Vec2` is the only positional vocabulary on the public surface — no
  `cx, cy, x, y` parameters anywhere external. Internals (in
  `internal.ts`) may use whatever the upstream library expects.
- `apply()` composes synchronously and eagerly. No lazy thunks.

## Dependencies

`geom` depends only on `@solver/shape.ts` (type-only, for `SolverShape`).
Nothing imports from `web/`. There are no cycles.
