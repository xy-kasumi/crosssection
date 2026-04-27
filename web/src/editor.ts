// Editor interactions: hit-testing, drag, vertex insert/delete on the
// AuthoringShape. Owns the canvas event listeners and emits a callback
// whenever the shape changes (which main.ts uses to recompose + solve).

import type { AuthoringShape, Outline, Selection, Vec2 } from "./authoring.ts";
import {
  draw,
  drawZeroState,
  hitHandle,
  makeView,
  screenToWorld,
  targetHalfSpan,
  zeroStateIdx,
  type Handle,
  type ToolKind,
  type ToolPreview,
  type View,
} from "./canvas.ts";
import type { Shape as CoreShape } from "@core/shape.ts";

// halfSpan used for the zero-state demo carousel. Hand-picked to comfortably
// contain the largest demo shape (a 30 mm extrusion → max abs coord 15) on
// the engineering ladder.
const ZERO_STATE_HALFSPAN = 20;

// Tool state shipped to the host so the toolbar can light up the active
// button and show the right hint ("click first corner" vs "click opposite
// corner"). Phase = whether we've captured the first click yet.
export interface ToolState {
  kind: ToolKind;
  phase: "wait-anchor" | "wait-end";
}

export interface EditorCallbacks {
  onChange(): void;
  onSelectionChange(sel: Selection | null): void;
  onToolChange?(state: ToolState | null): void;
  onToolCommit?(kind: ToolKind, p1: Vec2, p2: Vec2): void;
}

export class Editor {
  private canvas: HTMLCanvasElement;
  private cb: EditorCallbacks;
  private shape: AuthoringShape;
  private composed: CoreShape | null = null;
  private selection: Selection | null = null;
  private view: View;
  private handles: Handle[] = [];

  // halfSpan (mm) is animated. The grid is rebuilt each frame from the
  // current value while it eases toward the target.
  private currentHalfSpan: number;
  private targetHalfSpan: number;
  private rafId: number | null = null;

  // Drag state. While set, refit is suppressed — the user shouldn't see the
  // grid jumping mid-edit.
  private drag: null | {
    handle: Handle;
    lastWorld: Vec2;
  } = null;

  // Tool state. Mutually exclusive with drag — when a tool is active, the
  // canvas swallows clicks for tool placement (and ignores handles).
  private tool: { kind: ToolKind; anchor: Vec2 | null } | null = null;
  private cursorWorld: Vec2 | null = null;
  private snap = true;

  // Zero-state demo: while non-null, the canvas runs its own RAF carousel
  // through the supplied composed shapes and all input is ignored. The real
  // `shape` field still holds the constructor-supplied default so that the
  // first preset click can transition cleanly into the editor.
  //
  // onShape fires whenever the carousel advances to a new index, so the host
  // can update Ix/Iy/J readouts in lockstep with the visible shape.
  private zeroState:
    | { shapes: CoreShape[]; startMs: number; rafId: number | null;
        lastIdx: number; onShape?: (idx: number) => void }
    | null = null;

  constructor(canvas: HTMLCanvasElement, initial: AuthoringShape, cb: EditorCallbacks) {
    this.canvas = canvas;
    this.cb = cb;
    this.shape = initial;
    this.currentHalfSpan = targetHalfSpan(initial);
    this.targetHalfSpan = this.currentHalfSpan;
    this.view = makeView(canvas, this.currentHalfSpan);
    this.attachListeners();
  }

  // ----- public API -----

  getShape(): AuthoringShape { return this.shape; }

  // refit:false skips the viewport refit — used while debouncing rapid
  // size-input typing, so the grid doesn't chase every keystroke. The
  // shape itself still updates immediately so the user can see what they
  // typed; the grid scale catches up on the next refit() call.
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

  isZeroState(): boolean { return this.zeroState !== null; }

  // Enter (shapes) or leave (null) the zero-state demo carousel. While in
  // zero state, render() is a no-op — the carousel's RAF tick paints the
  // canvas every frame. onShape fires once per index transition.
  setZeroState(shapes: CoreShape[] | null, onShape?: (idx: number) => void): void {
    if (shapes === null) {
      if (!this.zeroState) return;
      if (this.zeroState.rafId !== null) cancelAnimationFrame(this.zeroState.rafId);
      this.zeroState = null;
      // Re-fit the editor's actual shape when leaving zero state, so the
      // grid lands in the right place before the next setShape arrives.
      this.refit();
      return;
    }
    if (this.zeroState) {
      this.zeroState.shapes = shapes;
      this.zeroState.onShape = onShape;
      return;
    }
    this.zeroState = {
      shapes, startMs: performance.now(), rafId: null,
      lastIdx: -1, onShape,
    };
    this.tickZero();
  }

