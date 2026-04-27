// Shape-edit engine: hit-testing, drag, vertex insert/delete, tool flow.
// Owns the canvas event listeners. Delegates all view/animation state to
// ViewAnimator — Editor itself doesn't know about RAF, halfSpan, or DPR.
//
// Coordinate boundary: this file is the only consumer that crosses world↔CSS.
// It receives mouse events in CSS px (getBoundingClientRect), calls
// screenToWorld at the boundary, and does all internal logic in world coords.

import type { AuthoringShape, Outline, Selection, Vec2 } from "./authoring.ts";
import {
  draw, hitHandle, screenToWorld, targetHalfSpan,
  type Handle, type ToolKind, type ToolPreview, type View,
} from "./canvas/index.ts";
import { previewOp, type Op, type OpResult } from "./ops.ts";
import { ViewAnimator } from "./view-animator.ts";
import type { Shape as CoreShape } from "@core/shape.ts";

// Tool state shipped to the host so the toolbar can light up the active
// button and show the right hint. Phase = whether we've captured the first
// click yet.
export interface ToolState {
  kind: ToolKind;
  phase: "wait-anchor" | "wait-end";
}

// Status of the in-flight op as far as the host needs to know. Drives the
// status strip below the canvas: gray hint when proposed, amber when the
// committable result carries a warning, red when the op would fail.
export type ToolStatus =
  | { level: "valid";   message: string | null }   // null = clear / use default hint
  | { level: "warning"; message: string }
  | { level: "error";   message: string };

export interface EditorCallbacks {
  onChange(): void;
  onSelectionChange(sel: Selection | null): void;
  onToolChange?(state: ToolState | null): void;
  // Fires when the in-flight op's validity changes. The host renders this
  // in the canvas-status strip.
  onToolStatus?(status: ToolStatus): void;
}

export class Editor {
  private readonly canvas: HTMLCanvasElement;
  private readonly cb: EditorCallbacks;
  private readonly animator: ViewAnimator;
  private shape: AuthoringShape;
  private composed: CoreShape | null = null;
  private selection: Selection | null = null;
  private handles: Handle[] = [];

  // Drag state. While set, refit() suppresses halfSpan changes — the user
  // shouldn't see the grid jumping mid-edit.
  private drag: null | { handle: Handle; lastWorld: Vec2 } = null;

  // Tool state. Mutually exclusive with drag — when a tool is active, the
  // canvas swallows clicks for tool placement (and ignores handles).
  // lastStatus is a memo to avoid re-firing the callback on every mousemove
  // for an unchanged value.
  private tool: { kind: ToolKind; anchor: Vec2 | null } | null = null;
  private lastStatus: ToolStatus = { level: "valid", message: null };
  private cursorWorld: Vec2 | null = null;
  private snap = true;

  constructor(canvas: HTMLCanvasElement, initial: AuthoringShape, cb: EditorCallbacks) {
    this.canvas = canvas;
    this.cb = cb;
    this.shape = initial;
    this.animator = new ViewAnimator(canvas, targetHalfSpan(initial), {
      onViewChange: () => this.render(),
    });
    this.attachListeners();
  }

  private get view(): View { return this.animator.view; }

  // ----- public API -----

  getShape(): AuthoringShape { return this.shape; }

  // refit:false skips the viewport refit — used while debouncing rapid
  // size-input typing, so the grid doesn't chase every keystroke. The shape
  // itself still updates immediately so the user can see what they typed.
  setShape(s: AuthoringShape, opts: { refit?: boolean } = {}): void {
    this.shape = s;
    this.selection = null;
    this.cb.onSelectionChange(null);
    if (opts.refit !== false) this.refit();
    else this.render();
    this.cb.onChange();
  }

  setComposed(composed: CoreShape | null): void {
    this.composed = composed;
    this.render();
  }

  getSelection(): Selection | null { return this.selection; }
  setSelection(sel: Selection | null): void {
    this.selection = sel;
    this.cb.onSelectionChange(sel);
    this.render();
  }

  setTool(kind: ToolKind | null): void {
    if (kind === null) {
      if (!this.tool) return;
      this.tool = null;
    } else {
      this.tool = { kind, anchor: null };
      this.selection = null;
      this.cb.onSelectionChange(null);
    }
    this.cb.onToolChange?.(this.toolStateForCb());
    this.render();
  }

  setSnap(enabled: boolean): void {
    this.snap = enabled;
    if (this.tool) this.render();
  }

