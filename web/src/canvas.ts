// Render the AuthoringShape with selection handles. The composed CoreShape
// (output of compose()) is what's drawn as the filled silhouette; handles
// are drawn from the AuthoringShape so they track the user's primitives.
//
// Grid: centered on origin. The half-span (one side of the grid) snaps to
// engineering values {1,2,5} × 10^k that comfortably contain the shape;
// the minor unit is unitForSpan(halfSpan) (always a power of 10). When
// halfSpan/unit > 5, every 5th minor line gets emphasized as a major line.

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
  halfSpan: number;    // grid extent (mm), one side
  unit: number;        // minor line spacing (mm)
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

export type ToolKind = "paint-rect" | "erase-rect" | "add-hole";

// What the canvas draws as a ghost while a tool is mid-operation.
// Anchor=null means waiting for the first click — we still draw the cursor
// dot (and snap indicator) to give immediate feedback on placement.
export interface ToolPreview {
  kind: ToolKind;
  anchor: Vec2 | null;
  cursor: Vec2;
  snapping: boolean;
}

const HANDLE_RADIUS_PX = 5;
const EDGE_HANDLE_RADIUS_PX = 4;
const FIT_MARGIN = 1.15;        // halfSpan must be >= FIT_MARGIN * max abs world coord
const CANVAS_INSET_PX = 24;     // visual inset around grid for labels/breathing room

// Engineering ladder (1, 2, 5 per decade) for halfSpan choices.
const ENG_SPANS: number[] = (() => {
  const out: number[] = [];
  for (let p = -3; p <= 4; p++) for (const m of [1, 2, 5]) out.push(m * Math.pow(10, p));
  out.sort((a, b) => a - b);
  return out;
})();

export function targetHalfSpan(shape: AuthoringShape): number {
  const bbox = authoringBBox(shape);
  if (!bbox) return 5;
  const m = Math.max(Math.abs(bbox.minX), Math.abs(bbox.maxX), Math.abs(bbox.minY), Math.abs(bbox.maxY));
  const want = Math.max(0.05, m * FIT_MARGIN);
  for (const s of ENG_SPANS) if (s >= want) return s;
  return ENG_SPANS[ENG_SPANS.length - 1]!;
}

export function unitForSpan(halfSpan: number): number {
  // Choose the largest power-of-10 unit such that halfSpan/unit ≥ 5
  // (i.e. at least 5 minor lines per side).
  return Math.pow(10, Math.floor(Math.log10(halfSpan / 5)));
}

export function makeView(canvas: HTMLCanvasElement, halfSpan: number): View {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
  }
  const cssMin = Math.min(cssW, cssH);
  const innerPx = Math.max(1, cssMin - 2 * CANVAS_INSET_PX);
  const scale = innerPx / (2 * halfSpan);
  return {
    scale,
    offsetX: cssW / 2,
    offsetY: cssH / 2,
    cssW, cssH, halfSpan,
    unit: unitForSpan(halfSpan),
  };
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
  toolPreview: ToolPreview | null = null,
): Handle[] {
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, view.cssW, view.cssH);

  drawGrid(ctx, view);

  // Filled silhouette (the FEM-facing composed shape). Faded while a tool
  // is active so the new prim can sit visually on top without dissolving
  // into the existing shape.
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
    const alpha = toolPreview ? 0.10 : 0.22;
    const strokeAlpha = toolPreview ? 0.45 : 1;
    ctx.fillStyle = `rgba(80, 130, 230, ${alpha})`;
    ctx.fill(path, "evenodd");
    ctx.strokeStyle = `rgba(80, 130, 230, ${strokeAlpha})`;
    ctx.lineWidth = 1.5;
    ctx.stroke(path);
  }

  // Selection-aware handles. Hidden while a tool is active — the ghost
  // owns the visual focus, and stray handles would invite stray clicks.
  const handles: Handle[] = [];
  if (!toolPreview) {
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
  }

  if (toolPreview) drawToolPreview(ctx, view, toolPreview);

  return handles;
}

