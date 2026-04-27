# Editor model — ubiquitous language

Mental model for the cross-section editor. New behavior should fit this
vocabulary; if it doesn't, extend the vocabulary first.

## Vocabulary

| term | definition |
|------|------------|
| **shape** | The whole edited object: an `AuthoringShape` — disk-or-outers + zero-or-more holes. |
| **prim** | A single addressable element of the shape: disk, outer ring, circle hole, polygon hole. The debug pane lists prims. |
| **selection** | A pointer to one prim. At most one selection at a time. |
| **op** | A user-initiated mutation. Has a kind, an in-flight config, and a lifecycle. |
| **op result** | Trichotomy of `previewOp(base, op)`: `ok` (commit cleanly, kind preserved), `warning` (committable, but lossy — today only "the affected circle becomes a polygon, you lose drag-center/radius"), `error` (cannot commit). |
| **preview** | What's shown while an op is in flight: the **candidate** shape (the op result, or `base` on error) plus an **op cursor** overlay indicating the gesture (rect ghost, circle ghost). The base AuthoringShape is never mutated mid-op. |
| **commit** | Apply the op result. Triggered by an explicit user signal (mouseup, second click, Enter). Runs on `ok` and `warning`; `error` discards. |
| **discard** | Drop the op without mutating the shape. Triggered by Esc, right-click, or a commit attempted on `error`. |

## Op kinds

All ops route through `previewOp` in `web/src/ops.ts`. That function is the
single source of truth for what each op does and which results it can
produce — the doc deliberately doesn't repeat it.

- `paint-rect` — toolbar Paint Rect, two clicks. Unions a rectangle into the outer.
- `erase-rect` — toolbar Erase Rect, two clicks. Subtracts a rectangle from the filled region; can split the outer (error) or consume circle holes (warning).
- `add-hole` — toolbar Add Hole, two clicks (center, circumference). Clean placement (entirely inside, no overlap) keeps a circle hole and preserves the AuthoringShape kind. Anything else (crosses outer, or overlaps an existing hole) → polygon-conversion: the bite is subtracted from the filled region and decomposed into a `PolygonShape`. If the bite touches the boundary the outer notches and no hole prim is created; if it doesn't, an emergent polygon hole appears. Warning emitted in either case. AuthoringShape becomes `polygon` whenever conversion happens.
- `move-hole` — drag a circle hole's center or radius handle. The op cursor (a circle ghost at the drag target) shows where the user is aiming; the displayed shape is the candidate from `previewOp(this.shape, move-hole, holeTarget)`. `this.shape` itself is **not** mutated until release, so the AuthoringShape stays sound the entire drag. Release behavior: `ok` or `warning` → commit the candidate; `error` → discard (nothing to revert).

## Invariants

These hold at all times. Load-bearing — code that violates them is broken.

1. **AuthoringShape is always sound.** `compose(this.shape)` returns `ok` after any commit and between ops. Mid-op, `this.shape` is never mutated — the on-canvas display is derived from `previewOp(this.shape, op).shape`, so polygon conversion (a `DiskShape` becoming a notched `PolygonShape`, a circle hole becoming a polygon) only ever happens at commit time.
2. **Circles can't represent arcs.** Whenever a boolean op would clip a circle outer or hole into an arc, the candidate must convert that prim to a polygon. The authoring model has no arc primitive. `add-hole`'s clipped/merged path enforces this by re-deriving the filled region (outer minus all hole footprints, minus the new bite) and decomposing — same machinery as `erase-rect`.
3. **Preview is the candidate.** What the user sees during an op is what commit would produce. No special-casing at commit that wasn't reflected in the preview.
4. **Snap is uniform.** Every world-space cursor coord that an op consumes passes through `snapWorld()`. No op carries its own snap logic.

## UI surfaces

- **Canvas-status strip** (below the canvas) — shows the active tool's default hint, an amber warning, or a red error. Owned by `web/src/ui/canvas-status.ts`. The toolbar carries no hint text.
- **Solver errors** — the readout shows `solver error`; the full traceback goes to `console.error("[solver]", …)`.
