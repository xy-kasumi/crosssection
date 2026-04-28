// 2D cross-section geometry types.
// First polygon is the outer ring (CCW). Subsequent polygons are inner holes (CW).
// Curves enter as fine-enough polygons; n=64 keeps Ix discretization error <0.05%.

export type Point2D = { x: number; y: number };
export type Polygon = Point2D[];
export type SolverShape = Polygon[];

// Polygon-as-tuples is the wire format crossing the JS<->Python boundary.
// Pyodide auto-converts nested arrays of numbers; objects with x/y do too,
// but tuples are smaller and avoid an extra string-key allocation per point.
export type WirePoint = readonly [number, number];
export type WireRing = readonly WirePoint[];
export type WireShape = readonly WireRing[];

export function toWire(shape: SolverShape): WireShape {
  return shape.map((ring) => ring.map((p) => [p.x, p.y] as const));
}

// Signed area of a ring (Shoelace). Positive => CCW => outer; negative => CW => hole.
export function ringSignedArea(ring: Polygon): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function isCCW(ring: Polygon): boolean {
  return ringSignedArea(ring) > 0;
}

// Counts vertices whose turn angle exceeds `thresholdRad`. A turn of zero
// is "going straight"; a turn of ±π/2 is a 90° corner. Polygonized smooth
// curves (e.g. 64-gon circle) have small per-vertex turns and contribute
// nothing — exactly what mesh-density prediction wants, since smooth
// boundaries don't induce warping-function singularities. Sharp turns
// (interior angle far from 180°) do, and that's what drives FEM mesh
// concentration cost. Threshold ~30° distinguishes a coarse polygon
// approximation of a curve from a real corner.
export function sharpCornerCount(shape: SolverShape, thresholdRad = Math.PI / 6): number {
  let n = 0;
  for (const ring of shape) {
    const m = ring.length;
    if (m < 3) continue;
    for (let i = 0; i < m; i++) {
      const a = ring[(i - 1 + m) % m]!;
      const b = ring[i]!;
      const c = ring[(i + 1) % m]!;
      const ux = b.x - a.x, uy = b.y - a.y;
      const vx = c.x - b.x, vy = c.y - b.y;
      const cross = ux * vy - uy * vx;
      const dot   = ux * vx + uy * vy;
      if (Math.abs(Math.atan2(cross, dot)) > thresholdRad) n++;
    }
  }
  return n;
}
