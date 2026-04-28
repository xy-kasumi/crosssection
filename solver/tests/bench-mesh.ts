// One-off benchmark: speed vs N_TARGET. Runs three representative shapes
// at a sweep of mesh densities, reports wall-clock and J relative error.
// Not part of the regular test battery — invoke with:
//   cd solver && node --import tsx tests/bench-mesh.ts

import { compute } from "../compute.ts";
import { rectangle, hollowCircle, equilateralTriangle } from "../presets.ts";
import { extrusionOf, compose } from "../../geom/index.ts";
import * as cf from "./closed-form.ts";
import type { SolverShape } from "../shape.ts";
import { ringSignedArea, sharpCornerCount } from "../shape.ts";

interface Probe {
  name: string;
  shape: SolverShape;
  area: number;
  // Expected values — NaN when no closed form exists; the run picks the
  // largest-N result as the reference baseline for the relative-error column.
  expectedJ: number;
  expectedIx: number;
}

function totalArea(s: SolverShape): number {
  let a = 0;
  for (const ring of s) a += ringSignedArea(ring);
  return a;
}

const extrusion = compose(extrusionOf());

const probes: Probe[] = [
  {
    name: "rect 10×20",
    shape: rectangle(10, 20),
    area: 10 * 20,
    expectedJ: cf.rectangleJ(10, 20),
    expectedIx: cf.rectangleIx(10, 20),
  },
  {
    name: "hollow circle 20/14",
    shape: hollowCircle(20, 14, 64),
    area: Math.PI * (10 * 10 - 7 * 7),
    expectedJ: cf.hollowCircleJ(20, 14),
    expectedIx: cf.hollowCircleIx(20, 14),
  },
  {
    name: "triangle a=20",
    shape: equilateralTriangle(20),
    area: (Math.sqrt(3) / 4) * 400,
    expectedJ: cf.equilateralTriangleJ(20),
    expectedIx: cf.equilateralTriangleIx(20),
  },
  {
    name: "T-slot 20×20",
    shape: extrusion,
    area: totalArea(extrusion),
    expectedJ: NaN,  // no closed form — baseline = largest-N result
    expectedIx: NaN,
  },
];

const N_TARGETS = [50, 100, 200, 500, 1000, 2000];

async function main(): Promise<void> {
  console.log(`Sharp-corner count per probe (predictor input):`);
  for (const p of probes) console.log(`  ${p.name.padEnd(22)} sharp=${sharpCornerCount(p.shape)}`);
  console.log("");
  console.log(`probe                 │ N_target │ n_elem │ solve_ms │ Ix err   │ J err`);
  console.log(`──────────────────────┼──────────┼────────┼──────────┼──────────┼─────────`);
  for (const probe of probes) {
    const runs: { N: number; ixx: number; j: number; n_elems: number; ms: number }[] = [];
    for (const N of N_TARGETS) {
      const meshSize = probe.area / N;
      const r = await compute(probe.shape, { meshSize });
      runs.push({ N, ixx: r.ixx_c, j: r.j, n_elems: r.n_elems, ms: r.solveMs });
    }
    // Reference: closed form when available, otherwise the largest-N FEM run.
    const refIx = isFinite(probe.expectedIx) ? probe.expectedIx : runs[runs.length - 1]!.ixx;
    const refJ  = isFinite(probe.expectedJ)  ? probe.expectedJ  : runs[runs.length - 1]!.j;
    for (const r of runs) {
      const ixErr = Math.abs(r.ixx - refIx) / Math.abs(refIx);
      const jErr  = Math.abs(r.j   - refJ)  / Math.abs(refJ);
      console.log(
        `${probe.name.padEnd(21)} │ ${String(r.N).padStart(8)} │ ${String(r.n_elems).padStart(6)} │ ${r.ms.toFixed(0).padStart(8)} │ ${(ixErr * 100).toFixed(3).padStart(7)}% │ ${(jErr * 100).toFixed(3).padStart(7)}%`,
      );
    }
    console.log(`──────────────────────┼──────────┼────────┼──────────┼──────────┼─────────`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
