// Shape-edit engine: hit-testing, drag, vertex insert/delete, tool flow.
// Owns the canvas event listeners. Delegates all view/animation state to
// ViewAnimator — Editor itself doesn't know about RAF, halfSpan, or DPR.
//
// Coordinate boundary: this file is the only consumer that crosses world↔CSS.
// It receives mouse events in CSS px (getBoundingClientRect), calls
// screenToWorld at the boundary, and does all internal logic in world coords.
//
// Mutation discipline: this.shape is replaced atomically by the result of
// `apply(this.shape, op)` — never mutated in place. Drag-derived ops are
// base-relative: on mousedown we snapshot dragStartShape + dragStartCursor,
// and each frame issues an op against that captured base with a cumulative
// delta. Per-frame results never feed into the next frame's input. That
// keeps the gesture trivially associative regardless of frame timing.

import { apply, compose } from "@geom/index.ts";
import type {
  ApplyResult, AuthoringShape, Op, Selection, Vec2,
} from "@geom/index.ts";
import {
  draw, hitHandle, screenToWorld, targetHalfSpan,
  type Handle, type ToolKind, type ToolPreview, type View,
} from "./canvas/index.ts";
import { ViewAnimator } from "./view-animator.ts";
import type { SolverShape } from "@solver/shape.ts";

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

// Drag state held while the user has the mouse down. Every frame's apply()
// runs against `startShape` with a delta derived from `startCursor` —
// never against the previous frame's result. `previewResult` is the most
// recent apply output, surfaced via render() so the user sees the
// candidate shape live.
interface DragState {
  handle: Handle;
  startShape: AuthoringShape;
  startCursor: Vec2;
  previewResult: ApplyResult | null;
  // For "translate-prim" of a prim the user picked by clicking its interior
  // (no specific handle), the handle is a synthetic placeholder; we mark
  // the gesture explicitly so the same code-path can treat it as whole-prim.
  isWholePrim: boolean;
}

export class Editor {
  private readonly canvas: HTMLCanvasElement;
  private readonly cb: EditorCallbacks;
  private readonly animator: ViewAnimator;
  private shape: AuthoringShape;
  private composed: SolverShape | null = null;
  private selection: Selection | null = null;
  private handles: Handle[] = [];

  private drag: DragState | null = null;

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

