// Owns canvas-view animation: the halfSpan tween (when the user changes
// shape size) and the zero-state demo carousel. Both are RAF-driven and
// both write `view`. Editor reads `animator.view` whenever it needs the
// current world↔screen transform.
//
// While zero state is active, this animator paints the canvas itself
// (drawZeroState) — Editor's render() is a no-op. When zero state ends,
// the editor regains paint ownership.

import type { Shape as CoreShape } from "@core/shape.ts";
import {
  drawZeroState, makeView,
  ZERO_STATE_HALFSPAN, zeroStateIdx,
  type View,
} from "./canvas/index.ts";

const TWEEN_K = 0.20;          // log-space exponential approach factor per frame
const TWEEN_DONE_TOL = 0.005;  // snap to target when relative error < this

export interface ViewAnimatorCallbacks {
  // Called after `view` has been updated and we're NOT in zero state. Host
  // re-renders shape-driven content (silhouette, handles, tool preview).
  onViewChange: () => void;
}

export class ViewAnimator {
  // Public so consumers can read it cheaply. Mutated by this class only.
  view: View;

  private readonly canvas: HTMLCanvasElement;
  private readonly cb: ViewAnimatorCallbacks;
  private halfSpan: number;
  private targetSpan: number;
  private spanRaf: number | null = null;
  private zero: {
    shapes: CoreShape[];
    startMs: number;
    rafId: number | null;
    lastIdx: number;
    onShape?: (idx: number) => void;
  } | null = null;

  constructor(canvas: HTMLCanvasElement, initialHalfSpan: number, cb: ViewAnimatorCallbacks) {
    this.canvas = canvas;
    this.cb = cb;
    this.halfSpan = initialHalfSpan;
    this.targetSpan = initialHalfSpan;
    this.view = makeView(canvas, initialHalfSpan);
    window.addEventListener("resize", () => this.refresh());
  }

  isZeroState(): boolean { return this.zero !== null; }

  // Begin a tween toward `target`. No-op during zero state.
  tweenTo(target: number): void {
    if (this.zero) return;
    if (target === this.targetSpan && target === this.halfSpan) {
      this.refresh();
      return;
    }
    this.targetSpan = target;
    if (this.spanRaf === null) this.spanRaf = requestAnimationFrame(this.tickSpan);
  }

  // Re-build the view at the current halfSpan without animating. Use after
  // canvas resize, or when the caller wants the grid to stay put while
  // something else changes (e.g. mid-drag).
  refresh(): void {
    this.view = makeView(this.canvas, this.halfSpan);
    if (!this.zero) this.cb.onViewChange();
  }

  setZeroState(shapes: CoreShape[] | null, onShape?: (idx: number) => void): void {
    if (shapes === null) {
      if (!this.zero) return;
      if (this.zero.rafId !== null) cancelAnimationFrame(this.zero.rafId);
      this.zero = null;
      this.refresh();
      return;
    }
    if (this.zero) {
      this.zero.shapes = shapes;
      this.zero.onShape = onShape;
      return;
    }
    this.zero = { shapes, startMs: performance.now(), rafId: null, lastIdx: -1, onShape };
    this.tickZero();
  }

  private tickSpan = (): void => {
    this.spanRaf = null;
    const cur = this.halfSpan, tgt = this.targetSpan;
    // Geometric approach — log-space feels right for span jumps that span an
    // order of magnitude (e.g. 5 → 50).
    let next = Math.exp(Math.log(cur) + (Math.log(tgt) - Math.log(cur)) * TWEEN_K);
    if (Math.abs(tgt - next) / tgt < TWEEN_DONE_TOL) next = tgt;
    this.halfSpan = next;
    this.view = makeView(this.canvas, this.halfSpan);
    this.cb.onViewChange();
    if (this.halfSpan !== tgt) {
      this.spanRaf = requestAnimationFrame(this.tickSpan);
    }
  };

  private tickZero = (): void => {
    if (!this.zero) return;
    this.zero.rafId = null;
    const t = (performance.now() - this.zero.startMs) / 1000;
    this.view = makeView(this.canvas, ZERO_STATE_HALFSPAN);
    drawZeroState(this.canvas, this.view, this.zero.shapes, t);
    const idx = zeroStateIdx(t, this.zero.shapes.length);
    if (idx !== this.zero.lastIdx) {
      this.zero.lastIdx = idx;
      this.zero.onShape?.(idx);
    }
    this.zero.rafId = requestAnimationFrame(this.tickZero);
  };
}
