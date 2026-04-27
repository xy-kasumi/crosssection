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
| **op result** | Trichotomy of `previewOp(base, op)`: `ok` (commit cleanly), `warning` (committable, but lossy — today only "circle hole becomes polygon, you lose drag-center/radius"), `error` (cannot commit). |
| **preview** | Visual feedback while the op is in flight: a draft authoring shape under the canvas + a tool ghost on top. |
| **commit** | Apply the op result. Triggered by an explicit user signal (mouseup, second click, Enter). Runs on `ok` and `warning`; `error` discards. |
| **discard** | Drop the op without mutating the shape. Triggered by Esc, right-click, or a commit attempted on `error`. |

## Op kinds

All ops route through `previewOp` in `web/src/ops.ts`. That function is the
single source of truth for what each op does and which results it can
produce — the doc deliberately doesn't repeat it.

- `paint-rect` — toolbar Paint Rect, two clicks. Unions a rectangle into the outer.
- `erase-rect` — toolbar Erase Rect, two clicks. Subtracts a rectangle from the filled region; can split the outer (error) or consume circle holes (warning).
- `add-hole` — toolbar Add Hole, two clicks (center, circumference). Adds a circle hole; warns + converts to polygon on outer-crossing or hole-overlap.
- `move-hole` — drag a circle hole's center or radius handle. Remove + add at the new placement, same validity gate as `add-hole`. The drag commits on `ok` and stalls on warning/error so the live drag handles stay valid.

## Invariants

These hold at all times. Load-bearing — code that violates them is broken.

1. **The shape is always composable.** `compose(shape)` returns `ok` for the live shape after any commit, and therefore between ops. Op preview computes a candidate; commit runs only on `ok` or `warning` results, both of which are composable by construction.
2. **Op preview is pure.** Building the candidate never edits the base shape. Esc / right-click / commit-on-error all leave the shape exactly as it was before the op started.
3. **Snap is uniform.** Every world-space cursor coord that an op consumes passes through `snapWorld()`. No op carries its own snap logic.
4. **Preview is honest.** What the user sees during the op is what commit would produce. No special-casing at commit time that wasn't reflected in the preview.

## UI surfaces

- **Canvas-status strip** (below the canvas) — shows the active tool's default hint, an amber warning, or a red error. Owned by `web/src/ui/canvas-status.ts`. The toolbar carries no hint text.
- **Solver errors** — the readout shows `solver error`; the full traceback goes to `console.error("[solver]", …)`.
