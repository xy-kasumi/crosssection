// Preset shape constructors. Every preset returns a SolverShape (list of polygons:
// outer first, then holes). All curves are discretized to polygons; the default
// n-side count is chosen so Ix discretization error stays below 0.05% for a
// circle, far below the 1% target.

import type { Point2D, Polygon, SolverShape } from "./shape.ts";

const TAU = Math.PI * 2;

export function circle(d: number, n = 64): SolverShape {
  return [polygonRing(d / 2, n, /*ccw*/ true)];
}

export function hollowCircle(dOuter: number, dInner: number, n = 64): SolverShape {
  return [
    polygonRing(dOuter / 2, n, /*ccw*/ true),
    polygonRing(dInner / 2, n, /*ccw*/ false),
  ];
}

export function rectangle(b: number, h: number, cx = 0, cy = 0): SolverShape {
  return [rectRing(b, h, cx, cy, /*ccw*/ true)];
}

// Rectangular hollow section (RHS): outer B x H, uniform wall thickness t.
export function rhs(B: number, H: number, t: number, cx = 0, cy = 0): SolverShape {
  return [
    rectRing(B, H, cx, cy, /*ccw*/ true),
    rectRing(B - 2 * t, H - 2 * t, cx, cy, /*ccw*/ false),
  ];
}

// Equilateral triangle of side `a`, centered on its centroid, oriented with
// one vertex pointing in +y. Three sharp corners.
export function equilateralTriangle(a: number): SolverShape {
  const r = a / Math.sqrt(3); // distance from centroid to vertex
  const ring: Polygon = [
    { x: 0, y: r },
    { x: -a / 2, y: -r / 2 },
    { x: a / 2, y: -r / 2 },
  ];
  return [ring];
}

// Standard I-beam / W-shape parameterization (sharp corners; no fillet).
//   bf: flange width    d:  total depth
//   tf: flange thickness  tw: web thickness
// Centered on the origin. Single outer polygon (no holes).
export function iBeam(bf: number, d: number, tf: number, tw: number): SolverShape {
  const x = bf / 2;
  const y = d / 2;
  const xw = tw / 2;
  const yw = d / 2 - tf;
  // Walk CCW around the I outline starting at the bottom-right of the bottom flange.
  const ring: Polygon = [
    { x:  x, y: -y },
    { x:  x, y: -yw },
    { x:  xw, y: -yw },
    { x:  xw, y:  yw },
    { x:  x, y:  yw },
    { x:  x, y:  y },
    { x: -x, y:  y },
    { x: -x, y:  yw },
    { x: -xw, y:  yw },
    { x: -xw, y: -yw },
    { x: -x, y: -yw },
    { x: -x, y: -y },
  ];
  return [ring];
}

// ----- helpers -----

function polygonRing(r: number, n: number, ccw: boolean): Polygon {
  const ring: Polygon = [];
  for (let i = 0; i < n; i++) {
    // CCW: angle increases. CW: angle decreases.
    const t = (ccw ? i : -i) * (TAU / n);
    ring.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
  }
  return ring;
}

function rectRing(b: number, h: number, cx: number, cy: number, ccw: boolean): Polygon {
  const x0 = cx - b / 2;
  const x1 = cx + b / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  const corners: Point2D[] = ccw
    ? [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
    : [{ x: x0, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y0 }];
  return corners;
}
