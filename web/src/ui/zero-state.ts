// Zero-state landing carousel.
//
// Until the user picks a Start from preset, the canvas runs a slow muted
// crossfade through a few representative cross-sections, and the Ix/Iy/J
// readouts update in lockstep using closed-form values. Goals: hide
// Pyodide boot time behind something useful; show concretely what this
// tool computes; keep the user's eye on the only active control (Start
// from). Exit happens on the first preset click and is one-way.

import {
  compose, extrusionOf, rectShapeOf, rodOf,
  type AuthoringShape,
} from "../authoring.ts";
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
    const r = compose(auth);
    if (r.ok) out.push({ shape: r.shape, ix, iy, j });
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
  // 3. Solid square, a = 14 mm. Ix = Iy = a⁴/12; J = β₁ a⁴, β₁ ≈ 0.140577 (Roark).
  {
    const a = 14;
    const I = a ** 4 / 12;
    const J = 0.140577 * a ** 4;
    push(rectShapeOf(a, a), I, I, J);
  }
  // 4. 30×30 hollow square (extrusion 3030 placeholder, t = 2 mm wall).
  //    Ix = Iy by subtraction (exact). J via Bredt thin-wall, which for a
  //    square tube simplifies: J = 4·Aₘ²·t / peri = Wₘ³·t  with Wₘ = W−t.
  {
    const Wo = 30, Wi = 26;
    const I = (Wo ** 4 - Wi ** 4) / 12;
    const Wm = (Wo + Wi) / 2;
    const t = (Wo - Wi) / 2;
    const J = Wm ** 3 * t;
    push(extrusionOf(3030), I, I, J);
  }
  return out;
}
