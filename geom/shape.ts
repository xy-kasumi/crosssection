// AuthoringShape contract (enforced by `check`):
//
//   1. Outer is non-empty and a single connected piece.
//   2. Every outline (outers + polygon holes) has ≥3 vertices and is simple.
//   3. Holes lie inside the outer and are pairwise disjoint.
//   4. Multiple outers are pairwise disjoint.
//
// `apply(s, op)` is closed over the contract: input valid → output valid,
// or error. Where merging into a valid shape is possible (overlap, partial
// cross), `apply` auto-converts via `normalize`; the warn signals what was
// lost (circle identity; an outside hole that got dropped).
//
// `compose(s)` is a pure translation to SolverShape — never errors.
//
// All coords inside geom/ are exact multiples of 0.1µm (1/10000 mm); see
// internal.ts for the quantization rules.

import polygonClipping from "polygon-clipping";
import type { Polygon as SolverPolygon, SolverShape } from "@solver/shape.ts";
import {
  holeMP, holesMultiPolygon, outerMultiPolygonOf,
  outlineToRing, ringFromCircle, ringToOutline,
  selfIntersects,
} from "./internal.ts";

export type Vec2 = { x: number; y: number };
export type Outline = Vec2[];

export type CircleHole  = { kind: "circle";  cx: number; cy: number; r: number };
export type PolygonHole = { kind: "polygon"; outline: Outline };
export type Hole = CircleHole | PolygonHole;

export type DiskShape    = { kind: "disk";    cx: number; cy: number; r: number; holes: Hole[] };
export type PolygonShape = { kind: "polygon"; outers: Outline[]; holes: Hole[] };
export type AuthoringShape = DiskShape | PolygonShape;

export type Selection =
  | { kind: "outer"; index: number }
  | { kind: "disk" }
  | { kind: "hole"; index: number };

export type ErrorTag =
  | { tag: "empties-shape" }
  | { tag: "disconnects-shape" }
  | { tag: "self-intersecting"; outerIndex?: number; holeIndex?: number }
  | { tag: "breaks-polygon";    holeIndex?: number }
  | { tag: "hole-overlap";      holeIndex?: number }
  | { tag: "outers-overlap" };

// Each warn says "we lost something to make this op fit the contract".
export type WarnTag =
  | { tag: "circle-lost" }
  | { tag: "hole-outside-shape"; holeIndex?: number };

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

export function check(s: AuthoringShape): ErrorTag | null {
  // 1. Outline simplicity & vertex count.
  if (s.kind === "polygon") {
    if (s.outers.length === 0) return { tag: "empties-shape" };
    for (let i = 0; i < s.outers.length; i++) {
      const o = s.outers[i]!;
      if (o.length < 3) return { tag: "breaks-polygon" };
      if (selfIntersects(o)) return { tag: "self-intersecting", outerIndex: i };
    }
  } else if (!(s.r > 0)) {
    return { tag: "empties-shape" };
  }
  for (let i = 0; i < s.holes.length; i++) {
    const h = s.holes[i]!;
    if (h.kind !== "polygon") continue;
    if (h.outline.length < 3) return { tag: "breaks-polygon", holeIndex: i };
    if (selfIntersects(h.outline)) return { tag: "self-intersecting", holeIndex: i };
  }

  // 2. Outers must be pairwise disjoint.
  if (s.kind === "polygon" && s.outers.length > 1) {
    for (let i = 0; i < s.outers.length; i++) {
      for (let j = i + 1; j < s.outers.length; j++) {
        if (polygonClipping.intersection([[outlineToRing(s.outers[i]!)]], [[outlineToRing(s.outers[j]!)]]).length > 0) {
          return { tag: "outers-overlap" };
        }
      }
    }
  }

  // 3. Holes must be inside the outer and pairwise disjoint.
  const outerMP = outerMultiPolygonOf(s);
  for (let i = 0; i < s.holes.length; i++) {
    const mp = holeMP(s.holes[i]!);
    if (polygonClipping.difference(mp, outerMP).length > 0) {
      return { tag: "hole-overlap", holeIndex: i };
    }
    for (let j = 0; j < i; j++) {
      if (polygonClipping.intersection(mp, holeMP(s.holes[j]!)).length > 0) {
        return { tag: "hole-overlap", holeIndex: i };
      }
    }
  }

  // 4. Composability.
  const filled = polygonClipping.difference(outerMP, holesMultiPolygon(s.holes));
  if (filled.length === 0) return { tag: "empties-shape" };
  if (filled.length > 1) return { tag: "disconnects-shape" };
  return null;
}

export function compose(s: AuthoringShape): SolverShape {
  const filled = polygonClipping.difference(outerMultiPolygonOf(s), holesMultiPolygon(s.holes));
  return filled[0]!.map(ringToSolverPolygon);
}

export function authoringBBox(s: AuthoringShape): BBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const expand = (x: number, y: number) => {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  };
  if (s.kind === "disk") {
    expand(s.cx - s.r, s.cy - s.r);
    expand(s.cx + s.r, s.cy + s.r);
  } else {
    for (const o of s.outers) for (const p of o) expand(p.x, p.y);
  }
  for (const h of s.holes) {
    if (h.kind === "circle") {
      expand(h.cx - h.r, h.cy - h.r);
      expand(h.cx + h.r, h.cy + h.r);
    } else {
      for (const p of h.outline) expand(p.x, p.y);
    }
  }
  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function ringToSolverPolygon(r: readonly (readonly [number, number])[]): SolverPolygon {
  const n = r.length > 0 && r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1]
    ? r.length - 1 : r.length;
  const out: SolverPolygon = [];
  for (let i = 0; i < n; i++) out.push({ x: r[i]![0], y: r[i]![1] });
  return out;
}
