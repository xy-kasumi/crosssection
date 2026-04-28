// Polygon-clipping helpers and other private machinery used by shape.ts /
// apply.ts / presets.ts. Not in the public surface; consumers must import
// only from `./index.ts`.
//
// Field-name freedom: internals may use cx/cy/x/y as upstream libraries
// expect. The public surface (in `index.ts`) controls what escapes.

import polygonClipping, { type MultiPolygon } from "polygon-clipping";

import type { AuthoringShape, Hole, Outline, Vec2 } from "./shape.ts";

const CIRCLE_N = 64; // polygonization for circles & disk outers (kept consistent with solver/presets.ts)

export type PCRing = readonly (readonly [number, number])[];

export function ringFromCircle(cx: number, cy: number, r: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < CIRCLE_N; i++) {
    const t = (i * 2 * Math.PI) / CIRCLE_N;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  // polygon-clipping wants closed rings (first == last).
  out.push([out[0]![0], out[0]![1]]);
  return out;
}

export function outlineToRing(o: Outline): [number, number][] {
  const r: [number, number][] = o.map((p) => [p.x, p.y]);
  if (r.length > 0) r.push([r[0]![0], r[0]![1]]);
  return r;
}

export function ringToOutline(r: PCRing): Outline {
  // Drop the closing duplicate.
  const n = r.length > 0 && r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1]
    ? r.length - 1 : r.length;
  const out: Outline = [];
  for (let i = 0; i < n; i++) out.push({ x: r[i]![0], y: r[i]![1] });
  return out;
}

export function rectOutline(cx: number, cy: number, w: number, h: number): Outline {
  const x0 = cx - w / 2, y0 = cy - h / 2, x1 = cx + w / 2, y1 = cy + h / 2;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

// Build a MultiPolygon for the outer envelope of an authoring shape (no
// holes). Used by erase/add-hole to test against the shape's outer boundary.
export function outerMultiPolygonOf(s: AuthoringShape): MultiPolygon {
  if (s.kind === "disk") {
    return [[ringFromCircle(s.cx, s.cy, s.r)]];
  }
  if (s.outers.length === 1) return [[outlineToRing(s.outers[0]!)]];
  return polygonClipping.union(
    ...s.outers.map((o): MultiPolygon => [[outlineToRing(o)]]),
  );
}

// Build a MultiPolygon for the union of all holes (circles + polygon).
export function holesMultiPolygon(holes: readonly Hole[]): MultiPolygon {
  if (holes.length === 0) return [];
  const parts: MultiPolygon[] = holes.map((h): MultiPolygon =>
    h.kind === "circle"
      ? [[ringFromCircle(h.cx, h.cy, h.r)]]
      : [[outlineToRing(h.outline)]],
  );
  return polygonClipping.union(...parts);
}

// Does any pair of non-adjacent edges in the ring cross? Adjacent edges
// (sharing a vertex) are skipped — they always touch by construction.
// Outlines are small (typically <50 vertices) so the O(n²) scan is fine
// at preview frame-rate.
export function selfIntersects(outline: Outline): boolean {
  const n = outline.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      // Skip the wrap-around adjacency (last edge meets first edge).
      if (i === 0 && j === n - 1) continue;
      const c = outline[j]!;
      const d = outline[(j + 1) % n]!;
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

// Proper crossing OR a non-endpoint touching point counts as intersection.
// Endpoint-to-endpoint contact is impossible here since adjacent pairs are
// excluded by the caller.
function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  // Collinear-overlap cases.
  if (d1 === 0 && onSegment(c, d, a)) return true;
  if (d2 === 0 && onSegment(c, d, b)) return true;
  if (d3 === 0 && onSegment(a, b, c)) return true;
  if (d4 === 0 && onSegment(a, b, d)) return true;
  return false;
}

function cross(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  return p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x)
      && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
}