  setZeroState(shapes: CoreShape[] | null, onShape?: (idx: number) => void): void {
    this.animator.setZeroState(shapes, onShape);
  }
  isZeroState(): boolean { return this.animator.isZeroState(); }

  // Refit the viewport to the current shape. Mid-drag we keep the grid put
  // (would yank under the user's cursor); otherwise tween halfSpan to the
  // shape's target.
  refit(): void {
    if (this.drag) {
      this.animator.refresh();
      return;
    }
    this.animator.tweenTo(targetHalfSpan(this.shape));
  }

  render(): void {
    if (this.animator.isZeroState()) return;
    let preview: ToolPreview | null = null;
    if (this.tool && this.cursorWorld) {
      const cursor = this.snapWorld(this.cursorWorld);
      // Pre-anchor (still picking the first corner) we have no op to
      // evaluate, so the ghost is shown as valid and the host shows the
      // default "click first corner" hint.
      let toolStatus: ToolStatus = { level: "valid", message: null };
      if (this.tool.anchor) {
        const op = makeOp(this.tool.kind, this.tool.anchor, cursor);
        toolStatus = statusFromResult(previewOp(this.shape, op));
      }
      preview = {
        kind: this.tool.kind, anchor: this.tool.anchor, cursor,
        snapping: this.snap,
        valid: toolStatus.level !== "error",
      };
      this.updateStatus(toolStatus);
    } else if (!this.drag) {
      // No tool, no drag → nothing to say. While a drag is in flight the
      // drag handler owns the status and we leave it alone.
      this.updateStatus({ level: "valid", message: null });
    }
    this.handles = draw(this.canvas, this.view, this.shape, this.composed, this.selection, preview);
  }

  private updateStatus(s: ToolStatus): void {
    if (s.level === this.lastStatus.level && s.message === this.lastStatus.message) return;
    this.lastStatus = s;
    this.cb.onToolStatus?.(s);
  }

  mutate(f: (s: AuthoringShape) => void): void {
    f(this.shape);
    this.cb.onChange();
    this.render();
  }

  // ----- internal -----

  private toolStateForCb(): ToolState | null {
    if (!this.tool) return null;
    return { kind: this.tool.kind, phase: this.tool.anchor ? "wait-end" : "wait-anchor" };
  }

  private snapWorld(p: Vec2): Vec2 {
    if (!this.snap) return p;
    const u = this.view.unit;
    return { x: Math.round(p.x / u) * u, y: Math.round(p.y / u) * u };
  }

  private attachListeners(): void {
    this.canvas.addEventListener("mousedown", this.onMouseDown);
    this.canvas.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
  }

  private screenFromEvent(ev: MouseEvent): { sx: number; sy: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { sx: ev.clientX - rect.left, sy: ev.clientY - rect.top };
  }

  private onMouseDown = (ev: MouseEvent): void => {
    if (this.isZeroState()) return;
    if (ev.button !== 0) return;
    const { sx, sy } = this.screenFromEvent(ev);
    // 0. Tool mode swallows clicks for 2-step prim placement.
    if (this.tool) {
      const w = this.snapWorld(screenToWorld(this.view, sx, sy));
      if (!this.tool.anchor) {
        this.tool.anchor = w;
        this.cb.onToolChange?.(this.toolStateForCb());
        this.render();
        return;
      }
      // Second click → commit on ok or warning (warnings are committable),
      // discard on error.
      const op = makeOp(this.tool.kind, this.tool.anchor, w);
      const result = previewOp(this.shape, op);
      this.tool = null;
      this.cb.onToolChange?.(null);
      this.updateStatus({ level: "valid", message: null });
      if (result.kind === "ok" || result.kind === "warning") {
        this.shape = result.shape;
        this.selection = result.preselect ?? null;
        this.cb.onSelectionChange(this.selection);
        this.cb.onChange();
        this.refit();
      }
      this.render();
      return;
    }
    // 1. If we hit a handle, start a handle drag.
    const hit = hitHandle(this.view, this.handles, sx, sy);
    if (hit) {
      // Edge-mid handle: insert a vertex first, then drag the new vertex.
      if (hit.kind === "edgeMid") {
        const newIdx = this.insertVertexAtEdge(hit);
        if (newIdx !== null) {
          this.render();
          const newVertex = this.handles.find(
            (h) => h.kind === "vertex" && sameSelection(h.selection, hit.selection) && h.index === newIdx,
          );
          if (newVertex) {
            this.drag = { handle: newVertex, lastWorld: screenToWorld(this.view, sx, sy) };
          }
        }
        return;
      }
      this.drag = { handle: hit, lastWorld: this.snapWorld(screenToWorld(this.view, sx, sy)) };
      return;
    }
    // 2. Hit-test prim interior. If interior of an unselected prim, select
    //    it. If already selected, start moving the whole prim.
    const w = screenToWorld(this.view, sx, sy);
    const sel = this.pickPrimAt(w);
    if (sel) {
      const sameAsBefore = this.selection && sameSelection(this.selection, sel);
      this.setSelection(sel);
      if (sameAsBefore) {
        const start = this.snapWorld(w);
        this.drag = {
          handle: { kind: "vertex", selection: sel, x: start.x, y: start.y, index: -1 }, // placeholder; index=-1 means whole-prim drag
          lastWorld: start,
        };
      }
    } else {
      this.setSelection(null);
    }
  };

