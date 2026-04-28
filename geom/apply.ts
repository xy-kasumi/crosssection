// apply(base, op) is the closure operator over AuthoringShape (see shape.ts
// for the contract). Pipeline: build → normalize → check → wrap.
//
//   build      Each op produces a *raw* candidate (may have overlap).
//              Returns Built (or {reason} for invalid).
//   normalize  Polygonize-and-merge any overlap; drop fully-outside holes.
//              Emits warn for circle-loss / hole-drop. The single auto-
//              conversion engine: per-op merge logic stays trivial.
//   check      Single error gate (shape.ts). Per-op code never fabricates errors.

import polygonClipping, { type MultiPolygon } from "polygon-clipping";

import {
  decompose, holeMP, holesMultiPolygon, outerMultiPolygonOf,
  outlineToRing, quantize, quantizeVec,
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
  const r = build(base, qOp(op));
  if ("reason" in r) return { kind: "invalid", reason: r.reason };
  const n = normalize(r.shape, r.preselect);
  const err = check(n.shape);
  if (err) return { kind: "error", ...err };
  const warning = r.warning ?? n.warning;
  if (warning) return { kind: "warning", shape: n.shape, preselect: n.preselect, ...warning };
  return { kind: "ok", shape: n.shape, preselect: n.preselect };
}

// Quantize all coord-bearing op fields at the boundary. After this every
// number that flows into a builder is on the 1µm grid.
function qOp(op: Op): Op {
  switch (op.kind) {
    case "paint-rect":
    case "erase-rect": return { ...op, anchor: quantizeVec(op.anchor), cursor: quantizeVec(op.cursor) };
    case "add-hole":   return { ...op, center: quantizeVec(op.center), cursor: quantizeVec(op.cursor) };
    case "move-vert":  return { ...op, target: quantizeVec(op.target) };
    case "move-disk-center": return { ...op, target: quantizeVec(op.target) };
    case "move-disk-radius": return { ...op, r: quantize(op.r) };
    case "move-hole-center": return { ...op, target: quantizeVec(op.target) };
    case "move-hole-radius": return { ...op, r: quantize(op.r) };
    case "delete-vert": return op;
  }
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

// ----- normalize -----
//
// Take a raw candidate (may have overlap or out-of-bounds holes) and
// produce a canonical, contract-valid shape. Walks each hole once, sorts
// into {good, bad, dropped}, then re-derives the shape if anything moved.

export function normalize(s: AuthoringShape, preselect: Selection | null): {
  shape: AuthoringShape; preselect: Selection | null; warning: WarnTag | null;
} {
  const outerMP = outerMultiPolygonOf(s);

  const good: Hole[] = [];
  const bad: Hole[] = [];
  let droppedIdx: number | null = null;

  for (let i = 0; i < s.holes.length; i++) {
    const h = s.holes[i]!;
    const mp = holeMP(h);
    if (polygonClipping.intersection(mp, outerMP).length === 0) {
      if (droppedIdx === null) droppedIdx = i;
      continue;
    }
    if (polygonClipping.difference(mp, outerMP).length > 0) {
      bad.push(h);
      continue;
    }
    let overlapsOther = false;
    for (let j = 0; j < s.holes.length; j++) {
      if (i === j) continue;
      if (polygonClipping.intersection(mp, holeMP(s.holes[j]!)).length > 0) {
        overlapsOther = true;
        break;
      }
    }
    if (overlapsOther) bad.push(h); else good.push(h);
  }

  const outersDirty = s.kind === "polygon" && s.outers.length > 1
    && outerMP.length < s.outers.length;

  // Fast path: nothing to fix.
  if (bad.length === 0 && droppedIdx === null && !outersDirty) {
    return { shape: s, preselect, warning: null };
  }

  // Slow path: re-derive. Build the dirty region (bad holes ∪ outer
  // self-overlaps) as a "bite" subtracted from the merged outer; the
  // emergent shape becomes a polygon with `good` preserved as-is.
  let warning: WarnTag | null = null;
  if (droppedIdx !== null) warning = { tag: "hole-outside-shape", holeIndex: droppedIdx };

  if (bad.length === 0 && !outersDirty) {
    // Only drops to apply.
    const shape: AuthoringShape = s.kind === "disk"
      ? { ...s, holes: good }
      : { kind: "polygon", outers: s.outers.map(cloneOutline), holes: good };
    return { shape, preselect: remapPreselect(preselect, shape), warning };
  }

  const badMP = holesMultiPolygon(bad);
  const filled = badMP.length > 0 ? polygonClipping.difference(outerMP, badMP) : outerMP;
  const { outers, holes: emergent } = decompose(filled);
  const shape: AuthoringShape = {
    kind: "polygon",
    outers,
    holes: [...good, ...emergent],
  };

  // circle-lost fires whenever a circle prim's identity gets dissolved.
  const circleLost = s.kind === "disk" || bad.some((h) => h.kind === "circle");
  if (circleLost) warning = { tag: "circle-lost" };

  return { shape, preselect: remapPreselect(preselect, shape), warning };
}

function remapPreselect(preselect: Selection | null, s: AuthoringShape): Selection | null {
  if (!preselect) return null;
  if (preselect.kind === "disk") return s.kind === "disk" ? preselect : { kind: "outer", index: 0 };
  if (preselect.kind === "outer") {
    if (s.kind === "polygon" && preselect.index < s.outers.length) return preselect;
    return s.kind === "polygon" ? { kind: "outer", index: 0 } : null;
  }
  if (preselect.index < s.holes.length) return preselect;
  if (s.holes.length > 0) return { kind: "hole", index: s.holes.length - 1 };
  return s.kind === "polygon" ? { kind: "outer", index: 0 } : null;
}

// ----- shared helpers -----

const noopOf = (s: AuthoringShape): Built => ({ shape: s, preselect: null, warning: null });

function rectFromCorners(p1: Vec2, p2: Vec2): Outline | null {
  const x0 = Math.min(p1.x, p2.x), x1 = Math.max(p1.x, p2.x);
  const y0 = Math.min(p1.y, p2.y), y1 = Math.max(p1.y, p2.y);
  if (x0 === x1 || y0 === y1) return null;
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
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
  if (polygonClipping.intersection(filled, rectMP).length === 0) return noopOf(base);

  const consumesCircle = base.kind === "disk" || base.holes.some((h) =>
    h.kind === "circle" && polygonClipping.intersection(rectMP, holeMP(h)).length > 0,
  );
  const survivors = base.holes.filter((h) =>
    h.kind === "circle" && polygonClipping.intersection(rectMP, holeMP(h)).length === 0,
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

// Trivial: insert as a circle. normalize handles cross/overlap/outside.
function addHole(base: AuthoringShape, center: Vec2, edge: Vec2): BuildResult {
  const r = quantize(Math.hypot(edge.x - center.x, edge.y - center.y));
  if (r === 0) return noopOf(base);
  if (!(r > 0)) return { reason: `add-hole: invalid radius ${r}` };
  return addCircleHole(base, center.x, center.y, r);
}

function addCircleHole(base: AuthoringShape, cx: number, cy: number, r: number): BuildResult {
  const newHole: Hole = { kind: "circle", cx, cy, r };
  const shape: AuthoringShape = base.kind === "disk"
    ? { ...base, holes: [...base.holes, newHole] }
    : { kind: "polygon", outers: base.outers.map(cloneOutline), holes: [...base.holes, newHole] };
  return { shape, preselect: { kind: "hole", index: shape.holes.length - 1 }, warning: null };
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
