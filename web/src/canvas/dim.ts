// Translucent overlay covering "non-canonical" world regions during a
// symmetrize hover-preview. The polygons are world-space outlines (CCW);
// canvas-space conversion happens here so callers stay in world coords.

import type { Outline } from "@geom/index.ts";
import { worldToScreen, type View } from "./index.ts";

const DIM_FILL = "rgba(0, 0, 0, 0.10)";

export function drawDimRegion(
  ctx: CanvasRenderingContext2D,
  view: View,
  polygons: readonly Outline[],
): void {
  if (polygons.length === 0) return;
  const path = new Path2D();
  for (const ring of polygons) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!;
      const s = worldToScreen(view, p.x, p.y);
      if (i === 0) path.moveTo(s.sx, s.sy); else path.lineTo(s.sx, s.sy);
    }
    path.closePath();
  }
  ctx.fillStyle = DIM_FILL;
  ctx.fill(path);
}
