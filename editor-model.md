# Editor model — ubiquitous language

Mental model for the cross-section editor. New behavior should fit this
vocabulary; if it doesn't, extend the vocabulary first.

## Vocabulary

| term | definition |
|------|------------|
| **shape** | The whole edited object: an `AuthoringShape` — disk-or-outers + zero-or-more holes. Lives in `geom/`. |
| **prim** | A single addressable element of the shape: disk, outer ring, circle hole, polygon hole. The debug pane lists prims. |
| **selection** | A pointer to one prim. At most one selection at a time. |
| **op** | A user-initiated mutation. Has a kind, an in-flight config, and a lifecycle. The `Op` union lives in `geom/op.ts`. |
| **op result** | Quartet of `apply(base, op)`: `ok` (commit cleanly, kind preserved), `warning` (committable, but lossy — today only "the affected circle becomes a polygon, you lose drag-center/radius"), `error` (cannot commit), `invalid` (UI bug — UI shouldn't reach here). |
| **preview** | What's shown while a drag is in flight: the **candidate** shape (the op result on `ok`/`warning`, the live base on `error`) plus an **op cursor** overlay indicating the gesture (rect ghost, circle ghost). The base AuthoringShape is never mutated mid-op. |
| **commit** | Apply the op result. Triggered by an explicit user signal (mouseup, second click, Enter). Runs on `ok` and `warning`; `error` discards. |
| **discard** | Drop the op without mutating the shape. Triggered by Esc, right-click, or a commit attempted on `error`. |

## Op kinds

All ops route through `apply` in `geom/apply.ts`. That function is the single
source of truth for what each op does and which results it can produce — the
doc deliberately doesn't repeat it.

Tool gestures (toolbar-driven, two clicks):
- `paint-rect` — Unions a rectangle into the outer.
- `erase-rect` — Subtracts a rectangle from the filled region; can split the outer (error) or consume circle holes (warning).
- `add-hole` — Clean placement (entirely inside, no overlap) keeps a circle hole and preserves the AuthoringShape kind. Anything else (crosses outer, or overlaps an existing hole) → polygon-conversion: the bite is subtracted from the filled region and decomposed into a `PolygonShape`. If the bite touches the boundary the outer notches and no hole prim is created; if it doesn't, an emergent polygon hole appears. Warning emitted in either case. AuthoringShape becomes `polygon` whenever conversion happens.

Drag-derived (mousedown captures `dragStartShape`/`dragStartCursor`; each frame
issues an op against the captured base with a cumulative delta — never against
the previous frame's result):
- `move-vert`, `delete-vert`, `insert-vert` — vertex-level edits to any polygon outline.
- `move-disk-center`, `move-disk-radius` — disk primitive.
- `move-hole-center`, `move-hole-radius` — circle-hole primitive. Both go through the add-hole pipeline so crossing the outer polygonizes (warning).
- `translate-prim` — drag a whole prim by a Vec2 delta. Translating a circle hole that ends up crossing the outer goes through the same polygonization path as `move-hole-center`.

## Invariants

These hold at all times. Load-bearing — code that violates them is broken.

1. **`apply()` is pure.** It returns a fresh `AuthoringShape`; the input is never mutated. `editor.ts` reflects this by replacing `this.shape` atomically with the result — never editing fields in place.
2. **AuthoringShape is always sound.** `compose(shape)` returns `ok` after any commit. The on-canvas display during a drag is the result of `apply(dragStartShape, op)`, so polygon conversion only happens at commit time (or live in the preview if the user has dragged into warning territory).
3. **Drag is base-relative, not chained.** The editor captures the pre-drag shape and cursor on mousedown; every per-frame `apply()` runs against that captured base with a cumulative delta. The previous frame's result never feeds the next frame's input. Gesture is trivially associative.
4. **`invalid` crashes loudly.** Any `apply()` returning `{kind: "invalid", ...}` means the UI built a malformed Op (e.g. out-of-range vertex index). `editor.ts` logs and `throw`s; `main.ts`'s `window.onerror` handler reuses `boot-overlay` to surface the failure. No silent recovery.
5. **Circles can't represent arcs.** Whenever a boolean op would clip a circle outer or hole into an arc, the candidate must convert that prim to a polygon. The authoring model has no arc primitive.
6. **Snap is uniform.** Every world-space cursor coord that an op consumes passes through `snapWorld()`. No op carries its own snap logic.

## UI surfaces

- **Canvas-status strip** (below the canvas) — shows the active tool's default hint, an amber warning, or a red error. Owned by `web/src/ui/canvas-status.ts`. The toolbar carries no hint text.
- **Solver errors** — the readout shows `solver error`; the full traceback goes to `console.error("[solver]", …)`.
- **Fatal overlay** — the Pyodide boot-failure overlay (`#boot-overlay`) is reused by `main.ts`'s `window.onerror` handler when the geom kernel returns `invalid`. Tells the user to reload.
