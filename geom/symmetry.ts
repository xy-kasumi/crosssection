// Symmetrize: per-primitive orbit emission with canonical-region clamping.
// User-centred heuristic — see issue #1.
//
// Per-primitive rules:
//   DiskShape outer: center==origin → returned as-is. Otherwise polygonize
//     the disk, clamp to the canonical region, take the orbit, union → polygon.
//   PolygonShape outer: clamp each outer ring, take orbit, union → polygon.
//   CircleHole: filter by center membership in the canonical region (binary,
//     preserves circle identity); apply group transforms to the center;
//     dedupe by quantized (cx, cy); emit one circle hole per center.
//   PolygonHole: clamp + orbit-union, like the polygon outer.
//
// The raw candidate is then handed to `normalize` (handles every overlap
// case — overlapping circle holes get polygonized with circle-lost warning,
// holes outside the outer get dropped, etc.) and `check` (final contract).
// The trichotomy (ok / warning / error) mirrors `apply`'s ApplyResult so
// the UI can reuse status reporting.

import polygonClipping, { type MultiPolygon } from "polygon-clipping";

import {
  decompose, outerMultiPolygonOf, outlineToRing, quantize, ringFromCircle,
} from "./internal.ts";
import { normalize } from "./apply.ts";
import { check, isPolygonClippingFailure } from "./shape.ts";
import type {
  AuthoringShape, ErrorTag, Hole, Outline, WarnTag,
} from "./shape.ts";

export type SymGroup = "D1" | "D4";

export type SymComposeResult =
  | { kind: "ok"; shape: AuthoringShape }
  | ({ kind: "warning"; shape: AuthoringShape } & WarnTag)
  | ({ kind: "error" } & ErrorTag);

// Affine [a, b, c, d, e, f]: (x', y') = (a*x + b*y + e, c*x + d*y + f).
// Internal — not exposed; the public surface accepts only SymGroup keys.
type AffineMat = readonly [number, number, number, number, number, number];

const I_MAT:    AffineMat = [1, 0, 0, 1, 0, 0];
const REF_Y:    AffineMat = [-1, 0, 0, 1, 0, 0];   // (x,y) → (-x, y)
const R90:      AffineMat = [0, -1, 1, 0, 0, 0];
const R180:     AffineMat = [-1, 0, 0, -1, 0, 0];
const R270:     AffineMat = [0, 1, -1, 0, 0, 0];
const REF_X:    AffineMat = [1, 0, 0, -1, 0, 0];
const REF_YEQX: AffineMat = [0, 1, 1, 0, 0, 0];
const REF_YEQNX:AffineMat = [0, -1, -1, 0, 0, 0];

const TRANSFORMS: Record<SymGroup, readonly AffineMat[]> = {
  D1: [I_MAT, REF_Y],
  D4: [I_MAT, R90, R180, R270, REF_X, REF_Y, REF_YEQX, REF_YEQNX],
};

// Big enough to enclose any plausible mm-scale cross-section.
const B = 1e5;

const REGIONS: Record<SymGroup, Outline> = {
  D1: [
    { x: 0, y: -B }, { x: B, y: -B }, { x: B, y: B }, { x: 0, y: B },
  ],
  D4: [
    { x: 0, y: 0 }, { x: B, y: B }, { x: 0, y: B },
  ],
};

// Closed-boundary point-in-canonical-region test. Used to filter circle
// holes by their center.
function inRegion(cx: number, cy: number, group: SymGroup): boolean {
  if (group === "D1") return cx >= 0;
  return cx >= 0 && cy >= cx;
}

// Is this center invariant under every transform in `group`?
function fixed(cx: number, cy: number, group: SymGroup): boolean {
  if (group === "D1") return cx === 0;
  return cx === 0 && cy === 0;
}

function applyToPoint(t: AffineMat, x: number, y: number): { x: number; y: number } {
  return {
    x: quantize(t[0] * x + t[1] * y + t[4]),
    y: quantize(t[2] * x + t[3] * y + t[5]),
  };
}

function transformMP(mp: MultiPolygon, t: AffineMat): MultiPolygon {
  return mp.map(poly => poly.map(ring =>
    ring.map(([x, y]): [number, number] => [
      quantize(t[0] * x + t[1] * y + t[4]),
      quantize(t[2] * x + t[3] * y + t[5]),
    ]),
  ));
}

function clampToRegion(mp: MultiPolygon, group: SymGroup): MultiPolygon {
  return polygonClipping.intersection(mp, [[outlineToRing(REGIONS[group])]]);
}

function orbitUnion(mp: MultiPolygon, group: SymGroup): MultiPolygon {
  if (mp.length === 0) return mp;
  const ts = TRANSFORMS[group];
  if (ts.length === 1) return mp;
  const parts = ts.map(t => transformMP(mp, t));
  return polygonClipping.union(parts[0]!, ...parts.slice(1));
}

