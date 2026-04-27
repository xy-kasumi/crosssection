// Editor interactions: hit-testing, drag, vertex insert/delete on the
// AuthoringShape. Owns the canvas event listeners and emits a callback
// whenever the shape changes (which main.ts uses to recompose + solve).

import type { AuthoringShape, Outline, Selection, Vec2 } from "./authoring.ts";
import {
  draw,
  fitView,
  hitHandle,
  screenToWorld,
  type Handle,
  type View,
} from "./canvas.ts";
import type { Shape as CoreShape } from "@core/shape.ts";

export interface EditorCallbacks {
  onChange(): void;
  onSelectionChange(sel: Selection | null): void;
}

export class Editor {
  private canvas: HTMLCanvasElement;
  private cb: EditorCallbacks;
  private shape: AuthoringShape;
  private composed: CoreShape | null = null;
  private selection: Selection | null = null;
  private view: View;
  private handles: Handle[] = [];

  // Drag state
  private drag: null | {
    handle: Handle;
    // For interior drag of an entire prim: lastWorld position
    lastWorld: Vec2;
  } = null;

  constructor(canvas: HTMLCanvasElement, initial: AuthoringShape, cb: EditorCallbacks) {
    this.canvas = canvas;
    this.cb = cb;
    this.shape = initial;
    this.view = fitView(canvas, initial);
    this.attachListeners();
  }

  // ----- public API -----

  getShape(): AuthoringShape { return this.shape; }

  setShape(s: AuthoringShape): void {
    this.shape = s;
    this.selection = null;
    this.cb.onSelectionChange(null);
    this.refit();
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

  // Refit the viewport to the current shape (call when shape extents change).
  refit(): void {
    this.view = fitView(this.canvas, this.shape);
    this.render();
  }

  render(): void {
    this.handles = draw(this.canvas, this.view, this.shape, this.composed, this.selection);
  }

  // ----- mutation helpers (used by main.ts buttons too) -----

  mutate(f: (s: AuthoringShape) => void): void {
    f(this.shape);
    this.cb.onChange();
    this.render();
  }

  // ----- internal: event handling -----

  private attachListeners(): void {
    this.canvas.addEventListener("mousedown", this.onMouseDown);
    this.canvas.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("resize", () => this.refit());
  }

  private screenFromEvent(ev: MouseEvent): { sx: number; sy: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { sx: ev.clientX - rect.left, sy: ev.clientY - rect.top };
  }

  private onMouseDown = (ev: MouseEvent): void => {
    if (ev.button !== 0) return;
    const { sx, sy } = this.screenFromEvent(ev);
    // 1. If we hit a handle, start a handle drag.
    const hit = hitHandle(this.view, this.handles, sx, sy);
    if (hit) {
      // Edge-mid handle: insert a vertex first, then drag the new vertex.
      if (hit.kind === "edgeMid") {
        const newIdx = this.insertVertexAtEdge(hit);
        if (newIdx !== null) {
          // Select the just-inserted vertex by re-rendering and finding the new vertex handle.
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
      this.drag = { handle: hit, lastWorld: screenToWorld(this.view, sx, sy) };
      return;
    }
    // 2. Hit-test prim interior to select. If interior of an unselected prim, select it
    //    (and start moving it as a whole — interior drag).
    const w = screenToWorld(this.view, sx, sy);
    const sel = this.pickPrimAt(w);
    if (sel) {
      const sameAsBefore = this.selection && sameSelection(this.selection, sel);
      this.setSelection(sel);
      if (sameAsBefore) {
        // Already-selected prim, interior drag = move whole prim.
        this.drag = {
          handle: { kind: "vertex", selection: sel, x: w.x, y: w.y, index: -1 }, // placeholder
          lastWorld: w,
        };
      }
    } else {
      this.setSelection(null);
    }
  };

  private onMouseMove = (ev: MouseEvent): void => {
    if (!this.drag) return;
    const { sx, sy } = this.screenFromEvent(ev);
    const w = screenToWorld(this.view, sx, sy);
    const dx = w.x - this.drag.lastWorld.x;
    const dy = w.y - this.drag.lastWorld.y;
    this.drag.lastWorld = w;
    this.applyDrag(this.drag.handle, w, dx, dy);
    this.cb.onChange();
    this.render();
  };

  private onMouseUp = (): void => {
    if (this.drag) {
      this.drag = null;
    }
  };

  private onContextMenu = (ev: MouseEvent): void => {
    // Right-click on a vertex deletes it.
    ev.preventDefault();
    const { sx, sy } = this.screenFromEvent(ev);
    const hit = hitHandle(this.view, this.handles, sx, sy);
    if (hit && hit.kind === "vertex") {
      this.deleteVertex(hit);
      this.cb.onChange();
      this.render();
    }
  };

  private applyDrag(h: Handle, world: Vec2, dx: number, dy: number): void {
    const sel = h.selection;
    switch (h.kind) {
      case "diskCenter": {
        if (this.shape.kind !== "disk") return;
        this.shape.cx = world.x;
        this.shape.cy = world.y;
        return;
      }
      case "diskRadius": {
        if (this.shape.kind !== "disk") return;
        const r = Math.hypot(world.x - this.shape.cx, world.y - this.shape.cy);
        this.shape.r = Math.max(0.1, r);
        return;
      }
      case "holeCenter": {
        if (sel.kind !== "hole") return;
        const hole = this.shape.holes[sel.index];
        if (!hole || hole.kind !== "circle") return;
        hole.cx = world.x; hole.cy = world.y;
        return;
      }
      case "holeRadius": {
        if (sel.kind !== "hole") return;
        const hole = this.shape.holes[sel.index];
        if (!hole || hole.kind !== "circle") return;
        const r = Math.hypot(world.x - hole.cx, world.y - hole.cy);
        hole.r = Math.max(0.1, r);
        return;
      }
      case "vertex": {
        // index === -1 means "interior drag of whole prim" (move all vertices).
        const ol = this.outlineFor(sel);
        if (!ol) return;
        if (h.index === -1) {
          for (const p of ol) { p.x += dx; p.y += dy; }
        } else if (h.index !== undefined) {
          const v = ol[h.index];
          if (v) { v.x = world.x; v.y = world.y; }
        }
        return;
      }
      // edgeMid is handled by insertVertexAtEdge before drag starts; not reached here.
    }
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
