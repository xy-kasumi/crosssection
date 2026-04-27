// Op union — finer than UI gestures. One mousemove may issue several Ops
// (e.g. an edge-mid click expands to insert-vert + move-vert).
//
// Tool-driven gestures (paint-rect, erase-rect, add-hole) keep their
// anchor/cursor pair vocabulary. Drag-derived ops are base-relative: the
// editor captures dragStartShape + dragStartCursor on mousedown and feeds
// each frame's cumulative delta back through apply() against the captured
// base. That's why translate-prim takes `delta` (cumulative) rather than a
// per-frame step.

import type { Selection, Vec2 } from "./shape.ts";

export type Op =
  // Tool gestures
  | { kind: "paint-rect"; anchor: Vec2; cursor: Vec2 }
  | { kind: "erase-rect"; anchor: Vec2; cursor: Vec2 }
  | { kind: "add-hole";   center: Vec2; cursor: Vec2 }
  // Vertex-level edits (any polygon outline)
  | { kind: "move-vert";   sel: Selection; index: number; target: Vec2 }
  | { kind: "delete-vert"; sel: Selection; index: number }
  | { kind: "insert-vert"; sel: Selection; afterIndex: number }
  // Disk primitive
  | { kind: "move-disk-center"; target: Vec2 }
  | { kind: "move-disk-radius"; r: number }
  // Circle-hole primitive (move treated as remove-then-add at the new
  // center/radius — polygonization on outer-cross is handled by the
  // shared add-hole pipeline).
  | { kind: "move-hole-center"; index: number; target: Vec2 }
  | { kind: "move-hole-radius"; index: number; r: number }
  // Whole-prim translate. Delta is cumulative from the gesture's start —
  // not per-frame — so each frame's apply() against dragStartShape is
  // trivially associative.
  | { kind: "translate-prim"; sel: Selection; delta: Vec2 };

export type OpKind = Op["kind"];