function dedupeCenters(pts: readonly { x: number; y: number }[]): { x: number; y: number }[] {
  const seen = new Set<string>();
  const out: { x: number; y: number }[] = [];
  for (const p of pts) {
    const key = `${p.x},${p.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

// Build a raw candidate AuthoringShape via per-primitive orbit emission.
// Returns null when the outer drops to empty (e.g. polygon shape entirely
// outside the canonical region). The candidate may have hole overlaps; the
// caller threads it through `normalize`.
function orbitEmit(s: AuthoringShape, group: SymGroup): AuthoringShape | null {
  const ts = TRANSFORMS[group];

  // ----- outer -----
  let outerDisk: { cx: number; cy: number; r: number } | null = null;
  let outerPolys: Outline[] = [];
  let emergentHoles: Hole[] = [];

  if (s.kind === "disk" && fixed(s.cx, s.cy, group)) {
    outerDisk = { cx: s.cx, cy: s.cy, r: s.r };
  } else {
    const outerMP: MultiPolygon = s.kind === "disk"
      ? [[ringFromCircle(s.cx, s.cy, s.r)]]
      : outerMultiPolygonOf(s);
    const clamped = clampToRegion(outerMP, group);
    if (clamped.length === 0) return null;
    const unioned = orbitUnion(clamped, group);
    if (unioned.length === 0) return null;
    const dec = decompose(unioned);
    outerPolys = dec.outers;
    emergentHoles = dec.holes;
  }

  // ----- holes -----
  const holes: Hole[] = [];
  for (const h of s.holes) {
    if (h.kind === "circle") {
      // Center filter (binary, preserves circle identity).
      if (!inRegion(h.cx, h.cy, group)) continue;
      const centers = dedupeCenters(ts.map(t => applyToPoint(t, h.cx, h.cy)));
      for (const c of centers) {
        holes.push({ kind: "circle", cx: c.x, cy: c.y, r: h.r });
      }
    } else {
      // Polygon hole: clamp + orbit-union; each piece becomes its own hole.
      const holeMp: MultiPolygon = [[outlineToRing(h.outline)]];
      const clamped = clampToRegion(holeMp, group);
      if (clamped.length === 0) continue;
      const unioned = orbitUnion(clamped, group);
      const dec = decompose(unioned);
      for (const outline of dec.outers) {
        holes.push({ kind: "polygon", outline });
      }
    }
  }

  if (outerDisk) {
    return { kind: "disk", cx: outerDisk.cx, cy: outerDisk.cy, r: outerDisk.r, holes };
  }
  return {
    kind: "polygon",
    outers: outerPolys,
    holes: [...emergentHoles, ...holes],
  };
}

// Identity short-circuit: if every primitive in s is fixed by the group AND
// the outer is a disk-at-origin, the result is structurally identical to s.
// Save the polygon-clipping work and return reference-equal.
function isAlreadySymmetric(s: AuthoringShape, group: SymGroup): boolean {
  if (s.kind !== "disk") return false;
  if (!fixed(s.cx, s.cy, group)) return false;
  for (const h of s.holes) {
    if (h.kind === "circle") {
      if (!fixed(h.cx, h.cy, group)) return false;
    } else {
      // Conservative: polygon holes go through orbit emission to be safe.
      return false;
    }
  }
  return true;
}

export function symCompose(s: AuthoringShape, group: SymGroup): SymComposeResult {
  try {
    if (isAlreadySymmetric(s, group)) return { kind: "ok", shape: s };

    const raw = orbitEmit(s, group);
    if (raw === null) return { kind: "error", tag: "empties-shape" };
    const n = normalize(raw, null);
    const err = check(n.shape);
    if (err) return { kind: "error", ...err };
    if (n.warning) return { kind: "warning", shape: n.shape, ...n.warning };
    return { kind: "ok", shape: n.shape };
  } catch (e) {
    if (isPolygonClippingFailure(e)) return { kind: "error", tag: "degenerate-shape" };
    throw e;
  }
}

// Polygons covering the *non*-canonical area within ±B. UI-side dim overlay
// reads this so the visual aid stays in lockstep with the canonical region
// definition above.
export function dimRegionsOf(group: SymGroup): Outline[] {
  if (group === "D1") {
    return [[
      { x: -B, y: -B }, { x: 0, y: -B }, { x: 0, y: B }, { x: -B, y: B },
    ]];
  }
  return [
    [{ x: -B, y: -B }, { x: B, y: -B }, { x: B, y: 0 }, { x: -B, y: 0 }],
    [{ x: 0, y: 0 }, { x: B, y: 0 }, { x: B, y: B }],
    [{ x: -B, y: 0 }, { x: 0, y: 0 }, { x: 0, y: B }, { x: -B, y: B }],
  ];
}
