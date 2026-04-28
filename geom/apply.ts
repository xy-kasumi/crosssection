// apply(base, op) is the closure operator over AuthoringShape (see shape.ts
// for the contract). Pattern: each builder returns Built (the candidate +
// optional warn) or {reason} for invalid. The gate runs `check()` once and
// converts violations to errors. Builders never fabricate errors themselves.

import polygonClipping, { type MultiPolygon } from "polygon-clipping";

import {
  holesMultiPolygon, outerMultiPolygonOf,
  outlineToRing, ringFromCircle, ringToOutline,
} from "./internal.ts";
import { check } from "./shape.ts";
import type {
  AuthoringShape, ErrorTag, Hole, Outline, Selection, Vec2, WarnTag,
} from "./shape.ts";
import type { Op } from "./op.ts";

export interface OpOk { kind: "ok"; shape: AuthoringShape; preselect: Selection | null }
export type OpWarning = { kind: "warning"; shape: AuthoringShape; preselect: Selection | null } & WarnTag;
export type OpError = { kind: "error" } & ErrorTag;
export interface OpInvalid { kind: "invalid"; reason: string }
export type ApplyResult = OpOk | OpWarning | OpError | OpInvalid;

interface Built { shape: AuthoringShape; preselect: Selection | null; warning: WarnTag | null }
type BuildResult = Built | { reason: string };

export function apply(base: AuthoringShape, op: Op): ApplyResult {
  const r = build(base, op);
  if ("reason" in r) return { kind: "invalid", reason: r.reason };
  const err = check(r.shape);
  if (err) return { kind: "error", ...err };
  if (r.warning) return { kind: "warning", shape: r.shape, preselect: r.preselect, ...r.warning };
  return { kind: "ok", shape: r.shape, preselect: r.preselect };
}

function build(base: AuthoringShape, op: Op): BuildResult {
  switch (op.kind) {
    case "paint-rect":       return paintRect(base, op.anchor, op.cursor);
    case "erase-rect":       return eraseRect(base, op.anchor, op.cursor);
    case "add-hole":         return addHole(base, op.center, op.cursor);
    case "move-vert":        return moveVert(base, op.sel, op.index, op.target);
    case "delete-vert":      return deleteVert(base, op.sel, op.index);
    case "move-disk-center": return moveDisk(base, { cx: op.target.x, cy: op.target.y });
    case "move-disk-radius": return moveDisk(base, { r: op.r });
    case "move-hole-center": return moveCircleHole(base, op.index, h => ({ cx: op.target.x, cy: op.target.y, r: h.r }));
    case "move-hole-radius": return moveCircleHole(base, op.index, h => ({ cx: h.cx, cy: h.cy, r: op.r }));
  }
}

// ----- shared helpers -----

const noopOf = (s: AuthoringShape): Built => ({ shape: s, preselect: null, warning: null });

