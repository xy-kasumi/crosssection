// AuthoringShape contract (enforced by `check`):
//
//   1. Outer is non-empty and a single connected piece.
//   2. Every outline (outers + polygon holes) has ≥3 vertices and is simple.
//   3. (outer ∖ holes) is exactly one piece — i.e. the shape is composable.
//
// Overlap among holes (or between a hole and the outer perim) is *not*
// rejected by the contract: `compose` canonicalizes via boolean ops, so
// overlap is geometrically equivalent to its union. Ops that create
// overlap therefore return `ok` or `warning`, never `error`. (Stricter
// no-overlap rule TBD; would require generic auto-merge in apply.)
//
// `compose(s)` is a pure translation to SolverShape — never errors.

import polygonClipping from "polygon-clipping";
import type { Polygon as SolverPolygon, SolverShape } from "@solver/shape.ts";
import {
  holesMultiPolygon, outerMultiPolygonOf,
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

// Each tag is a distinct violation of the AuthoringShape contract.
export type ErrorTag =
  | { tag: "empties-shape" }
  | { tag: "disconnects-shape" }
  | { tag: "self-intersecting"; outerIndex?: number; holeIndex?: number }
  | { tag: "breaks-polygon";    holeIndex?: number };

// An auto-conversion `apply` performed to keep the result in-contract. Each
// warn says "we lost something to make this work".
export type WarnTag =
  | { tag: "circle-lost" }
  | { tag: "hole-outside-shape"; holeIndex?: number };

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

// First contract violation in `s`, or null. The single source of truth for
// "is this AuthoringShape valid?".
export function check(s: AuthoringShape): ErrorTag | null {
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
  // Composability: outer minus holes is exactly one piece. Catches every
  // overlap/disconnect case without enumerating them.
  const filled = polygonClipping.difference(outerMultiPolygonOf(s), holesMultiPolygon(s.holes));
  if (filled.length === 0) return { tag: "empties-shape" };
  if (filled.length > 1) return { tag: "disconnects-shape" };
  return null;
}

// Pure translation. Caller must have passed `check`; result is well-defined.
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
