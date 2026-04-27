// Ghost preview while a tool is mid-flow. Paint = green solid; Erase = red
// dashed; Add Hole = red dashed circle. A small "+" indicator at the
// quantized cursor signals when snap-to-grid is active.

import { worldToScreen, type ToolPreview, type View } from "./index.ts";

export function drawToolPreview(ctx: CanvasRenderingContext2D, view: View, p: ToolPreview): void {
  const isErase = p.kind !== "paint-rect";
  const stroke = isErase ? "rgb(220, 70, 60)" : "rgb(40, 160, 80)";
  const fill   = isErase ? "rgba(220, 70, 60, 0.10)" : "rgba(40, 160, 80, 0.10)";
  const cs = worldToScreen(view, p.cursor.x, p.cursor.y);
  const as = p.anchor ? worldToScreen(view, p.anchor.x, p.anchor.y) : null;

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;

  if (p.kind === "paint-rect" || p.kind === "erase-rect") {
    if (as) {
      const x = Math.min(as.sx, cs.sx), y = Math.min(as.sy, cs.sy);
      const w = Math.abs(as.sx - cs.sx), h = Math.abs(as.sy - cs.sy);
      if (isErase) ctx.setLineDash([5, 4]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
  } else { // add-hole: anchor is center, cursor sets radius
    if (as) {
      const r = Math.hypot(cs.sx - as.sx, cs.sy - as.sy);
      ctx.beginPath();
      ctx.arc(as.sx, as.sy, r, 0, Math.PI * 2);
      ctx.setLineDash([5, 4]);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      drawDot(ctx, as.sx, as.sy, stroke);
    }
  }

  drawDot(ctx, cs.sx, cs.sy, stroke);

  if (p.snapping) {
    ctx.strokeStyle = "rgba(80,80,80,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cs.sx - 6, cs.sy); ctx.lineTo(cs.sx + 6, cs.sy);
    ctx.moveTo(cs.sx, cs.sy - 6); ctx.lineTo(cs.sx, cs.sy + 6);
    ctx.stroke();
  }
}

function drawDot(ctx: CanvasRenderingContext2D, sx: number, sy: number, color: string): void {
  ctx.beginPath();
  ctx.arc(sx, sy, 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}
