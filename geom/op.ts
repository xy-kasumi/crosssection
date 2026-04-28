// Op union — finer than UI gestures. Tool-driven gestures (paint-rect,
// erase-rect, add-hole) keep their anchor/cursor pair vocabulary. There's
// no whole-prim translate: circles move by their center handle, polygons
// by their vertices.

import type { Selection, Vec2 } from "./shape.ts";

export type Op =
  // Tool gestures
  | { kind: "paint-rect"; anchor: Vec2; cursor: Vec2 }
  | { kind: "erase-rect"; anchor: Vec2; cursor: Vec2 }
  | { kind: "add-hole";   center: Vec2; cursor: Vec2 }
  // Vertex-level edits (any polygon outline)
  | { kind: "move-vert";   sel: Selection; index: number; target: Vec2 }
  | { kind: "delete-vert"; sel: Selection; index: number }
  // Disk primitive
  | { kind: "move-disk-center"; target: Vec2 }
  | { kind: "move-disk-radius"; r: number }
  // Circle-hole primitive (move treated as remove-then-add at the new
  // center/radius — polygonization on outer-cross is handled by the
  // shared add-hole pipeline).
  | { kind: "move-hole-center"; index: number; target: Vec2 }
  | { kind: "move-hole-radius"; index: number; r: number };

export type OpKind = Op["kind"];