// Zero-state landing: no real shape yet, just a slow crossfade through a few
// preset cross-sections in muted grey. The point is to (a) absorb Pyodide
// boot time without showing a useless "—" readout, and (b) telegraph what
// kinds of shapes this tool is for. Colour is deliberately desaturated so it
// doesn't look editable.
//
// The slot timing is a shared contract: the host (editor) computes the same
// `idx` to fire onShape callbacks in lockstep with the visible shape.
export const ZERO_STATE_PERIOD = 2.5;  // seconds per shape (steady portion)
export const ZERO_STATE_FADE = 0.5;    // crossfade window at the trailing edge
export const ZERO_STATE_SLOT = ZERO_STATE_PERIOD + ZERO_STATE_FADE;

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

function drawToolPreview(ctx: CanvasRenderingContext2D, view: View, p: ToolPreview): void {
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

function drawGrid(ctx: CanvasRenderingContext2D, view: View): void {
  const { halfSpan, unit, scale, offsetX, offsetY, cssW, cssH } = view;
  const minorN = Math.round(halfSpan / unit);   // lines per side
  const majorEvery = 5;
  const showMajor = minorN > majorEvery;

  const hLineXs: number[] = []; // vertical minor (x = i*unit)
  const vLineYs: number[] = []; // horizontal minor (y = i*unit)
  const majXs: number[] = [];
  const majYs: number[] = [];

  for (let i = -minorN; i <= minorN; i++) {
    const isAxis = i === 0;
    const isMajor = showMajor && i % majorEvery === 0 && !isAxis;
    if (isAxis) continue; // axes drawn separately at higher contrast
    const w = i * unit;
    const sx = offsetX + w * scale;
    const sy = offsetY - w * scale;
    if (isMajor) { majXs.push(sx); majYs.push(sy); }
    else         { hLineXs.push(sx); vLineYs.push(sy); }
  }

  const drawLines = (xs: number[], ys: number[], stroke: string, width: number): void => {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const sx of xs) { ctx.moveTo(sx, 0); ctx.lineTo(sx, cssH); }
    for (const sy of ys) { ctx.moveTo(0, sy); ctx.lineTo(cssW, sy); }
    ctx.stroke();
  };

  drawLines(hLineXs, vLineYs, "rgba(127,127,127,0.10)", 1);
  if (showMajor) drawLines(majXs, majYs, "rgba(127,127,127,0.22)", 1);

  // Axes (origin lines): slightly stronger.
  ctx.strokeStyle = "rgba(127,127,127,0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(offsetX, 0); ctx.lineTo(offsetX, cssH);
  ctx.moveTo(0, offsetY); ctx.lineTo(cssW, offsetY);
  ctx.stroke();

  // Tick numbers: every minor when there are no majors, every major otherwise.
  // Skip 0 (axis intersection) and the outermost tick (overlaps the X/Y label).
  const tickStep = showMajor ? majorEvery : 1;
  ctx.fillStyle = "rgba(80,80,80,0.7)";
  ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
  for (let i = -minorN + 1; i <= minorN - 1; i++) {
    if (i === 0 || i % tickStep !== 0) continue;
    const w = i * unit;
    const sx = offsetX + w * scale;
    const sy = offsetY - w * scale;
    // Number along X axis: just below the axis line.
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(formatTick(w), sx, offsetY + 3);
    // Number along Y axis: just to the left of the axis line.
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatTick(w), offsetX - 4, sy);
  }

  // Axis labels at the ends of the axes.
  ctx.fillStyle = "rgba(80,80,80,0.85)";
  ctx.font = "italic 12px ui-monospace, SFMono-Regular, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("X", cssW - 4, offsetY - 8);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("Y", offsetX + 10, 4);

  // Unit marker, bottom-right.
  ctx.fillStyle = "rgba(80,80,80,0.6)";
  ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("mm", cssW - 6, cssH - 6);
}

function formatTick(v: number): string {
  if (Number.isInteger(v)) return String(v);
  // Trim trailing zeros / dangling dot so 0.10 → "0.1", 1.00 → "1".
  return v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
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
