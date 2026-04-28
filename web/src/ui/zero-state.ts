// Zero-state landing carousel.
//
// Until the user picks a Start from preset, the canvas runs a slow muted
// crossfade through a few representative cross-sections, and the Ix/Iy/J
// readouts update in lockstep using closed-form values. Goals: hide
// Pyodide boot time behind something useful; show concretely what this
// tool computes; keep the user's eye on the only active control (Start
// from). Exit happens on the first preset click and is one-way.

import {
  compose, extrusionOf, rodOf,
  type AuthoringShape,
} from "@geom/index.ts";
import type { SolverShape } from "@solver/shape.ts";
import type { Editor } from "../editor.ts";
import type { Readouts } from "./readouts.ts";

type DemoEntry = { shape: SolverShape; ix: number; iy: number; j: number };

export class ZeroState {
  private readonly editor: Editor;
  private readonly readouts: Readouts;
  private active = false;

  constructor(opts: { editor: Editor; readouts: Readouts }) {
    this.editor = opts.editor;
    this.readouts = opts.readouts;
  }

  start(): void {
    const entries = buildDemoEntries();
    this.active = true;
    document.body.classList.add("zero-state");
    this.editor.setZeroState(
      entries.map((e) => e.shape),
      (idx) => {
        const e = entries[idx];
        if (!e) return;
        this.readouts.setDemo(e.ix, e.iy, e.j);
      },
    );
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove("zero-state");
    this.editor.setZeroState(null);
  }

  isActive(): boolean { return this.active; }
}

function buildDemoEntries(): DemoEntry[] {
  const out: DemoEntry[] = [];
  const push = (auth: AuthoringShape, ix: number, iy: number, j: number): void => {
    out.push({ shape: compose(auth), ix, iy, j });
  };

  // 1. Solid rod, D = 8 mm. Ix = Iy = πD⁴/64; J = 2 Ix.
  {
    const D = 8;
    const I = Math.PI * D ** 4 / 64;
    push(rodOf(D), I, I, 2 * I);
  }
  // 2. Hollow rod, Do = 12, Di = 8 mm.
  {
    const Do = 12, Di = 8;
    const I = Math.PI * (Do ** 4 - Di ** 4) / 64;
    push(
      { kind: "disk", cx: 0, cy: 0, r: Do / 2,
        holes: [{ kind: "circle", cx: 0, cy: 0, r: Di / 2 }] },
      I, I, 2 * I,
    );
  }
  // 3. 5-point star, hand-authored (single tip up → Ix ≠ Iy). No closed
  //    form; values precomputed.
  push(
    {
      kind: "polygon",
      outers: [[
        { x: -11, y:  3 }, { x:  -5, y: -2 }, { x:  -7, y: -9 }, { x:   0, y: -5 },
        { x:   7, y: -9 }, { x:   5, y: -2 }, { x:  11, y:  3 }, { x:   3, y:  5 },
        { x:   0, y: 11 }, { x:  -3, y:  5 },
      ]],
      holes: [],
    },
    2900, 3400, 3100,
  );
  // 4. 20×20 T-slot extrusion (hand-authored profile, see extrusionOf).
  //    Ix, Iy, J are precomputed numeric constants for this fixed shape.
  push(extrusionOf(), 7500, 7500, 810);
  return out;
}
