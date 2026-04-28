// Selection handles: render + hit-test. Disk has center + radius handles;
// outlines have a vertex handle per ring vertex. Hit-testing uses CSS px
// so the click radius is consistent regardless of zoom level.

import type { Outline, Selection } from "@geom/index.ts";
import { worldToScreen, type Handle, type View } from "./index.ts";

const HANDLE_RADIUS_PX = 5;
const HIT_RADIUS_PX = HANDLE_RADIUS_PX + 4;

export function pushDiskHandles(out: Handle[], cx: number, cy: number, r: number): void {
  out.push({ kind: "diskCenter", selection: { kind: "disk" }, x: cx, y: cy });
  out.push({ kind: "diskRadius", selection: { kind: "disk" }, x: cx + r, y: cy });
}

export function pushHoleCircleHandles(out: Handle[], cx: number, cy: number, r: number, index: number): void {
  out.push({ kind: "holeCenter", selection: { kind: "hole", index }, x: cx, y: cy });
  out.push({ kind: "holeRadius", selection: { kind: "hole", index }, x: cx + r, y: cy });
}

export function pushOutlineHandles(out: Handle[], outline: Outline, sel: Selection): void {
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]!;
    out.push({ kind: "vertex", selection: sel, index: i, x: p.x, y: p.y });
  }
}

export function drawHandles(ctx: CanvasRenderingContext2D, view: View, handles: Handle[]): void {
  for (const h of handles) {
    const s = worldToScreen(view, h.x, h.y);
    ctx.beginPath();
    ctx.arc(s.sx, s.sy, HANDLE_RADIUS_PX, 0, Math.PI * 2);
    ctx.fillStyle = "rgb(60, 150, 200)";
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// Pick the topmost handle within radius of the given screen position.
// Iterates in reverse so later (visually-on-top) handles win ties.
export function hitHandle(view: View, handles: Handle[], sx: number, sy: number): Handle | null {
  let best: Handle | null = null;
  let bestDist = Infinity;
  for (let i = handles.length - 1; i >= 0; i--) {
    const h = handles[i]!;
    const s = worldToScreen(view, h.x, h.y);
    const d = Math.hypot(s.sx - sx, s.sy - sy);
    if (d <= HIT_RADIUS_PX && d < bestDist) {
      best = h;
      bestDist = d;
    }
  }
  return best;
}
