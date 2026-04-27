// Closed-form section properties for shapes with exact (or well-tabulated)
// formulas. These are the SOURCE OF TRUTH for the test battery. Every formula
// here must trace to a referenced authority — closed form, standard, or
// textbook. No self-computed regression baselines.
//
// References:
//   • Roark's Formulas for Stress and Strain, 7th/8th ed. (Young & Budynas).
//     Table 10-1 / 10-9 for torsional section properties.
//   • Standard mechanics-of-materials closed forms for I_x, I_y, J of circles
//     and rectangles (any textbook; e.g. Beer/Johnston, Hibbeler).
//
// Conventions: Ix = ∫y² dA, Iy = ∫x² dA, J = St. Venant torsional constant.
// All values about the centroid.

const PI = Math.PI;

// ---------- Solid circle (diameter D) ----------
// Ix = Iy = πD⁴/64
// J  = πD⁴/32         (exact: J = Ip for a circle by symmetry)
export function solidCircleIx(d: number): number {
  return (PI * d ** 4) / 64;
}
export const solidCircleIy = solidCircleIx;
export function solidCircleJ(d: number): number {
  return (PI * d ** 4) / 32;
}

// ---------- Hollow circle (Do outer, Di inner) ----------
// Subtractive on a circular cross-section.
export function hollowCircleIx(dOuter: number, dInner: number): number {
  return (PI * (dOuter ** 4 - dInner ** 4)) / 64;
}
export const hollowCircleIy = hollowCircleIx;
export function hollowCircleJ(dOuter: number, dInner: number): number {
  return (PI * (dOuter ** 4 - dInner ** 4)) / 32;
}

// ---------- Solid rectangle (b wide × h tall) ----------
// Ix = b·h³/12, Iy = h·b³/12.
// J for a rectangle has no exact closed form; the standard expression is
//   J = β(h/b) · h · b³,  with b ≤ h, β tabulated by Roark Table 10-1.
// Here β is interpolated from the canonical table for h/b values we use.
export function rectangleIx(b: number, h: number): number {
  return (b * h ** 3) / 12;
}
export function rectangleIy(b: number, h: number): number {
  return (h * b ** 3) / 12;
}

// β coefficient from Roark 8th ed., Table 10-1, "Rectangular section, all four
// sides plane and parallel". Indexed by aspect ratio h/b (long/short), b ≤ h.
// Table values:
//   h/b:  1.0    1.5    2.0    2.5    3.0    4.0    5.0    10    ∞
//   β:    0.141  0.196  0.229  0.249  0.263  0.281  0.291  0.312 1/3
const ROARK_BETA_TABLE: ReadonlyArray<readonly [number, number]> = [
  [1.0, 0.141],
  [1.5, 0.196],
  [2.0, 0.229],
  [2.5, 0.249],
  [3.0, 0.263],
  [4.0, 0.281],
  [5.0, 0.291],
  [10.0, 0.312],
  [Infinity, 1 / 3],
];

export function rectangleBeta(hOverB: number): number {
  if (hOverB < 1) {
    // Table is keyed by long/short ratio. Caller passed short/long by mistake.
    throw new Error(`rectangleBeta: pass h/b with h >= b; got ${hOverB}`);
  }
  for (let i = 0; i < ROARK_BETA_TABLE.length - 1; i++) {
    const [r0, b0] = ROARK_BETA_TABLE[i]!;
    const [r1, b1] = ROARK_BETA_TABLE[i + 1]!;
    if (hOverB <= r1) {
      if (!isFinite(r1)) return b1;
      const t = (hOverB - r0) / (r1 - r0);
      return b0 + t * (b1 - b0);
    }
  }
  return 1 / 3;
}

export function rectangleJ(b: number, h: number): number {
  // β is indexed by long/short ratio. Convention: pass dimensions as-is and
  // we sort internally so caller doesn't have to remember which is which.
  const long = Math.max(b, h);
  const short = Math.min(b, h);
  const beta = rectangleBeta(long / short);
  return beta * long * short ** 3;
}

// ---------- Equilateral triangle (side a) ----------
// Saint-Venant's analytical solution for the warping function on an
// equilateral triangular cross-section gives an exact closed form:
//   J = a⁴ √3 / 80
// Reference: Timoshenko & Goodier, "Theory of Elasticity" 3rd ed. (1970),
// §110 "Equilateral Triangular Section". Also Roark 8th ed. Table 10-1.
// Section moments about centroid (3-fold symmetry → Ix = Iy):
//   Ix = Iy = a⁴ √3 / 96
// Reference: any mechanics-of-materials text; Roark 8th ed. Table A-1.
export function equilateralTriangleIx(a: number): number {
  return (a ** 4 * Math.sqrt(3)) / 96;
}
export const equilateralTriangleIy = equilateralTriangleIx;
export function equilateralTriangleJ(a: number): number {
  return (a ** 4 * Math.sqrt(3)) / 80;
}

// ---------- Rectangular hollow section (RHS) ----------
// B × H outer, uniform wall thickness t. Subtractive Ix/Iy.
export function rhsIx(B: number, H: number, t: number): number {
  return rectangleIx(B, H) - rectangleIx(B - 2 * t, H - 2 * t);
}
export function rhsIy(B: number, H: number, t: number): number {
  return rectangleIy(B, H) - rectangleIy(B - 2 * t, H - 2 * t);
}
// Bredt's thin-walled closed-section formula:
//   J ≈ 4·Aₘ²·t / s
// where Aₘ is the area enclosed by the wall midline and s is the midline
// perimeter. Valid as an approximation for t « min(B,H); error grows with
// wall thickness ratio. We document the expected approximation error in the
// tolerance for the corresponding test case.
export function rhsJ_BredtThinWall(B: number, H: number, t: number): number {
  const Bm = B - t; // midline outer dimensions
  const Hm = H - t;
  const Am = Bm * Hm;
  const s = 2 * Bm + 2 * Hm;
  return (4 * Am * Am * t) / s;
}
