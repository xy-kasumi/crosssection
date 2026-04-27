// Test battery for the section-property solver.
//
// Hard rule: every `expected` value below traces to an external authority
// (closed form, standard, textbook). No self-computed regression baselines.
// See feedback memory: feedback_external_test_references.md.

import type { SolverShape } from "../shape.ts";
import * as cf from "./closed-form.ts";
import { circle, equilateralTriangle, hollowCircle, rectangle, rhs } from "../presets.ts";

export interface ExpectedTriple {
  ixx_c: number;
  iyy_c: number;
  j: number;
}

export interface ToleranceTriple {
  // Relative error: |computed - expected| / |expected| < tol
  ixx_c: number;
  iyy_c: number;
  j: number;
}

export interface TestCase {
  name: string;
  citation: string; // free-text reference; required (per project memory)
  shape: SolverShape;
  meshSize: number;
  expected: ExpectedTriple;
  tolerance: ToleranceTriple;
}

// ----- Case 1: solid circle (D=10) -----
const D1 = 10;
const case1: TestCase = {
  name: "solid circle, D=10",
  citation: "Closed form: Ix=Iy=πD⁴/64, J=πD⁴/32 (any mechanics-of-materials text)",
  shape: circle(D1, 64),
  meshSize: 0.5,
  expected: {
    ixx_c: cf.solidCircleIx(D1),
    iyy_c: cf.solidCircleIy(D1),
    j:     cf.solidCircleJ(D1),
  },
  tolerance: { ixx_c: 0.01, iyy_c: 0.01, j: 0.01 },
};

// ----- Case 2: hollow circle (Do=20, Di=14) -----
const DO2 = 20;
const DI2 = 14;
const case2: TestCase = {
  name: "hollow circle, Do=20, Di=14",
  citation: "Closed form: subtract inner from outer; Ix=Iy=π(Do⁴-Di⁴)/64, J=π(Do⁴-Di⁴)/32",
  shape: hollowCircle(DO2, DI2, 64),
  meshSize: 0.5,
  expected: {
    ixx_c: cf.hollowCircleIx(DO2, DI2),
    iyy_c: cf.hollowCircleIy(DO2, DI2),
    j:     cf.hollowCircleJ(DO2, DI2),
  },
  tolerance: { ixx_c: 0.01, iyy_c: 0.01, j: 0.01 },
};

// ----- Case 3: solid rectangle (b=10, h=20) -----
const B3 = 10;
const H3 = 20;
const case3: TestCase = {
  name: "solid rectangle, b=10, h=20",
  citation: "Ix/Iy: Ix=bh³/12, Iy=hb³/12 (closed form). J: Roark 8th ed. Table 10-1, β(h/b=2)=0.229.",
  shape: rectangle(B3, H3),
  meshSize: 0.4,
  expected: {
    ixx_c: cf.rectangleIx(B3, H3),
    iyy_c: cf.rectangleIy(B3, H3),
    j:     cf.rectangleJ(B3, H3),
  },
  // Roark β has its own ~1% tabulation uncertainty; loosen J tolerance.
  tolerance: { ixx_c: 0.005, iyy_c: 0.005, j: 0.02 },
};

// ----- Case 4: rectangular hollow section (B=40, H=80, t=4) -----
const B4 = 40;
const H4 = 80;
const T4 = 4;
const case4: TestCase = {
  name: "RHS, B=40, H=80, t=4",
  citation: "Ix/Iy: subtract inner from outer (closed form). J: Bredt thin-walled closed-section formula J=4Aₘ²·t/s (Roark Table 10-9). Bredt is approximate for finite t/min(B,H).",
  shape: rhs(B4, H4, T4),
  meshSize: 0.8,
  expected: {
    ixx_c: cf.rhsIx(B4, H4, T4),
    iyy_c: cf.rhsIy(B4, H4, T4),
    j:     cf.rhsJ_BredtThinWall(B4, H4, T4),
  },
  // Bredt is a thin-wall approximation; t/B=0.1 here, expect ~3% deviation.
  tolerance: { ixx_c: 0.005, iyy_c: 0.005, j: 0.04 },
};

// ----- Case 5: equilateral triangle (side a=20) -----
// Saint-Venant's classical analytical solution for torsion on an equilateral
// triangular cross-section. Genuinely-derived closed form (not a thin-wall
// approximation), and the FEM has to handle a non-rectangular, non-axis-aligned
// shape — a meaningful divergence from the I-beam-like cases that the simple
// open-section sum Σbt³/3 trivially solves.
const A5 = 20;
const case5: TestCase = {
  name: "equilateral triangle, a=20",
  citation: "Timoshenko & Goodier, Theory of Elasticity 3rd ed. (1970) §110: J=a⁴√3/80 (analytical Saint-Venant solution). Ix=Iy=a⁴√3/96 (any mechanics text). Also Roark 8th ed. Table 10-1.",
  shape: equilateralTriangle(A5),
  meshSize: 0.4,
  expected: {
    ixx_c: cf.equilateralTriangleIx(A5),
    iyy_c: cf.equilateralTriangleIy(A5),
    j:     cf.equilateralTriangleJ(A5),
  },
  tolerance: { ixx_c: 0.01, iyy_c: 0.01, j: 0.01 },
};

export const cases: TestCase[] = [case1, case2, case3, case4, case5];
