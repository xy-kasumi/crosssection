// Symmetrize-action specs. The wedge / half-plane regions and the dihedral
// transforms that turn the canonical fundamental domain into the full
// symmetric union. User-facing labels are deliberately plain English; the
// `D1`/`D4` keys are the dihedral-group names but never shown to the user.

import type { AffineMat, Outline } from "@geom/index.ts";

export type SymKind = "D1" | "D4";

export interface SymSpec {
  kind: SymKind;
  label: string;
  region: Outline;       // canonical fundamental domain (CCW)
  transforms: AffineMat[]; // identity + reflection/rotation copies
  dimRegions: Outline[]; // polygons covering the *non*-canonical area (each CCW)
}

// Big enough to enclose any plausible cross-section (cross-sections are mm-scale).
const B = 1e5;
const I: AffineMat = [1, 0, 0, 1, 0, 0];

// (x,y) → (-x, y): reflection across the Y axis (the canonical "mirror").
const REF_Y: AffineMat = [-1, 0, 0, 1, 0, 0];

// 4-fold rotations (CCW around origin).
const R90:  AffineMat = [0, -1,  1, 0, 0, 0];
const R180: AffineMat = [-1, 0,  0, -1, 0, 0];
const R270: AffineMat = [0,  1, -1, 0, 0, 0];
// 4 reflections (X axis, Y axis, line y=x, line y=-x).
const REF_X:        AffineMat = [1,  0,  0, -1, 0, 0];
const REF_YEQX:     AffineMat = [0,  1,  1,  0, 0, 0];
const REF_YEQNEGX:  AffineMat = [0, -1, -1,  0, 0, 0];

export const SYM_SPECS: SymSpec[] = [
  {
    kind: "D1",
    label: "Mirror",
    // Canonical = right half-plane X≥0, as a CCW rectangle.
    region: [
      { x: 0, y: -B }, { x: B, y: -B }, { x: B, y: B }, { x: 0, y: B },
    ],
    transforms: [I, REF_Y],
    // Non-canonical = left half-plane X<0.
    dimRegions: [[
      { x: -B, y: -B }, { x: 0, y: -B }, { x: 0, y: B }, { x: -B, y: B },
    ]],
  },
  {
    kind: "D4",
    label: "Extrusion",
    // Canonical = wedge X≥0 ∧ Y≥X (one of the 8 fundamental domains of D4).
    region: [
      { x: 0, y: 0 }, { x: B, y: B }, { x: 0, y: B },
    ],
    transforms: [I, R90, R180, R270, REF_X, REF_Y, REF_YEQX, REF_YEQNEGX],
    // Three convex pieces covering the complement of the wedge.
    dimRegions: [
      // Lower half: y<0 (all x).
      [{ x: -B, y: -B }, { x: B, y: -B }, { x: B, y: 0 }, { x: -B, y: 0 }],
      // Right half below diagonal: x≥0, 0≤y<x.
      [{ x: 0, y: 0 }, { x: B, y: 0 }, { x: B, y: B }],
      // Left upper: x<0, y≥0.
      [{ x: -B, y: 0 }, { x: 0, y: 0 }, { x: 0, y: B }, { x: -B, y: B }],
    ],
  },
];