  private tickZero = (): void => {
    if (!this.zeroState) return;
    this.zeroState.rafId = null;
    const t = (performance.now() - this.zeroState.startMs) / 1000;
    this.view = makeView(this.canvas, ZERO_STATE_HALFSPAN);
    drawZeroState(this.canvas, this.view, this.zeroState.shapes, t);
    const idx = zeroStateIdx(t, this.zeroState.shapes.length);
    if (idx !== this.zeroState.lastIdx) {
      this.zeroState.lastIdx = idx;
      this.zeroState.onShape?.(idx);
    }
    this.zeroState.rafId = requestAnimationFrame(this.tickZero);
  };

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

  private toolStateForCb(): ToolState | null {
    if (!this.tool) return null;
    return { kind: this.tool.kind, phase: this.tool.anchor ? "wait-end" : "wait-anchor" };
  }

  private snapWorld(p: Vec2): Vec2 {
    if (!this.snap) return p;
    const u = this.view.unit;
    return { x: Math.round(p.x / u) * u, y: Math.round(p.y / u) * u };
  }

  // Refit the viewport to the current shape. During a drag we don't change
  // halfSpan (would yank the grid under the user's cursor); we still rebuild
  // the view at the current halfSpan in case the canvas itself was resized.
  refit(): void {
    if (this.drag) {
      this.view = makeView(this.canvas, this.currentHalfSpan);
      this.render();
      return;
    }
    const want = targetHalfSpan(this.shape);
    if (want === this.targetHalfSpan && want === this.currentHalfSpan) {
      this.view = makeView(this.canvas, this.currentHalfSpan);
      this.render();
      return;
    }
    this.targetHalfSpan = want;
    if (this.rafId === null) this.rafId = requestAnimationFrame(this.tickAnim);
  }

  private tickAnim = (): void => {
    this.rafId = null;
    const tgt = this.targetHalfSpan;
    const cur = this.currentHalfSpan;
    // Approach geometrically — log-space interpolation feels right for span
    // changes that span an order of magnitude (e.g. 5 → 50).
    const k = 0.20;
    let next = Math.exp(Math.log(cur) + (Math.log(tgt) - Math.log(cur)) * k);
    if (Math.abs(tgt - next) / tgt < 0.005) next = tgt;
    this.currentHalfSpan = next;
    this.view = makeView(this.canvas, this.currentHalfSpan);
    this.render();
    if (this.currentHalfSpan !== tgt) {
      this.rafId = requestAnimationFrame(this.tickAnim);
    }
  };

  render(): void {
    if (this.zeroState) return; // RAF tick owns the canvas in zero state
    let preview: ToolPreview | null = null;
    if (this.tool && this.cursorWorld) {
      const cursor = this.snapWorld(this.cursorWorld);
      preview = { kind: this.tool.kind, anchor: this.tool.anchor, cursor, snapping: this.snap };
    }
    this.handles = draw(this.canvas, this.view, this.shape, this.composed, this.selection, preview);
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
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("resize", () => this.refit());
  }

  private screenFromEvent(ev: MouseEvent): { sx: number; sy: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { sx: ev.clientX - rect.left, sy: ev.clientY - rect.top };
  }

  private onMouseDown = (ev: MouseEvent): void => {
    if (this.zeroState) return;
    if (ev.button !== 0) return;
    const { sx, sy } = this.screenFromEvent(ev);
    // 0. Tool mode swallows clicks for 2-step prim placement.
    if (this.tool) {
      const w = this.snapWorld(screenToWorld(this.view, sx, sy));
      if (!this.tool.anchor) {
        this.tool.anchor = w;
        this.cb.onToolChange?.(this.toolStateForCb());
        this.render();
      } else {
        const kind = this.tool.kind;
        const anchor = this.tool.anchor;
        this.tool = null;
        this.cb.onToolChange?.(null);
        this.cb.onToolCommit?.(kind, anchor, w);
        this.render();
      }
      return;
    }
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
    if (this.zeroState) return;
    const { sx, sy } = this.screenFromEvent(ev);
    this.cursorWorld = screenToWorld(this.view, sx, sy);
    if (this.tool) {
      this.render();
      return;
    }
    if (!this.drag) return;
    const w = this.cursorWorld;
    const dx = w.x - this.drag.lastWorld.x;
    const dy = w.y - this.drag.lastWorld.y;
    this.drag.lastWorld = w;
    this.applyDrag(this.drag.handle, w, dx, dy);
    this.cb.onChange();
    this.render();
  };

  private onMouseUp = (): void => {
    if (this.zeroState) return;
    if (this.drag) {
      this.drag = null;
      // The shape's extents may have changed during the drag; now that the
      // user has let go, refit (animating any halfSpan jump).
      this.refit();
    }
  };

  private onContextMenu = (ev: MouseEvent): void => {
    ev.preventDefault();
    if (this.zeroState) return;
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
    if (this.zeroState) return;
    if (ev.key === "Escape" && this.tool) {
      this.tool = null;
      this.cb.onToolChange?.(null);
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
