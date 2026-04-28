// Canvas rendering — public surface and the world↔CSS coordinate boundary.
//
// **Coordinate-system invariant**: only this file and editor.ts cross between
// world (mm, y-up) and CSS pixels (y-down). Everything in canvas/* takes a
// `View` and emits CSS pixels — the submodules don't reverse the transform
// themselves, they call `worldToScreen` from here.
//
// Three coordinate systems exist:
//   1. World (mm)        — what @geom speaks (Vec2 = {x, y}, y-up)
//   2. CSS pixels        — what the user clicks ({sx, sy}, y-down)
//   3. Backing-store px  — cssPx × devicePixelRatio. Only `makeView` (which
//                          sizes canvas.width/height) and the per-frame
//                          `ctx.setTransform(dpr,...)` know about this.

import type { SolverShape } from "@solver/shape.ts";
import type { AuthoringShape, Outline, Selection, Vec2 } from "@geom/index.ts";

import { drawDimRegion } from "./dim.ts";
import { drawGrid } from "./grid.ts";
import { drawShape } from "./shape.ts";
import { drawHandles, pushDiskHandles, pushHoleCircleHandles, pushOutlineHandles } from "./handles.ts";
import { drawToolPreview } from "./tool-preview.ts";

export { targetHalfSpan, unitForSpan } from "./grid.ts";
export { hitHandle } from "./handles.ts";
export { ZERO_STATE_PERIOD, ZERO_STATE_FADE, ZERO_STATE_SLOT, ZERO_STATE_HALFSPAN, zeroStateIdx, drawZeroState } from "./zero-state.ts";

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
  kind: "vertex" | "diskCenter" | "diskRadius" | "holeCenter" | "holeRadius";
  selection: Selection;
  // For vertex: index into the outline.
  index?: number;
  // World position of the handle.
  x: number;
  y: number;
}

export type ToolKind = "paint-rect" | "erase-rect" | "add-hole";

// What the canvas draws as a ghost while a tool is mid-operation. anchor=null
// means waiting for the first click — we still draw the cursor dot (and snap
// indicator) to give immediate feedback on placement. `valid` reflects
// whether committing the op now would succeed; when false, the ghost is
// drawn in an "invalid" style so the user sees the bad state in real time.
export interface ToolPreview {
  kind: ToolKind;
  anchor: Vec2 | null;
  cursor: Vec2;
  snapping: boolean;
  valid: boolean;
}

const CANVAS_INSET_PX = 24;     // visual inset around grid for labels/breathing room

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
    unit: unitForSpanInner(halfSpan),
  };
}

// Local copy to avoid the cyclic re-export above; identical to grid.ts's
// unitForSpan but kept here so makeView is self-contained.
function unitForSpanInner(halfSpan: number): number {
  return Math.pow(10, Math.floor(Math.log10(halfSpan / 5)));
}

export function worldToScreen(v: View, x: number, y: number): { sx: number; sy: number } {
  return { sx: x * v.scale + v.offsetX, sy: -y * v.scale + v.offsetY };
}

export function screenToWorld(v: View, sx: number, sy: number): Vec2 {
  return { x: (sx - v.offsetX) / v.scale, y: (v.offsetY - sy) / v.scale };
}

// Top-level paint orchestrator: clears the canvas, draws grid, silhouette,
// handles or tool preview, and returns the up-to-date handle list (used by
// the editor for hit-testing on the next click).
export function draw(
  canvas: HTMLCanvasElement,
  view: View,
  shape: AuthoringShape,
  composed: SolverShape | null,
  selection: Selection | null,
  toolPreview: ToolPreview | null = null,
  dragCursor: Vec2 | null = null,
  dimRegions: readonly Outline[] | null = null,
): Handle[] {
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, view.cssW, view.cssH);

  drawGrid(ctx, view);

  if (dimRegions && dimRegions.length > 0) drawDimRegion(ctx, view, dimRegions);

  // Filled silhouette (the FEM-facing composed shape). Faded while a tool is
  // active so the new prim can sit visually on top without dissolving into
  // the existing shape.
  if (composed) drawShape(ctx, view, composed, { faded: toolPreview !== null });

  // Selection-aware handles. Hidden while a tool is active — the ghost owns
  // the visual focus, and stray handles would invite stray clicks.
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

  if (dragCursor) {
    const s = worldToScreen(view, dragCursor.x, dragCursor.y);
    ctx.beginPath();
    ctx.arc(s.sx, s.sy, 3, 0, Math.PI * 2);
    ctx.fillStyle = "rgb(80, 130, 230)";
    ctx.fill();
  }

  return handles;
}
