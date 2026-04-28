// Preset constructors: starting shapes for the editor.

import { rectOutline } from "./internal.ts";
import type { DiskShape, PolygonShape } from "./shape.ts";

export function defaultDisk(): DiskShape {
  return rodOf(5);
}

export function rodOf(D: number): DiskShape {
  return { kind: "disk", cx: 0, cy: 0, r: D / 2, holes: [] };
}

// Hollow round. T is wall thickness; inner radius = D/2 − T.
export function pipeOf(D: number, T: number): DiskShape {
  return {
    kind: "disk", cx: 0, cy: 0, r: D / 2,
    holes: [{ kind: "circle", cx: 0, cy: 0, r: D / 2 - T }],
  };
}

export function rectShapeOf(W: number, H: number): PolygonShape {
  return { kind: "polygon", outers: [rectOutline(0, 0, W, H)], holes: [] };
}

// Hollow rect. T is wall thickness; inner cavity is (W − 2T) × (H − 2T).
export function boxOf(W: number, H: number, T: number): PolygonShape {
  return {
    kind: "polygon",
    outers: [rectOutline(0, 0, W, H)],
    holes: [{ kind: "polygon", outline: rectOutline(0, 0, W - 2 * T, H - 2 * T) }],
  };
}

// 20×20 T-slot extrusion profile, centered. Hand-authored snapshot — no
// parameters; replace the literal to retune the geometry.
export function extrusionOf(): PolygonShape {
  return {
    kind: "polygon",
    outers: [[
      { x: -10, y: -10 }, { x:  -3, y: -10 }, { x:  -3, y:  -8 }, { x:  -6, y:  -8 },
      { x:  -6, y:  -7 }, { x:  -3, y:  -4 }, { x:   3, y:  -4 }, { x:   6, y:  -7 },
      { x:   6, y:  -8 }, { x:   3, y:  -8 }, { x:   3, y: -10 }, { x:  10, y: -10 },
      { x:  10, y:  -3 }, { x:   8, y:  -3 }, { x:   8, y:  -6 }, { x:   7, y:  -6 },
      { x:   4, y:  -3 }, { x:   4, y:   3 }, { x:   7, y:   6 }, { x:   8, y:   6 },
      { x:   8, y:   3 }, { x:  10, y:   3 }, { x:  10, y:  10 }, { x:   3, y:  10 },
      { x:   3, y:   8 }, { x:   6, y:   8 }, { x:   6, y:   7 }, { x:   3, y:   4 },
      { x:  -3, y:   4 }, { x:  -6, y:   7 }, { x:  -6, y:   8 }, { x:  -3, y:   8 },
      { x:  -3, y:  10 }, { x: -10, y:  10 }, { x: -10, y:   3 }, { x:  -8, y:   3 },
      { x:  -8, y:   6 }, { x:  -7, y:   6 }, { x:  -4, y:   3 }, { x:  -4, y:  -3 },
      { x:  -7, y:  -6 }, { x:  -8, y:  -6 }, { x:  -8, y:  -3 }, { x: -10, y:  -3 },
    ]],
    holes: [{ kind: "circle", cx: 0, cy: 0, r: 2.195 }],
  };
}
