// Polygon-clipping helpers and 1µm quantization. Internal to geom/.

import polygonClipping, { type MultiPolygon } from "polygon-clipping";

import type { AuthoringShape, Hole, Outline, Vec2 } from "./shape.ts";

// MultiPolygon → AuthoringShape pieces. Each piece's first ring is the
// outer; subsequent rings are emergent polygon holes. Coords are quantized
// via ringToOutline.
export function decompose(mp: MultiPolygon): { outers: Outline[]; holes: Hole[] } {
  const outers: Outline[] = [];
  const holes: Hole[] = [];
  for (const piece of mp) {
    outers.push(ringToOutline(piece[0]!));
    for (let i = 1; i < piece.length; i++) {
      holes.push({ kind: "polygon", outline: ringToOutline(piece[i]!) });
    }
  }
  return { outers, holes };
}

const CIRCLE_N = 64; // polygonization for circles & disk outers (kept consistent with solver/presets.ts)
const Q = 10000;     // 0.1µm precision: stored coords are integer multiples of 1/Q mm.

export type PCRing = readonly (readonly [number, number])[];

export function quantize(v: number): number {
  return Math.round(v * Q) / Q;
}

export function quantizeVec(v: Vec2): Vec2 {
  return { x: quantize(v.x), y: quantize(v.y) };
}

export function quantizeOutline(o: Outline): Outline {
  return o.map((p) => ({ x: quantize(p.x), y: quantize(p.y) }));
}

export function ringFromCircle(cx: number, cy: number, r: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < CIRCLE_N; i++) {
    const t = (i * 2 * Math.PI) / CIRCLE_N;
    out.push([quantize(cx + r * Math.cos(t)), quantize(cy + r * Math.sin(t))]);
  }
  out.push([out[0]![0], out[0]![1]]);
  return out;
}

export function outlineToRing(o: Outline): [number, number][] {
  const r: [number, number][] = o.map((p) => [p.x, p.y]);
  if (r.length > 0) r.push([r[0]![0], r[0]![1]]);
  return r;
}

export function ringToOutline(r: PCRing): Outline {
  const closed = r.length > 0
    && r[0]![0] === r[r.length - 1]![0]
    && r[0]![1] === r[r.length - 1]![1];
  const n = closed ? r.length - 1 : r.length;
  const out: Outline = [];
  for (let i = 0; i < n; i++) out.push({ x: quantize(r[i]![0]), y: quantize(r[i]![1]) });
  return out;
}

export function rectOutline(cx: number, cy: number, w: number, h: number): Outline {
  const x0 = quantize(cx - w / 2), y0 = quantize(cy - h / 2);
  const x1 = quantize(cx + w / 2), y1 = quantize(cy + h / 2);
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

export function outerMultiPolygonOf(s: AuthoringShape): MultiPolygon {
  if (s.kind === "disk") return [[ringFromCircle(s.cx, s.cy, s.r)]];
  if (s.outers.length === 1) return [[outlineToRing(s.outers[0]!)]];
  const parts = s.outers.map((o): MultiPolygon => [[outlineToRing(o)]]);
  return polygonClipping.union(parts[0]!, ...parts.slice(1));
}

export function holesMultiPolygon(holes: readonly Hole[]): MultiPolygon {
  if (holes.length === 0) return [];
  const parts: MultiPolygon[] = holes.map((h): MultiPolygon =>
    h.kind === "circle"
      ? [[ringFromCircle(h.cx, h.cy, h.r)]]
      : [[outlineToRing(h.outline)]],
  );
  return polygonClipping.union(parts[0]!, ...parts.slice(1));
}

// Single ring as a MultiPolygon — convenient for hole-by-hole boolean tests.
export function holeMP(h: Hole): MultiPolygon {
  return h.kind === "circle"
    ? [[ringFromCircle(h.cx, h.cy, h.r)]]
    : [[outlineToRing(h.outline)]];
}

// Does any pair of non-adjacent edges in the ring cross? Adjacent edges
// (sharing a vertex) are skipped — they always touch by construction.
export function selfIntersects(outline: Outline): boolean {
  const n = outline.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // wrap-adjacency
      const c = outline[j]!;
      const d = outline[(j + 1) % n]!;
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
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
