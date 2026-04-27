// 2D cross-section geometry types.
// First polygon is the outer ring (CCW). Subsequent polygons are inner holes (CW).
// Curves enter as fine-enough polygons; n=64 keeps Ix discretization error <0.05%.

export type Point2D = { x: number; y: number };
export type Polygon = Point2D[];
export type Shape = Polygon[];

// Polygon-as-tuples is the wire format crossing the JS<->Python boundary.
// Pyodide auto-converts nested arrays of numbers; objects with x/y do too,
// but tuples are smaller and avoid an extra string-key allocation per point.
export type WirePoint = readonly [number, number];
export type WireRing = readonly WirePoint[];
export type WireShape = readonly WireRing[];

export function toWire(shape: Shape): WireShape {
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
