// Editor-facing shape representation. Distinct from `solver/shape.ts`'s
// FEM-facing types — same structural data but renamed to prevent the two
// from accidentally crossing the boundary. compose() is the single
// translation point.

import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import type { SolverShape, Polygon as SolverPolygon } from "@solver/shape.ts";

import {
  outerMultiPolygonOf,
  outlineToRing,
  ringFromCircle,
  ringToOutline,
  selfIntersects,
} from "./internal.ts";

export type Vec2 = { x: number; y: number };
export type Outline = Vec2[]; // ring; no closing duplicate

export type CircleHole  = { kind: "circle";  cx: number; cy: number; r: number };
export type PolygonHole = { kind: "polygon"; outline: Outline };
export type Hole = CircleHole | PolygonHole;

export type DiskShape    = { kind: "disk";    cx: number; cy: number; r: number; holes: Hole[] };
export type PolygonShape = { kind: "polygon"; outers: Outline[]; holes: Hole[] };
export type AuthoringShape = DiskShape | PolygonShape;

// Selection: addresses a specific editable primitive in an AuthoringShape.
export type Selection =
  | { kind: "outer"; index: number }       // outers[index] in PolygonShape
  | { kind: "disk" }                       // the disk itself in DiskShape
  | { kind: "hole"; index: number };       // shape.holes[index]

// Why a single ErrorTag/WarnTag for both compose() and apply(): from the
// caller's view there's no "compose" layer — only "did this op produce a
// valid geometry?" The same failure/warning modes fall out of both layers;
// rendering and highlighting work the same way regardless of which layer
// caught it.
//
// `holeIndex` / `outerIndex` are optional and present only when geom can
// pin the issue to a specific prim. UI may use them to highlight; the
// user-facing text doesn't need to expose the index.
//
// AuthoringShape invariants enforced by compose():
//   - every outline (outers + polygon holes) is simple — no edge crossings.
//   - holes lie entirely inside the outer (a hole entirely outside is the
//     one exception: silently dropped + warning).
//   - holes are pairwise disjoint.
//   - multiple outers don't overlap.
export type ErrorTag =
  | { tag: "empties-shape" }
  | { tag: "disconnects-shape" }
  | { tag: "breaks-polygon";     holeIndex?: number }
  | { tag: "self-intersecting";  outerIndex?: number; holeIndex?: number }
  | { tag: "hole-overlap";       holeIndex?: number }
  | { tag: "outers-overlap" };

// A hole that lies entirely outside the outer is silently dropped from the
// result; it's lossy but recoverable, so it's a warning rather than an
// error. circle-lost fires when a circle prim becomes a polygon.
export type WarnTag =
  | { tag: "circle-lost" }
  | { tag: "hole-outside-shape"; holeIndex?: number };

export type ComposeOk    = { ok: true;  shape: SolverShape; warning?: WarnTag };
export type ComposeError = { ok: false } & ErrorTag;
export type ComposeResult = ComposeOk | ComposeError;

export function compose(s: AuthoringShape): ComposeResult {
  // 1. Build the outer ring(s) and check simplicity + disjointness.
  let outerMP: MultiPolygon;
  if (s.kind === "disk") {
    if (!(s.r > 0)) return { ok: false, tag: "empties-shape" };
    outerMP = outerMultiPolygonOf(s);
  } else {
    const rings = s.outers.map(outlineToRing).filter((r) => r.length >= 4);
    if (rings.length === 0) return { ok: false, tag: "empties-shape" };
    for (let i = 0; i < s.outers.length; i++) {
      if (selfIntersects(s.outers[i]!)) {
        return { ok: false, tag: "self-intersecting", outerIndex: i };
      }
    }
    // Pairwise overlap on multi-outer shapes. polygon-clipping union would
    // silently merge overlapping outers; we want to reject instead.
    for (let i = 0; i < rings.length; i++) {
      for (let j = i + 1; j < rings.length; j++) {
        if (polygonClipping.intersection([[rings[i]!]], [[rings[j]!]]).length > 0) {
          return { ok: false, tag: "outers-overlap" };
        }
      }
    }
    outerMP = polygonClipping.union(...rings.map((r): MultiPolygon => [[r]]));
  }
  if (outerMP.length === 0) return { ok: false, tag: "empties-shape" };
  if (outerMP.length > 1)   return { ok: false, tag: "disconnects-shape" };
  const piece = outerMP[0]!;
  const outer = piece[0]!;

  // 2. Validate user-declared holes against the invariants.
  //    - polygon-hole outlines must be simple.
  //    - each hole must not partially cross the outer (entirely outside is
  //      the recoverable warning case; entirely inside is required).
  //    - holes must be pairwise disjoint.
  const userHoles: Outline[] = [];
  const acceptedRings: [number, number][][] = []; // rings of holes that passed containment
  let warning: WarnTag | null = null;
  for (let i = 0; i < s.holes.length; i++) {
    const h = s.holes[i]!;
    if (h.kind === "polygon" && selfIntersects(h.outline)) {
      return { ok: false, tag: "self-intersecting", holeIndex: i };
    }
    const ring = h.kind === "circle" ? ringFromCircle(h.cx, h.cy, h.r) : outlineToRing(h.outline);
    if (ring.length < 4) return { ok: false, tag: "breaks-polygon", holeIndex: i };
    const holeMP: MultiPolygon = [[ring]];
    const inside = polygonClipping.intersection(holeMP, [piece]);
    if (inside.length === 0) {
      // Entirely outside the outer: recoverable, drop with warning.
      if (warning === null) warning = { tag: "hole-outside-shape", holeIndex: i };
      continue;
    }
    if (polygonClipping.difference(holeMP, [piece]).length > 0) {
      // Partial cross: hole overlaps the outer boundary.
      return { ok: false, tag: "hole-overlap", holeIndex: i };
    }
    // Pairwise overlap with already-accepted holes.
    for (const prev of acceptedRings) {
      if (polygonClipping.intersection(holeMP, [[prev]]).length > 0) {
        return { ok: false, tag: "hole-overlap", holeIndex: i };
      }
    }
    acceptedRings.push(ring);
    userHoles.push(ringToOutline(ring));
  }

  const shape: SolverShape = [
    ringToSolverPolygon(outer),
    ...userHoles.map(outlineToSolverPolygon),
  ];
  return warning !== null ? { ok: true, shape, warning } : { ok: true, shape };
}

type PCRing = readonly (readonly [number, number])[];

function ringToSolverPolygon(r: PCRing): SolverPolygon {
  const n = r.length > 0 && r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1]
    ? r.length - 1 : r.length;
  const out: SolverPolygon = [];
  for (let i = 0; i < n; i++) out.push({ x: r[i]![0], y: r[i]![1] });
  return out;
}

function outlineToSolverPolygon(o: Outline): SolverPolygon {
  return o.map((p) => ({ x: p.x, y: p.y }));
}

// ---------- bounding box (for canvas viewport fit) ----------

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

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
  // Holes affect the visible drawing too, so their extents matter for fit.
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