function rectFromCorners(p1: Vec2, p2: Vec2): Outline | null {
  const x0 = Math.min(p1.x, p2.x), x1 = Math.max(p1.x, p2.x);
  const y0 = Math.min(p1.y, p2.y), y1 = Math.max(p1.y, p2.y);
  if (x0 === x1 || y0 === y1) return null;
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

// Decompose a polygon-clipping MultiPolygon into AuthoringShape pieces:
// each piece's outer ring becomes an outer; inner rings become polygon holes.
function decompose(mp: MultiPolygon): { outers: Outline[]; holes: Hole[] } {
  const outers: Outline[] = [];
  const holes: Hole[] = [];
  for (const piece of mp) {
    outers.push(ringToOutline(piece[0]!));
    for (let i = 1; i < piece.length; i++) {
      holes.push({ kind: "polygon", outline: ringToOutline(piece[i]!) });
    }
  }
  return outers.length > 0 ? { outers, holes } : { outers: [], holes };
}

// ----- ops -----

function paintRect(base: AuthoringShape, p1: Vec2, p2: Vec2): BuildResult {
  const rect = rectFromCorners(p1, p2);
  if (!rect) return noopOf(base);
  const u = polygonClipping.union(outerMultiPolygonOf(base), [[outlineToRing(rect)]]);
  const { outers, holes: emergent } = decompose(u);
  return {
    shape: { kind: "polygon", outers, holes: [...base.holes, ...emergent] },
    preselect: { kind: "outer", index: 0 },
    warning: base.kind === "disk" ? { tag: "circle-lost" } : null,
  };
}

function eraseRect(base: AuthoringShape, p1: Vec2, p2: Vec2): BuildResult {
  const rect = rectFromCorners(p1, p2);
  if (!rect) return noopOf(base);
  const rectMP: MultiPolygon = [[outlineToRing(rect)]];
  const filled = polygonClipping.difference(outerMultiPolygonOf(base), holesMultiPolygon(base.holes));
  // Off-shape erase is a true noop — keeps disk identity intact.
  if (polygonClipping.intersection(filled, rectMP).length === 0) return noopOf(base);

  const consumesCircle = base.kind === "disk" || base.holes.some((h) =>
    h.kind === "circle" &&
    polygonClipping.intersection(rectMP, [[ringFromCircle(h.cx, h.cy, h.r)]]).length > 0,
  );

  // Surviving circle holes (rect didn't touch). Polygon holes get re-derived
  // from the new filled region.
  const survivors = base.holes.filter((h) =>
    h.kind === "circle" &&
    polygonClipping.intersection(rectMP, [[ringFromCircle(h.cx, h.cy, h.r)]]).length === 0,
  );
  const newFilled = polygonClipping.difference(filled, rectMP);
  const { outers, holes: emergent } = decompose(newFilled);
  const holes = [...survivors, ...emergent];
  const preselect: Selection = emergent.length > 0
    ? { kind: "hole", index: holes.length - 1 }
    : { kind: "outer", index: 0 };
  return {
    shape: { kind: "polygon", outers, holes },
    preselect,
    warning: consumesCircle ? { tag: "circle-lost" } : null,
  };
}

function addHole(base: AuthoringShape, center: Vec2, edge: Vec2): BuildResult {
  const r = Math.hypot(edge.x - center.x, edge.y - center.y);
  if (r === 0) return noopOf(base);
  if (!(r > 0)) return { reason: `add-hole: invalid radius ${r}` };
  return addCircleHole(base, center.x, center.y, r);
}

// Auto-merges when the new circle crosses the outer or overlaps existing
// holes — the collision is subtracted from the filled region and the result
// re-decomposed. Clean placement keeps the new hole as a circle prim.
function addCircleHole(base: AuthoringShape, cx: number, cy: number, r: number): BuildResult {
  const outerMP = outerMultiPolygonOf(base);
  const holeMP: MultiPolygon = [[ringFromCircle(cx, cy, r)]];

  const inside = polygonClipping.intersection(holeMP, outerMP);
  if (inside.length === 0) {
    return { shape: base, preselect: null, warning: { tag: "hole-outside-shape" } };
  }
  const crossesOuter = polygonClipping.difference(holeMP, outerMP).length > 0;
  const overlappedIdxs: number[] = [];
  for (let i = 0; i < base.holes.length; i++) {
    const h = base.holes[i]!;
    const ring = h.kind === "circle" ? ringFromCircle(h.cx, h.cy, h.r) : outlineToRing(h.outline);
    if (polygonClipping.intersection(holeMP, [[ring]]).length > 0) overlappedIdxs.push(i);
  }

  // Clean: keep as a circle, kind preserved.
  if (!crossesOuter && overlappedIdxs.length === 0) {
    const newHole: Hole = { kind: "circle", cx, cy, r };
    const shape: AuthoringShape = base.kind === "disk"
      ? { ...base, holes: [...base.holes, newHole] }
      : { kind: "polygon", outers: base.outers.map(cloneOutline), holes: [...base.holes, newHole] };
    return { shape, preselect: { kind: "hole", index: shape.holes.length - 1 }, warning: null };
  }

  // Merge: subtract (hole ∩ outer) ∪ overlappedHoles from the filled region.
  const survivors = base.holes.filter((_, i) => !overlappedIdxs.includes(i));
  const survivorsMP = holesMultiPolygon(survivors);
  const overlappedMP = holesMultiPolygon(overlappedIdxs.map((i) => base.holes[i]!));
  const filled = survivorsMP.length > 0 ? polygonClipping.difference(outerMP, survivorsMP) : outerMP;
  const bite = overlappedMP.length > 0 ? polygonClipping.union(inside, overlappedMP) : inside;
  const newFilled = polygonClipping.difference(filled, bite);
  const { outers, holes: emergent } = decompose(newFilled);
  const holes = [...survivors, ...emergent];
  const preselect: Selection = emergent.length > 0
    ? { kind: "hole", index: holes.length - 1 }
    : { kind: "outer", index: 0 };
  return {
    shape: { kind: "polygon", outers, holes },
    preselect,
    warning: { tag: "circle-lost" },
  };
}

function moveVert(base: AuthoringShape, sel: Selection, index: number, target: Vec2): BuildResult {
  const ol = outlineForSel(base, sel);
  if (!ol) return { reason: `move-vert: ${selDesc(sel)} has no editable outline` };
  if (index < 0 || index >= ol.length) return { reason: `move-vert: index ${index} out of range` };
  const n = ol.length;
  const left = ol[(index - 1 + n) % n]!;
  const right = ol[(index + 1) % n]!;
  // Land on a neighbor → drop the dragged vertex (inverse of split).
  const collapse = (target.x === left.x && target.y === left.y)
                || (target.x === right.x && target.y === right.y);
  const newOl: Outline = collapse
    ? ol.filter((_, i) => i !== index).map((p) => ({ x: p.x, y: p.y }))
    : ol.map((p, i) => (i === index ? { x: target.x, y: target.y } : { x: p.x, y: p.y }));
  return replaceOutline(base, sel, newOl);
}

function deleteVert(base: AuthoringShape, sel: Selection, index: number): BuildResult {
  const ol = outlineForSel(base, sel);
  if (!ol) return { reason: `delete-vert: ${selDesc(sel)} has no editable outline` };
  if (index < 0 || index >= ol.length) return { reason: `delete-vert: index ${index} out of range` };
  const newOl = ol.filter((_, i) => i !== index).map((p) => ({ x: p.x, y: p.y }));
  return replaceOutline(base, sel, newOl);
}

function moveDisk(base: AuthoringShape, patch: { cx?: number; cy?: number; r?: number }): BuildResult {
  if (base.kind !== "disk") return { reason: `move-disk: base is not a disk` };
  if (patch.r === 0) return noopOf(base);
  if (patch.r !== undefined && !(patch.r > 0)) return { reason: `move-disk: invalid radius ${patch.r}` };
  const shape: AuthoringShape = {
    ...base,
    cx: patch.cx ?? base.cx,
    cy: patch.cy ?? base.cy,
    r: patch.r ?? base.r,
    holes: [...base.holes],
  };
  return { shape, preselect: { kind: "disk" }, warning: null };
}

// Drop the target hole, re-add at the new geometry — reuses addCircleHole.
function moveCircleHole(
  base: AuthoringShape,
  index: number,
  next: (h: { cx: number; cy: number; r: number }) => { cx: number; cy: number; r: number },
): BuildResult {
  const target = base.holes[index];
  if (!target) return { reason: `hole index ${index} out of range (length ${base.holes.length})` };
  if (target.kind !== "circle") return { reason: `hole at ${index} is a polygon, not a circle` };
  const { cx, cy, r } = next(target);
  if (r === 0) return noopOf(base);
  if (!(r > 0)) return { reason: `move-hole: invalid radius ${r}` };
  const without: AuthoringShape = base.kind === "disk"
    ? { ...base, holes: base.holes.filter((_, i) => i !== index) }
    : { kind: "polygon", outers: base.outers.map(cloneOutline), holes: base.holes.filter((_, i) => i !== index) };
  return addCircleHole(without, cx, cy, r);
}

// ----- selection helpers -----

function outlineForSel(s: AuthoringShape, sel: Selection): Outline | null {
  if (sel.kind === "outer") return s.kind === "polygon" ? (s.outers[sel.index] ?? null) : null;
  if (sel.kind === "hole") {
    const h = s.holes[sel.index];
    return h?.kind === "polygon" ? h.outline : null;
  }
  return null;
}

// Caller has already verified the outline exists at `sel` via outlineForSel.
function replaceOutline(base: AuthoringShape, sel: Selection, newOl: Outline): BuildResult {
  if (sel.kind === "outer" && base.kind === "polygon") {
    const outers = base.outers.map((o, i) => (i === sel.index ? newOl : cloneOutline(o)));
    return { shape: { kind: "polygon", outers, holes: [...base.holes] }, preselect: sel, warning: null };
  }
  if (sel.kind === "hole") {
    const newHole: Hole = { kind: "polygon", outline: newOl };
    const holes = base.holes.map((hh, i) => (i === sel.index ? newHole : hh));
    const shape: AuthoringShape = base.kind === "disk"
      ? { ...base, holes }
      : { kind: "polygon", outers: base.outers.map(cloneOutline), holes };
    return { shape, preselect: sel, warning: null };
  }
  return { reason: `replace-outline: ${selDesc(sel)} mismatched with shape` };
}

function cloneOutline(o: Outline): Outline { return o.map((p) => ({ x: p.x, y: p.y })); }
function selDesc(sel: Selection): string { return sel.kind === "disk" ? "disk" : `${sel.kind}#${sel.index}`; }
