// Cross-section canvas renderer. Draws polygon-with-holes (Shape) scaled to fit
// the canvas with a small padding margin. Outline only — no mesh.

import type { Shape } from "@core/shape.ts";

export function drawShape(canvas: HTMLCanvasElement, shape: Shape): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // High-DPI scaling
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  if (shape.length === 0) return;

  // Compute bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of shape) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w === 0 || h === 0) return;

  // Fit with 12% margin on the smaller axis
  const margin = 0.12;
  const scale = Math.min(cssW / w, cssH / h) * (1 - 2 * margin);
  const offX = cssW / 2 - ((minX + maxX) / 2) * scale;
  // Flip Y so +y points up (standard engineering)
  const offY = cssH / 2 + ((minY + maxY) / 2) * scale;

  // Draw a centerline cross at the centroid (light)
  ctx.strokeStyle = "rgba(127,127,127,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, offY);
  ctx.lineTo(cssW, offY);
  ctx.moveTo(cssW / 2 + offX - cssW / 2, 0);
  ctx.lineTo(cssW / 2 + offX - cssW / 2, cssH);
  // Centroid axes — center on shape bbox for simplicity
  ctx.stroke();

  // Build path from outer + holes (even-odd fill rule handles holes)
  const path = new Path2D();
  for (const ring of shape) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!;
      const x = offX + p.x * scale;
      const y = offY - p.y * scale;
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    }
    path.closePath();
  }

  // Fill with translucent material color
  ctx.fillStyle = "rgba(80, 130, 230, 0.2)";
  ctx.fill(path, "evenodd");

  // Stroke outline
  ctx.strokeStyle = "rgb(80, 130, 230)";
  ctx.lineWidth = 1.5;
  ctx.stroke(path);
}
