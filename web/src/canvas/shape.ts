// Filled silhouette (outer + holes via even-odd fill rule). The composed
// SolverShape is what the FEM solver sees, so this is also what the user sees
// — divergence here would be misleading.

import type { SolverShape } from "@solver/shape.ts";
import { worldToScreen, type View } from "./index.ts";

export function drawShape(
  ctx: CanvasRenderingContext2D,
  view: View,
  shape: SolverShape,
  opts: { faded?: boolean; invalid?: boolean } = {},
): void {
  const path = new Path2D();
  for (const ring of shape) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!;
      const s = worldToScreen(view, p.x, p.y);
      if (i === 0) path.moveTo(s.sx, s.sy); else path.lineTo(s.sx, s.sy);
    }
    path.closePath();
  }
  const fillAlpha = opts.faded ? 0.10 : 0.22;
  const strokeAlpha = opts.faded ? 0.45 : 1;
  // Invalid: same red as tool-preview's invalid state, so the user reads
  // "this won't commit" the same way regardless of where it surfaces.
  if (opts.invalid) {
    ctx.fillStyle = `rgba(220, 70, 60, ${fillAlpha})`;
    ctx.fill(path, "evenodd");
    ctx.strokeStyle = "rgb(220, 70, 60)";
    ctx.lineWidth = 2;
    ctx.stroke(path);
    return;
  }
  ctx.fillStyle = `rgba(80, 130, 230, ${fillAlpha})`;
  ctx.fill(path, "evenodd");
  ctx.strokeStyle = `rgba(80, 130, 230, ${strokeAlpha})`;
  ctx.lineWidth = 1.5;
  ctx.stroke(path);
}