  private onMouseMove = (ev: MouseEvent): void => {
    if (this.isZeroState()) return;
    const { sx, sy } = this.screenFromEvent(ev);
    this.cursorWorld = screenToWorld(this.view, sx, sy);
    if (this.tool) {
      this.render();
      return;
    }
    if (!this.drag) return;
    // Snap the cursor before deriving the drag step so vertex/center moves
    // and whole-prim translations both quantize to the grid when snap is on.
    // Whole-prim drag uses (dx, dy); per-handle drag uses absolute w. Both
    // need a snapped w for the geometry to land on grid intersections.
    const w = this.snapWorld(this.cursorWorld);
    const dx = w.x - this.drag.lastWorld.x;
    const dy = w.y - this.drag.lastWorld.y;
    if (dx === 0 && dy === 0) return; // cursor moved within a snap cell
    // applyDrag returns false if the proposed step is rejected (e.g. circle
    // hole would escape the outer). In that case keep lastWorld pinned so
    // the next step is computed against the actual unmoved geometry.
    if (this.applyDrag(this.drag.handle, w, dx, dy)) {
      this.drag.lastWorld = w;
      this.cb.onChange();
    }
    this.render();
  };

  private onMouseUp = (): void => {
    if (this.isZeroState()) return;
    if (this.drag) {
      this.drag = null;
      this.updateStatus({ level: "valid", message: null });
      // Shape extents may have changed mid-drag; refit now (animates).
      this.refit();
    }
  };

  private onContextMenu = (ev: MouseEvent): void => {
    ev.preventDefault();
    if (this.isZeroState()) return;
    // Right-click cancels an in-flight tool first; otherwise it deletes a
    // vertex under the cursor.
    if (this.tool) {
      this.tool = null;
      this.cb.onToolChange?.(null);
      this.render();
      return;
    }
    const { sx, sy } = this.screenFromEvent(ev);
    const hit = hitHandle(this.view, this.handles, sx, sy);
    if (hit && hit.kind === "vertex") {
      this.deleteVertex(hit);
      this.cb.onChange();
      this.render();
    }
  };

  private onKeyDown = (ev: KeyboardEvent): void => {
    if (this.isZeroState()) return;
    if (ev.key === "Escape" && this.tool) {
      this.tool = null;
      this.cb.onToolChange?.(null);
      this.render();
    }
  };

  // Returns true if the drag step was applied. Hole-circle drags route
  // through the op model and can refuse a step that would invalidate the
  // shape; everything else applies unconditionally.
  private applyDrag(h: Handle, world: Vec2, dx: number, dy: number): boolean {
    const sel = h.selection;
    switch (h.kind) {
      case "diskCenter": {
        if (this.shape.kind !== "disk") return false;
        this.shape.cx = world.x;
        this.shape.cy = world.y;
        return true;
      }
      case "diskRadius": {
        if (this.shape.kind !== "disk") return false;
        const r = Math.hypot(world.x - this.shape.cx, world.y - this.shape.cy);
        this.shape.r = Math.max(0.1, r);
        return true;
      }
      case "holeCenter": {
        if (sel.kind !== "hole") return false;
        const hole = this.shape.holes[sel.index];
        if (!hole || hole.kind !== "circle") return false;
        return this.tryMoveHole(sel.index, world.x, world.y, hole.r);
      }
      case "holeRadius": {
        if (sel.kind !== "hole") return false;
        const hole = this.shape.holes[sel.index];
        if (!hole || hole.kind !== "circle") return false;
        const r = Math.max(0.1, Math.hypot(world.x - hole.cx, world.y - hole.cy));
        return this.tryMoveHole(sel.index, hole.cx, hole.cy, r);
      }
      case "vertex": {
        // index === -1 means "interior drag of whole prim" (translate all vertices).
        const ol = this.outlineFor(sel);
        if (!ol) return false;
        if (h.index === -1) {
          for (const p of ol) { p.x += dx; p.y += dy; }
        } else if (h.index !== undefined) {
          const v = ol[h.index];
          if (v) { v.x = world.x; v.y = world.y; }
        }
        return true;
      }
      // edgeMid is handled by insertVertexAtEdge before drag starts; not reached here.
    }
    return false;
  }

