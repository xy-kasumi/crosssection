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
// `holeIndex` is optional and present only when geom can pin the issue to a
// specific hole. UI may use it to highlight; the user-facing text doesn't
// need to expose the index.
export type ErrorTag =
  | { tag: "empties-shape" }
  | { tag: "disconnects-shape" }
  | { tag: "breaks-polygon";  holeIndex?: number };

// A hole that lies outside (or crosses) the outer is silently dropped from
// the result; it's lossy but recoverable, so it's a warning rather than an
// error. circle-lost fires when a circle prim becomes a polygon.
export type WarnTag =
  | { tag: "circle-lost" }
  | { tag: "hole-outside-shape"; holeIndex?: number };

export type ComposeOk    = { ok: true;  shape: SolverShape; warning?: WarnTag };
export type ComposeError = { ok: false } & ErrorTag;
export type ComposeResult = ComposeOk | ComposeError;

export function compose(s: AuthoringShape): ComposeResult {
  // Build the outer ring(s).
  let outerMP: MultiPolygon;
  if (s.kind === "disk") {
    if (!(s.r > 0)) return { ok: false, tag: "empties-shape" };
    outerMP = outerMultiPolygonOf(s);
  } else {
    const outerRings = s.outers.map(outlineToRing).filter((r) => r.length >= 4);
    if (outerRings.length === 0) return { ok: false, tag: "empties-shape" };
    outerMP = polygonClipping.union(...outerRings.map((r): MultiPolygon => [[r]]));
  }
  if (outerMP.length === 0) return { ok: false, tag: "empties-shape" };
  if (outerMP.length > 1)   return { ok: false, tag: "disconnects-shape" };

  // The single piece may already have computed holes (from polygon-clipping merging
  // outers that overlap). It shouldn't, in our model, but defend against it.
  const piece = outerMP[0]!;
  const outer = piece[0]!;
  const computedHoles = piece.slice(1);

  // Add user-declared holes. Holes with too few points are an error (we
  // can't represent them). Holes that lie outside or cross the outer get
  // silently dropped + warning — recoverable lossy.
  const userHoles: Outline[] = [];
  let warning: WarnTag | null = null;
  for (let i = 0; i < s.holes.length; i++) {
    const h = s.holes[i]!;
    const ring = h.kind === "circle" ? ringFromCircle(h.cx, h.cy, h.r) : outlineToRing(h.outline);
    if (ring.length < 4) return { ok: false, tag: "breaks-polygon", holeIndex: i };
    const holeMP: MultiPolygon = [[ring]];
    const outside = polygonClipping.difference(holeMP, [piece]);
    if (outside.length > 0) {
      if (warning === null) warning = { tag: "hole-outside-shape", holeIndex: i };
      continue;
    }
    userHoles.push(ringToOutline(ring));
  }

  const shape: SolverShape = [
    ringToSolverPolygon(outer),
    ...computedHoles.map(ringToSolverPolygon),
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
