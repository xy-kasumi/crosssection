# geom

Pure, immutable geometry kernel for the editor. No DOM, no canvas, no
Pyodide — runs unchanged under plain Node.

The AuthoringShape contract and the meaning of each apply result live at
the top of `shape.ts` and `apply.ts` respectively; this README only covers
what's not in the source.

## Public surface

```
import {
  apply,
  check,
  compose,
  rodOf,
  type AuthoringShape,
  type Op,
  type ApplyResult,
  type Vec2,
} from "@geom";
```

`check` is the validity gate; `compose` is a pure translation to
`SolverShape` (caller has already checked).

## Conventions

- All data treated as immutable. `apply()` returns a fresh shape.
- `Vec2` is the only positional vocabulary on the public surface — no
  `cx/cy/x/y` parameters externally. Internals may use upstream conventions.
- No human-language strings except `OpInvalid.reason`, which is dev-facing
  (consumers throw on `invalid`).

## Dependencies

Depends only on `@solver/shape.ts` (type-only, for `SolverShape`). Nothing
imports from `web/`. No cycles.