  // Hole drag goes through previewOp(move-hole). Commit on ok; on warning
  // or error, hold the drag at the last valid position and surface the
  // status (so the user sees why the cursor isn't pulling the hole along).
  private tryMoveHole(index: number, cx: number, cy: number, r: number): boolean {
    const result = previewOp(this.shape, { kind: "move-hole", index, cx, cy, r });
    if (result.kind === "ok") {
      this.shape = result.shape;
      this.updateStatus({ level: "valid", message: null });
      return true;
    }
    this.updateStatus(statusFromResult(result));
    return false;
  }

  private insertVertexAtEdge(h: Handle): number | null {
    if (h.kind !== "edgeMid" || h.index === undefined) return null;
    const ol = this.outlineFor(h.selection);
    if (!ol) return null;
    const i = h.index;
    const p = ol[i]!;
    const q = ol[(i + 1) % ol.length]!;
    const mid: Vec2 = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    ol.splice(i + 1, 0, mid);
    return i + 1;
  }

  private deleteVertex(h: Handle): void {
    if (h.kind !== "vertex" || h.index === undefined) return;
    const ol = this.outlineFor(h.selection);
    if (!ol) return;
    if (ol.length <= 3) return; // keep at least a triangle
    ol.splice(h.index, 1);
  }

  private outlineFor(sel: Selection): Outline | null {
    if (sel.kind === "outer") {
      if (this.shape.kind !== "polygon") return null;
      return this.shape.outers[sel.index] ?? null;
    }
    if (sel.kind === "hole") {
      const hole = this.shape.holes[sel.index];
      if (!hole || hole.kind !== "polygon") return null;
      return hole.outline;
    }
    return null;
  }

  private pickPrimAt(w: Vec2): Selection | null {
    // Walk holes first (drawn on top), then outers/disk.
    for (let i = this.shape.holes.length - 1; i >= 0; i--) {
      const h = this.shape.holes[i]!;
      if (h.kind === "circle") {
        if (Math.hypot(w.x - h.cx, w.y - h.cy) <= h.r) return { kind: "hole", index: i };
      } else {
        if (pointInPolygon(w, h.outline)) return { kind: "hole", index: i };
      }
    }
    if (this.shape.kind === "disk") {
      if (Math.hypot(w.x - this.shape.cx, w.y - this.shape.cy) <= this.shape.r) {
        return { kind: "disk" };
      }
    } else {
      for (let i = this.shape.outers.length - 1; i >= 0; i--) {
        if (pointInPolygon(w, this.shape.outers[i]!)) return { kind: "outer", index: i };
      }
    }
    return null;
  }
}

function sameSelection(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "disk" || b.kind === "disk") return a.kind === b.kind;
  return (a as { index: number }).index === (b as { index: number }).index;
}

function makeOp(kind: ToolKind, anchor: Vec2, cursor: Vec2): Op {
  switch (kind) {
    case "paint-rect": return { kind: "paint-rect", anchor, cursor };
    case "erase-rect": return { kind: "erase-rect", anchor, cursor };
    case "add-hole":   return { kind: "add-hole", center: anchor, cursor };
  }
}

function statusFromResult(r: OpResult): ToolStatus {
  if (r.kind === "ok")      return { level: "valid",   message: null };
  if (r.kind === "warning") return { level: "warning", message: r.message };
  return { level: "error", message: r.reason };
}

function pointInPolygon(p: Vec2, poly: Outline): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = poly[i]!, pj = poly[j]!;
    const intersects = (pi.y > p.y) !== (pj.y > p.y) &&
      p.x < ((pj.x - pi.x) * (p.y - pi.y)) / ((pj.y - pi.y) || 1e-30) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}
