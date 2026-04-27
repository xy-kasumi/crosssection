// Zero-state landing carousel — paints the demo shapes in muted grey at a
// fixed view halfSpan and crossfades between them. Distinct from the rest
// of canvas/* in that it includes its own clear+grid+composite pass; the
// editor isn't driving render at all while this runs.
//
// The slot timing is a contract with the host (ViewAnimator runs the RAF;
// it computes the same `idx` to fire onShape callbacks in lockstep with
// what's visible).

import type { Shape as CoreShape } from "@core/shape.ts";
import { worldToScreen, type View } from "./index.ts";
import { drawGrid } from "./grid.ts";

export const ZERO_STATE_PERIOD = 2.5;  // seconds per shape (steady portion)
export const ZERO_STATE_FADE   = 0.5;  // crossfade window at the trailing edge
export const ZERO_STATE_SLOT   = ZERO_STATE_PERIOD + ZERO_STATE_FADE;
// halfSpan that comfortably contains every demo shape (largest is the 30 mm
// extrusion, max abs coord 15) on the engineering ladder.
export const ZERO_STATE_HALFSPAN = 20;

export function zeroStateIdx(tSeconds: number, n: number): number {
  if (n <= 0) return 0;
  const total = ZERO_STATE_SLOT * n;
  const tt = ((tSeconds % total) + total) % total;
  return Math.floor(tt / ZERO_STATE_SLOT);
}

export function drawZeroState(
  canvas: HTMLCanvasElement,
  view: View,
  shapes: CoreShape[],
  tSeconds: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, view.cssW, view.cssH);
  drawGrid(ctx, view);

  if (shapes.length === 0) return;
  const total = ZERO_STATE_SLOT * shapes.length;
  const tt = ((tSeconds % total) + total) % total;
  const idx = Math.floor(tt / ZERO_STATE_SLOT);
  const local = tt - idx * ZERO_STATE_SLOT;

  if (local > ZERO_STATE_PERIOD) {
    const f = (ZERO_STATE_SLOT - local) / ZERO_STATE_FADE; // 1 → 0 over fade
    drawDemoShape(ctx, view, shapes[idx]!, f);
    drawDemoShape(ctx, view, shapes[(idx + 1) % shapes.length]!, 1 - f);
  } else {
    drawDemoShape(ctx, view, shapes[idx]!, 1);
  }
}

function drawDemoShape(
  ctx: CanvasRenderingContext2D,
  view: View,
  shape: CoreShape,
  alpha: number,
): void {
  if (alpha <= 0) return;
  const path = new Path2D();
  for (const ring of shape) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!;
      const s = worldToScreen(view, p.x, p.y);
      if (i === 0) path.moveTo(s.sx, s.sy); else path.lineTo(s.sx, s.sy);
    }
    path.closePath();
  }
  ctx.fillStyle = `rgba(140, 140, 140, ${0.18 * alpha})`;
  ctx.fill(path, "evenodd");
  ctx.strokeStyle = `rgba(110, 110, 110, ${0.55 * alpha})`;
  ctx.lineWidth = 1.5;
  ctx.stroke(path);
}
