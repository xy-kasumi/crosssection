// Selection handles: render + hit-test. Disk has center + radius handles;
// outlines have a vertex handle + an edge-mid handle (click-to-insert) per
// segment. Hit-testing uses CSS px so the click radius is consistent
// regardless of zoom level.

import type { Outline, Selection } from "@geom/index.ts";
import { worldToScreen, type Handle, type View } from "./index.ts";

const HANDLE_RADIUS_PX = 5;
const EDGE_HANDLE_RADIUS_PX = 4;

export function pushDiskHandles(out: Handle[], cx: number, cy: number, r: number): void {
  out.push({ kind: "diskCenter", selection: { kind: "disk" }, x: cx, y: cy });
  out.push({ kind: "diskRadius", selection: { kind: "disk" }, x: cx + r, y: cy });
}

export function pushHoleCircleHandles(out: Handle[], cx: number, cy: number, r: number, index: number): void {
  out.push({ kind: "holeCenter", selection: { kind: "hole", index }, x: cx, y: cy });
  out.push({ kind: "holeRadius", selection: { kind: "hole", index }, x: cx + r, y: cy });
}

export function pushOutlineHandles(out: Handle[], outline: Outline, sel: Selection): void {
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const p = outline[i]!;
    out.push({ kind: "vertex", selection: sel, index: i, x: p.x, y: p.y });
    const q = outline[(i + 1) % n]!;
    out.push({
      kind: "edgeMid",
      selection: sel,
      index: i,
      x: (p.x + q.x) / 2,
      y: (p.y + q.y) / 2,
    });
  }
}

export function drawHandles(ctx: CanvasRenderingContext2D, view: View, handles: Handle[]): void {
  for (const h of handles) {
    const s = worldToScreen(view, h.x, h.y);
    if (h.kind === "edgeMid") {
      // Hollow handle for "insert vertex"
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, EDGE_HANDLE_RADIUS_PX, 0, Math.PI * 2);
      ctx.fillStyle = "white";
      ctx.fill();
      ctx.strokeStyle = "rgb(80, 130, 230)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      // Solid handle
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, HANDLE_RADIUS_PX, 0, Math.PI * 2);
      ctx.fillStyle = "rgb(80, 130, 230)";
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
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
    const r = h.kind === "edgeMid" ? EDGE_HANDLE_RADIUS_PX + 3 : HANDLE_RADIUS_PX + 4;
    if (d <= r && d < bestDist) {
      best = h;
      bestDist = d;
    }
  }
  return best;
}
