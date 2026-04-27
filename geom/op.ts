// Op model — see docs/editor-model.md for the vocabulary and invariants.
//
// Phase D will fold the granular variants from the plan (move-vert,
// move-hole-center, translate-prim, ...) in alongside editor.ts being
// rewritten. Phase C just relocates the existing union from
// web/src/ops.ts.

import type { Vec2 } from "./shape.ts";

export type Op =
  | { kind: "paint-rect"; anchor: Vec2; cursor: Vec2 }
  | { kind: "erase-rect"; anchor: Vec2; cursor: Vec2 }
  | { kind: "add-hole";   center: Vec2; cursor: Vec2 }
  // Circle-hole center/radius drag, treated as remove-then-add at the new
  // (cx, cy, r). Same validity gate as add-hole, with the original hole
  // excluded from the collision check.
  | { kind: "move-hole";  index: number; cx: number; cy: number; r: number };

export type OpKind = Op["kind"];
