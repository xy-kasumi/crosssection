// Polygon-clipping helpers and other private machinery used by shape.ts /
// apply.ts / presets.ts. Not in the public surface; consumers must import
// only from `./index.ts`.
//
// Field-name freedom: internals may use cx/cy/x/y as upstream libraries
// expect. The public surface (in `index.ts`) controls what escapes.

import polygonClipping, { type MultiPolygon } from "polygon-clipping";

import type { AuthoringShape, Hole, Outline } from "./shape.ts";

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
