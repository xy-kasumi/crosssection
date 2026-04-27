// Op union — finer than UI gestures; one mousemove may issue several Ops.
// Every positional field is a Vec2 or scalar; no loose cx/cy/x/y.
//
// Phase B: skeleton union only. Phase C populates apply() against these.

import type { Selection, Vec2 } from "./shape.ts";

export type Op =
  | { readonly kind: "paint-rect"; readonly p0: Vec2; readonly p1: Vec2 }
  | { readonly kind: "erase-rect"; readonly p0: Vec2; readonly p1: Vec2 }
  | { readonly kind: "add-hole"; readonly center: Vec2; readonly r: number }
  | { readonly kind: "move-vert"; readonly sel: Selection; readonly index: number; readonly target: Vec2 }
  | { readonly kind: "move-hole-center"; readonly index: number; readonly target: Vec2 }
  | { readonly kind: "move-hole-radius"; readonly index: number; readonly r: number }
  | { readonly kind: "move-disk-center"; readonly target: Vec2 }
  | { readonly kind: "move-disk-radius"; readonly r: number }
  | { readonly kind: "translate-prim"; readonly sel: Selection; readonly delta: Vec2 }
  | { readonly kind: "delete-vert"; readonly sel: Selection; readonly index: number }
  | { readonly kind: "insert-vert"; readonly sel: Selection; readonly afterIndex: number };