  setComposed(composed: SolverShape | null): void {
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

  setZeroState(shapes: SolverShape[] | null, onShape?: (idx: number) => void): void {
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
    let status: ToolStatus = { level: "valid", message: null };
    let displayShape: AuthoringShape = this.shape;
    let displayComposed: SolverShape | null = this.composed;

    if (this.tool && this.cursorWorld) {
      const cursor = this.snapWorld(this.cursorWorld);
      // Pre-anchor (still picking the first corner) we have no op to
      // evaluate, so the ghost is shown as valid and the host shows the
      // default "click first corner" hint.
      if (this.tool.anchor) {
        const op = makeToolOp(this.tool.kind, this.tool.anchor, cursor);
        const result = apply(this.shape, op);
        crashIfInvalid(result, op);
        status = statusFromResult(result);
      }
      preview = {
        kind: this.tool.kind, anchor: this.tool.anchor, cursor,
        snapping: this.snap,
        valid: status.level !== "error",
      };
    } else if (this.drag && this.drag.previewResult) {
      const r = this.drag.previewResult;
      status = statusFromResult(r);
      if (r.kind === "ok" || r.kind === "warning") {
        displayShape = r.shape;
        const c = compose(displayShape);
        displayComposed = c.ok ? c.shape : null;
      }
      // Hole-circle drags get a ghost circle showing the live target.
      const ghost = this.holeCircleGhost();
      if (ghost) preview = { ...ghost, valid: r.kind !== "error" };
    }
    this.updateStatus(status);
    this.handles = draw(this.canvas, this.view, displayShape, displayComposed, this.selection, preview);
  }

  private updateStatus(s: ToolStatus): void {
    if (s.level === this.lastStatus.level && s.message === this.lastStatus.message) return;
    this.lastStatus = s;
    this.cb.onToolStatus?.(s);
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
      const op = makeToolOp(this.tool.kind, this.tool.anchor, w);
      const result = apply(this.shape, op);
      crashIfInvalid(result, op);
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
      if (hit.kind === "edgeMid" && hit.index !== undefined) {
        const insertOp: Op = { kind: "insert-vert", sel: hit.selection, afterIndex: hit.index };
        const result = apply(this.shape, insertOp);
        crashIfInvalid(result, insertOp);
        if (result.kind === "ok" || result.kind === "warning") {
          this.shape = result.shape;
          this.cb.onChange();
          this.render();
          // The newly inserted vertex sits at hit.index + 1.
          const newIdx = hit.index + 1;
          const newVertex = this.handles.find(
            (h) => h.kind === "vertex" && sameSelection(h.selection, hit.selection) && h.index === newIdx,
          );
          if (newVertex) this.beginDrag(newVertex, screenToWorld(this.view, sx, sy));
        }
        return;
      }
      this.beginDrag(hit, this.snapWorld(screenToWorld(this.view, sx, sy)));
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
        const placeholder: Handle = { kind: "vertex", selection: sel, x: start.x, y: start.y, index: -1 };
        this.beginDrag(placeholder, start, true);
      }
    } else {
      this.setSelection(null);
    }
  };

  private beginDrag(handle: Handle, startCursor: Vec2, isWholePrim: boolean = false): void {
    this.drag = {
      handle,
      startShape: this.shape,
      startCursor,
      previewResult: null,
      isWholePrim,
    };
  }

  private onMouseMove = (ev: MouseEvent): void => {
    if (this.isZeroState()) return;
    const { sx, sy } = this.screenFromEvent(ev);
    this.cursorWorld = screenToWorld(this.view, sx, sy);
    if (this.tool) {
      this.render();
      return;
    }
    if (!this.drag) return;
    const w = this.snapWorld(this.cursorWorld);
    const op = this.opFromDrag(this.drag, w);
    if (!op) {
      // Edge-mid placeholder somehow got here — shouldn't happen because
      // edge-mid is converted to a vertex drag in onMouseDown.
      return;
    }
    const result = apply(this.drag.startShape, op);
    crashIfInvalid(result, op);
    this.drag.previewResult = result;
    this.render();
  };

  private onMouseUp = (): void => {
    if (this.isZeroState()) return;
    if (!this.drag) return;
    const r = this.drag.previewResult;
    if (r && (r.kind === "ok" || r.kind === "warning")) {
      // Commit the candidate. preselect from the result wins; otherwise
      // keep whatever the user had selected before the drag started.
      this.shape = r.shape;
      const newSel = r.preselect ?? this.selection;
      if (!sameSelectionOrNull(this.selection, newSel)) {
        this.selection = newSel;
        this.cb.onSelectionChange(this.selection);
      }
      this.cb.onChange();
    }
    // r === null (cursor moved within snap cell, never produced a frame),
    // r.kind === "error" (released in invalid territory) → keep the live
    // shape; nothing was ever committed because we never mutated.
    this.drag = null;
    this.refit();
    this.render();
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
    if (hit && hit.kind === "vertex" && hit.index !== undefined && hit.index >= 0) {
      const op: Op = { kind: "delete-vert", sel: hit.selection, index: hit.index };
      const result = apply(this.shape, op);
      crashIfInvalid(result, op);
      if (result.kind === "ok" || result.kind === "warning") {
        this.shape = result.shape;
        this.cb.onChange();
        this.render();
      }
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

  // Build the right Op for the current drag and the snapped cursor world
  // position. Returns null only for the (unreachable) edge-mid placeholder.
  private opFromDrag(d: DragState, cursor: Vec2): Op | null {
    const h = d.handle;
    const sel = h.selection;
    if (d.isWholePrim) {
      const delta: Vec2 = { x: cursor.x - d.startCursor.x, y: cursor.y - d.startCursor.y };
      return { kind: "translate-prim", sel, delta };
    }
    switch (h.kind) {
      case "diskCenter":
        return { kind: "move-disk-center", target: cursor };
      case "diskRadius": {
        if (d.startShape.kind !== "disk") return null;
        const r = Math.hypot(cursor.x - d.startShape.cx, cursor.y - d.startShape.cy);
        return { kind: "move-disk-radius", r };
      }
      case "holeCenter": {
        if (sel.kind !== "hole") return null;
        return { kind: "move-hole-center", index: sel.index, target: cursor };
      }
      case "holeRadius": {
        if (sel.kind !== "hole") return null;
        const target = d.startShape.holes[sel.index];
        if (!target || target.kind !== "circle") return null;
        const r = Math.hypot(cursor.x - target.cx, cursor.y - target.cy);
        return { kind: "move-hole-radius", index: sel.index, r };
      }
      case "vertex":
        if (h.index === undefined || h.index < 0) return null;
        return { kind: "move-vert", sel, index: h.index, target: cursor };
      case "edgeMid":
        return null; // handled in onMouseDown
    }
  }

  private holeCircleGhost(): { kind: "add-hole"; anchor: Vec2; cursor: Vec2; snapping: boolean } | null {
    if (!this.drag) return null;
    const h = this.drag.handle;
    if (h.kind !== "holeCenter" && h.kind !== "holeRadius") return null;
    if (h.selection.kind !== "hole") return null;
    const r = this.drag.previewResult;
    if (!r || (r.kind !== "ok" && r.kind !== "warning")) return null;
    // Read the circle's live position from the candidate shape — for ok/warn
    // the circle either survived (move-hole-radius / clean center move) or
    // was polygonized (in which case there's no circle to ghost; but the
    // drag still tracks where the user is aiming).
    const candidate = r.shape;
    // The just-committed circle hole is normally at candidate.holes[index].
    // For a polygonized result, there's no surviving circle; fall back to
    // the cursor-derived target so the ghost still tracks.
    const sel = h.selection;
    const candidateHole = candidate.holes[sel.index];
    if (candidateHole && candidateHole.kind === "circle") {
      return {
        kind: "add-hole",
        anchor: { x: candidateHole.cx, y: candidateHole.cy },
        cursor: { x: candidateHole.cx + candidateHole.r, y: candidateHole.cy },
        snapping: this.snap,
      };
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

function sameSelectionOrNull(a: Selection | null, b: Selection | null): boolean {
  if (a === null || b === null) return a === b;
  return sameSelection(a, b);
}

function makeToolOp(kind: ToolKind, anchor: Vec2, cursor: Vec2): Op {
  switch (kind) {
    case "paint-rect": return { kind: "paint-rect", anchor, cursor };
    case "erase-rect": return { kind: "erase-rect", anchor, cursor };
    case "add-hole":   return { kind: "add-hole", center: anchor, cursor };
  }
}

function statusFromResult(r: ApplyResult): ToolStatus {
  if (r.kind === "ok")      return { level: "valid",   message: null };
  if (r.kind === "warning") return { level: "warning", message: r.message };
  if (r.kind === "error")   return { level: "error",   message: r.reason };
  // "invalid" is handled by crashIfInvalid before we reach here.
  return { level: "error", message: r.reason };
}

// Editor-side guard: the kernel should never return "invalid" for a sound
// UI. If it does, log and throw so the top-level window.onerror handler
// surfaces the failure overlay. No silent recovery — UI bugs that build
// malformed Ops should be impossible to ignore.
function crashIfInvalid(r: ApplyResult, op: Op): void {
  if (r.kind !== "invalid") return;
  console.error("[geom invalid op]", r.reason, op);
  throw new Error(`geom kernel rejected op as invalid: ${r.reason}`);
}

function pointInPolygon(p: Vec2, poly: { x: number; y: number }[]): boolean {
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
