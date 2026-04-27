// Preset constructors: starting shapes for the editor.

import { rectOutline } from "./internal.ts";
import type { DiskShape, PolygonShape } from "./shape.ts";

export function defaultDisk(): DiskShape {
  return rodOf(5);
}

export function rodOf(D: number): DiskShape {
  return { kind: "disk", cx: 0, cy: 0, r: D / 2, holes: [] };
}

export function rectShapeOf(W: number, H: number): PolygonShape {
  return { kind: "polygon", outers: [rectOutline(0, 0, W, H)], holes: [] };
}

// T-slot extrusion. S is the model number (e.g. 2020 → 20×20 mm). Geometry is
// a placeholder (hollow square with 2 mm wall) — recognizable in silhouette
// but not the actual T-slot profile. Refine when the broader UX lands.
export function extrusionOf(S: number): PolygonShape {
  const W = Math.max(5, Math.floor(S / 100));
  const H = Math.max(5, S % 100);
  const t = 2;
  return {
    kind: "polygon",
    outers: [rectOutline(0, 0, W, H)],
    holes: [{ kind: "polygon", outline: rectOutline(0, 0, W - 2 * t, H - 2 * t) }],
  };
}
