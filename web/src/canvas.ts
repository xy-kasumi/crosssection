// Render the AuthoringShape with selection handles. The composed CoreShape
// (output of compose()) is what's drawn as the filled silhouette; handles
// are drawn from the AuthoringShape so they track the user's primitives.

import type { Shape as CoreShape } from "@core/shape.ts";
import type { AuthoringShape, Outline, Selection, Vec2 } from "./authoring.ts";
import { authoringBBox } from "./authoring.ts";

export interface View {
  // World→screen transform: screen = (world - origin) * scale + offset
  scale: number;       // px per world unit (mm)
  offsetX: number;     // px
  offsetY: number;     // px
  cssW: number;
  cssH: number;
}

export interface Handle {
  kind: "vertex" | "edgeMid" | "diskCenter" | "diskRadius" | "holeCenter" | "holeRadius";
  // Where on the AuthoringShape this handle lives:
  selection: Selection;
  // For vertex/edgeMid: index into the outline.
  index?: number;
  // World position of the handle.
  x: number;
  y: number;
}

const HANDLE_RADIUS_PX = 5;
const EDGE_HANDLE_RADIUS_PX = 4;

export function fitView(canvas: HTMLCanvasElement, shape: AuthoringShape): View {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
  }
  const bbox = authoringBBox(shape);
  if (!bbox) {
    return { scale: 1, offsetX: cssW / 2, offsetY: cssH / 2, cssW, cssH };
  }
  const w = Math.max(1e-6, bbox.maxX - bbox.minX);
  const h = Math.max(1e-6, bbox.maxY - bbox.minY);
  const margin = 0.18; // fraction of available size left as padding
  const scale = Math.min(cssW / w, cssH / h) * (1 - 2 * margin);
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  const offsetX = cssW / 2 - cx * scale;
  // Flip Y so +y points up
  const offsetY = cssH / 2 + cy * scale;
  return { scale, offsetX, offsetY, cssW, cssH };
}

export function worldToScreen(v: View, x: number, y: number): { sx: number; sy: number } {
  return { sx: x * v.scale + v.offsetX, sy: -y * v.scale + v.offsetY };
}

export function screenToWorld(v: View, sx: number, sy: number): Vec2 {
  return { x: (sx - v.offsetX) / v.scale, y: (v.offsetY - sy) / v.scale };
}

export function draw(
  canvas: HTMLCanvasElement,
  view: View,
  shape: AuthoringShape,
  composed: CoreShape | null,
  selection: Selection | null,
): Handle[] {
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, view.cssW, view.cssH);

  // Faint origin axes
  ctx.strokeStyle = "rgba(127,127,127,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const o = worldToScreen(view, 0, 0);
  ctx.moveTo(0, o.sy); ctx.lineTo(view.cssW, o.sy);
  ctx.moveTo(o.sx, 0); ctx.lineTo(o.sx, view.cssH);
  ctx.stroke();

  // Filled silhouette (the FEM-facing composed shape — what the solver sees)
  if (composed) {
    const path = new Path2D();
    for (const ring of composed) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]!;
        const s = worldToScreen(view, p.x, p.y);
        if (i === 0) path.moveTo(s.sx, s.sy); else path.lineTo(s.sx, s.sy);
      }
      path.closePath();
    }
    ctx.fillStyle = "rgba(80, 130, 230, 0.22)";
    ctx.fill(path, "evenodd");
    ctx.strokeStyle = "rgb(80, 130, 230)";
    ctx.lineWidth = 1.5;
    ctx.stroke(path);
  }

  // Selection-aware handles
  const handles: Handle[] = [];
  if (shape.kind === "disk") {
    if (selection?.kind === "disk") {
      pushDiskHandles(handles, shape.cx, shape.cy, shape.r);
    }
  } else {
    for (let i = 0; i < shape.outers.length; i++) {
      if (selection?.kind === "outer" && selection.index === i) {
        pushOutlineHandles(handles, shape.outers[i]!, { kind: "outer", index: i });
      }
    }
  }
  for (let i = 0; i < shape.holes.length; i++) {
    if (selection?.kind === "hole" && selection.index === i) {
      const h = shape.holes[i]!;
      if (h.kind === "circle") {
        pushHoleCircleHandles(handles, h.cx, h.cy, h.r, i);
      } else {
        pushOutlineHandles(handles, h.outline, { kind: "hole", index: i });
      }
    }
  }

  drawHandles(ctx, view, handles);
  return handles;
}

function pushDiskHandles(out: Handle[], cx: number, cy: number, r: number): void {
  out.push({ kind: "diskCenter", selection: { kind: "disk" }, x: cx, y: cy });
  out.push({ kind: "diskRadius", selection: { kind: "disk" }, x: cx + r, y: cy });
}

function pushHoleCircleHandles(out: Handle[], cx: number, cy: number, r: number, index: number): void {
  out.push({ kind: "holeCenter", selection: { kind: "hole", index }, x: cx, y: cy });
  out.push({ kind: "holeRadius", selection: { kind: "hole", index }, x: cx + r, y: cy });
}

function pushOutlineHandles(out: Handle[], outline: Outline, sel: Selection): void {
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

function drawHandles(ctx: CanvasRenderingContext2D, view: View, handles: Handle[]): void {
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
export function hitHandle(view: View, handles: Handle[], sx: number, sy: number): Handle | null {
  // Iterate in reverse so later (visually-on-top) handles win ties.
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
