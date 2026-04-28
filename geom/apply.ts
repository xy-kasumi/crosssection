// apply(base, op) → ApplyResult. The four-case trichotomy:
//
//   ok      — clean commit; new shape returned.
//   warning — committable but lossy (a circle prim becomes a polygon, or
//             a hole was silently dropped).
//   error   — geometry rejected (would empty / disconnect / break the shape).
//   invalid — Op is malformed; the contract was violated. Consumers should
//             treat this as a bug and crash.
//
// Invariants:
//   - apply is pure: it builds a *new* candidate shape, never edits the
//     base. Discarded ops therefore leave the base untouched by construction.
//   - "ok" and "warning" both imply the candidate is composable. We use
//     compose() itself as the final oracle, so what we hand back can always
//     be drawn and solved.

import polygonClipping, { type MultiPolygon } from "polygon-clipping";

import {
  holesMultiPolygon,
  outerMultiPolygonOf,
  outlineToRing,
  ringFromCircle,
  ringToOutline,
} from "./internal.ts";
import { compose } from "./shape.ts";
import type {
  AuthoringShape,
  CircleHole,
  ErrorTag,
  Hole,
  Outline,
  Selection,
  Vec2,
  WarnTag,
} from "./shape.ts";
import type { Op } from "./op.ts";

export interface OpOk {
  kind: "ok";
  shape: AuthoringShape;
  // Optional: which prim (in the new shape) the editor should select after
  // commit. Lets the user immediately drag the just-created prim.
  preselect?: Selection | null;
}

export type OpWarning = {
  kind: "warning";
  shape: AuthoringShape;
  preselect?: Selection | null;
} & WarnTag;

export type OpError = { kind: "error" } & ErrorTag;

// "invalid" means the Op's contract was violated — an out-of-range index, a
// negative radius, a kind mismatch (e.g. move-disk-center on a polygon).
// Consumers should treat this as a bug and crash; the diagnostic in
// `reason` is the only English string geom emits, exempt from the
// no-text-in-geom rule because it is never user-visible by contract.
export interface OpInvalid {
  kind: "invalid";
  reason: string;
}

export type ApplyResult = OpOk | OpWarning | OpError | OpInvalid;

// Op-validity convention:
//   - degenerate ops (rectangle with zero width or height; radius == 0) are
//     valid and return ok with the base unchanged. Callers don't need to clamp.
//   - negative radius / NaN can only come from a buggy op-builder; those are
//     invalid (contract violation).

export function apply(base: AuthoringShape, op: Op): ApplyResult {
  switch (op.kind) {
    case "paint-rect":        return paintRect(base, op.anchor, op.cursor);
    case "erase-rect":        return eraseRect(base, op.anchor, op.cursor);
    case "add-hole":          return addHole(base, op.center, op.cursor);
    case "move-vert":         return moveVert(base, op.sel, op.index, op.target);
    case "delete-vert":       return deleteVert(base, op.sel, op.index);
    case "move-disk-center":  return moveDiskCenter(base, op.target);
    case "move-disk-radius":  return moveDiskRadius(base, op.r);
    case "move-hole-center":  return moveHoleCenter(base, op.index, op.target);
    case "move-hole-radius":  return moveHoleRadius(base, op.index, op.r);
  }
}

// ----- paint-rect -----

function paintRect(base: AuthoringShape, p1: Vec2, p2: Vec2): ApplyResult {
  const rect = rectFromCorners(p1, p2);
  if (!rect) return noop(base);

  // Disks are polygonized via the same 64-sided approximation that compose()
  // produces, so the union and overlap test work against the actual disk
  // boundary — not an inscribed square that excludes 36% of the area.
  const baseOuterMP = outerMultiPolygonOf(base);
  const wasDisk = base.kind === "disk";

  // Union the new rect with the base outer(s). polygon-clipping returns
  // a MultiPolygon; >1 piece means the user's rect didn't overlap any outer
  // and would create a disconnected shape.
  const outerMP: MultiPolygon = polygonClipping.union(baseOuterMP, [[outlineToRing(rect)]]);
  if (outerMP.length === 0) return invalid("paint-rect: union produced empty MultiPolygon");
  if (outerMP.length > 1)   return err({ tag: "disconnects-shape" });

  const piece = outerMP[0]!;
  const newOuter = ringToOutline(piece[0]!);
  // polygon-clipping may produce sub-rings when the union creates an
  // interior hole (e.g. paint-rect bridging two outers around a gap). Fold
  // those into the holes list as polygon-holes.
  const computedHoles: Hole[] = piece.slice(1).map((r) => ({
    kind: "polygon", outline: ringToOutline(r),
  }));

  const candidate: AuthoringShape = {
    kind: "polygon",
    outers: [newOuter],
    holes: [...base.holes, ...computedHoles],
  };

  return finalize(candidate, { kind: "outer", index: 0 }, wasDisk ? { tag: "circle-lost" } : null);
}

// ----- erase-rect -----
//
// Erase = subtract the rect from the *filled region* of the shape (outer
// minus existing holes). The result, deconstructed back into outer + holes,
// is what we commit. This is general enough to handle both "slit through an
// edge" (modifies the outer) and "rect entirely inside" (creates a hole),
// uniformly. Two overlapping erase-rects naturally merge because we always
// recompute from the live filled region.
//
// Any circle prim whose identity gets dissolved by this op (a touched circle
// hole, or the disk outer itself) triggers the warning so the user knows
// drag-center / drag-radius is gone.

function eraseRect(base: AuthoringShape, p1: Vec2, p2: Vec2): ApplyResult {
  const rect = rectFromCorners(p1, p2);
  if (!rect) return noop(base);
  const rectMP: MultiPolygon = [[outlineToRing(rect)]];

  // Build the current filled region (outer \ all-holes).
  const outerMP = outerMultiPolygonOf(base);
  const allHolesMP = holesMultiPolygon(base.holes);
  const filled = allHolesMP.length > 0
    ? polygonClipping.difference(outerMP, allHolesMP)
    : outerMP;

  // Rect doesn't touch any solid material → no-op. Returning early here
  // keeps a disk's identity (and its handles) when the user drags an
  // erase-rect off-shape; without it we'd polygonize the unchanged outer.
  if (polygonClipping.intersection(filled, rectMP).length === 0) {
    return noop(base);
  }

  // Detect circle prims whose identity is consumed by this op:
  //   - any circle hole the rect touches
  //   - the disk outer itself, when the base is a disk (the result is always
  //     a polygon — we don't try to reconstruct a disk from the difference).
  let consumesCircle = base.kind === "disk";
  if (!consumesCircle) {
    for (const h of base.holes) {
      if (h.kind !== "circle") continue;
      const overlap = polygonClipping.intersection(rectMP, [[ringFromCircle(h.cx, h.cy, h.r)]]);
      if (overlap.length > 0) { consumesCircle = true; break; }
    }
  }

  const remaining = polygonClipping.difference(filled, rectMP);
  if (remaining.length === 0) return err({ tag: "empties-shape" });
  if (remaining.length > 1)   return err({ tag: "disconnects-shape" });

  // Deconstruct. piece[0] is the new outer; piece[1..] are emergent holes.
  const piece = remaining[0]!;
  const newOuter = ringToOutline(piece[0]!);
  const newPolyHoles: Hole[] = piece.slice(1).map((r) => ({
    kind: "polygon" as const, outline: ringToOutline(r),
  }));
  // Surviving circle holes = ones the rect didn't touch.
  const survivingCircles = base.holes.filter((h) =>
    h.kind === "circle" &&
    polygonClipping.intersection(rectMP, [[ringFromCircle(h.cx, h.cy, h.r)]]).length === 0,
  );

  const candidate: AuthoringShape = {
    kind: "polygon",
    outers: [newOuter],
    holes: [...survivingCircles, ...newPolyHoles],
  };
  const preselect: Selection = newPolyHoles.length > 0
    ? { kind: "hole", index: candidate.holes.length - 1 }
    : { kind: "outer", index: 0 };
  return finalize(candidate, preselect, consumesCircle ? { tag: "circle-lost" } : null);
}

// ----- add-hole -----
//
// Three cases:
//   - clean: circle entirely inside outer, no overlap with any existing
//            hole → commit as a circle-hole. AuthoringShape kind is preserved
//            (DiskShape stays DiskShape).
//   - clipped or merged: circle crosses the outer OR overlaps an existing
//            hole. The new circle would degenerate into an arc, which the
//            authoring model can't represent. We polygonize: subtract the
//            (hole ∩ outer) footprint plus any overlapped holes from the
//            outer boundary, then decompose. If the bite touches the outer
//            edge, the outer notches; if it doesn't, an emergent polygon
//            hole appears. Either way the result is a PolygonShape so the
//            authoring representation matches what compose() will produce.
//            Warning emitted (the new hole and any overlapped circles lose
//            their circle-ness identity).
//   - rejected: zero radius, or entirely outside the shape.

function addHole(base: AuthoringShape, center: Vec2, edge: Vec2): ApplyResult {
  const r = Math.hypot(edge.x - center.x, edge.y - center.y);
  return addHoleAt(base, center, r);
}

function addHoleAt(base: AuthoringShape, center: Vec2, r: number): ApplyResult {
  if (r === 0) return noop(base);
  if (!(r > 0)) return invalid(`add-hole: invalid radius ${r}`);

  const outerMP = outerMultiPolygonOf(base);
  const holeRing = ringFromCircle(center.x, center.y, r);
  const holeMP: MultiPolygon = [[holeRing]];

  const inside = polygonClipping.intersection(holeMP, outerMP);
  if (inside.length === 0) return warnNoop(base, { tag: "hole-outside-shape" });

  const outside = polygonClipping.difference(holeMP, outerMP);
  const crossesOuter = outside.length > 0;

  // Find existing holes the new circle touches.
  const overlappedIdxs: number[] = [];
  for (let i = 0; i < base.holes.length; i++) {
    const h = base.holes[i]!;
    const existingRing = h.kind === "circle"
      ? ringFromCircle(h.cx, h.cy, h.r)
      : outlineToRing(h.outline);
    if (polygonClipping.intersection(holeMP, [[existingRing]]).length > 0) {
      overlappedIdxs.push(i);
    }
  }

  // Clean placement: circle stays a circle, AuthoringShape kind preserved.
  if (!crossesOuter && overlappedIdxs.length === 0) {
    const newHole: Hole = { kind: "circle", cx: center.x, cy: center.y, r };
    const candidate: AuthoringShape = base.kind === "disk"
      ? { ...base, holes: [...base.holes, newHole] }
      : { kind: "polygon",
          outers: base.outers.map(cloneOutline),
          holes: [...base.holes, newHole] };
    return finalize(candidate, { kind: "hole", index: candidate.holes.length - 1 }, null);
  }

  // Clipped or merged: re-derive the filled region the same way erase-rect
  // does, treating (hole ∩ outer) ∪ overlapped-holes as the bite. The result
  // is always a PolygonShape — the disk identity is gone if it ever was.
  const overlappedHolesMP = overlappedIdxs.length > 0
    ? holesMultiPolygon(overlappedIdxs.map((i) => base.holes[i]!))
    : [];
  const biteMP = overlappedHolesMP.length > 0
    ? polygonClipping.union(inside, overlappedHolesMP)
    : inside;
  const survivingHoles = base.holes.filter((_, i) => !overlappedIdxs.includes(i));
  const survivingHolesMP = holesMultiPolygon(survivingHoles);
  const filled = survivingHolesMP.length > 0
    ? polygonClipping.difference(outerMP, survivingHolesMP)
    : outerMP;
  const newFilled = polygonClipping.difference(filled, biteMP);
  if (newFilled.length === 0) return err({ tag: "empties-shape" });
  if (newFilled.length > 1)   return err({ tag: "disconnects-shape" });

  const piece = newFilled[0]!;
  const newOuter = ringToOutline(piece[0]!);
  // Inner rings of the new filled region are emergent polygon holes (e.g.
  // a hole entirely inside the outer that didn't bite the boundary).
  const emergentHoles: Hole[] = piece.slice(1).map((ring) => ({
    kind: "polygon" as const, outline: ringToOutline(ring),
  }));

  const candidate: AuthoringShape = {
    kind: "polygon",
    outers: [newOuter],
    holes: [...survivingHoles, ...emergentHoles],
  };
  // Prefer to select an emergent hole (the one the user just created); else
  // the outer (if the bite went through the boundary).
  const preselect: Selection = emergentHoles.length > 0
    ? { kind: "hole", index: candidate.holes.length - 1 }
    : { kind: "outer", index: 0 };
  return finalize(candidate, preselect, { tag: "circle-lost" });
}

// ----- move-vert / delete-vert -----

function moveVert(base: AuthoringShape, sel: Selection, index: number, target: Vec2): ApplyResult {
  const ol = outlineForSel(base, sel);
  if (ol === null) return invalid(`move-vert: selection ${selDesc(sel)} has no editable outline`);
  if (index < 0 || index >= ol.length) return invalid(`move-vert: index ${index} out of range (length ${ol.length})`);
  const n = ol.length;
  const left = ol[(index - 1 + n) % n]!;
  const right = ol[(index + 1) % n]!;
  // Drop the dragged vertex when it lands on an adjacent neighbor — the
  // user's gesture for merging two corners. Snap is uniform (editor-model
  // invariant 6), so equality is exact when the cursor is over the neighbor.
  const collapseLeft = target.x === left.x && target.y === left.y;
  const collapseRight = target.x === right.x && target.y === right.y;
  let newOl: Outline;
  if (collapseLeft || collapseRight) {
    if (n <= 3) return err({ tag: "breaks-polygon" });
    newOl = ol.filter((_, i) => i !== index).map((p) => ({ x: p.x, y: p.y }));
  } else {
    newOl = ol.map((p, i) => (i === index ? { x: target.x, y: target.y } : { x: p.x, y: p.y }));
  }
  const candidate = withOutlineReplaced(base, sel, newOl);
  if (!candidate) return invalid(`move-vert: failed to apply outline to selection ${selDesc(sel)}`);
  return finalize(candidate, sel, null);
}

function deleteVert(base: AuthoringShape, sel: Selection, index: number): ApplyResult {
  const ol = outlineForSel(base, sel);
  if (ol === null) return invalid(`delete-vert: selection ${selDesc(sel)} has no editable outline`);
  if (index < 0 || index >= ol.length) return invalid(`delete-vert: index ${index} out of range`);
  if (ol.length <= 3) return err({ tag: "breaks-polygon" });
  const newOl = ol.filter((_, i) => i !== index).map((p) => ({ x: p.x, y: p.y }));
  const candidate = withOutlineReplaced(base, sel, newOl);
  if (!candidate) return invalid(`delete-vert: failed to apply outline to selection ${selDesc(sel)}`);
  return finalize(candidate, sel, null);
}

// ----- move-disk-* -----

function moveDiskCenter(base: AuthoringShape, target: Vec2): ApplyResult {
  if (base.kind !== "disk") return invalid("move-disk-center: base is not a disk");
  const candidate: AuthoringShape = { ...base, cx: target.x, cy: target.y, holes: [...base.holes] };
  return finalize(candidate, { kind: "disk" }, null);
}

function moveDiskRadius(base: AuthoringShape, r: number): ApplyResult {
  if (base.kind !== "disk") return invalid("move-disk-radius: base is not a disk");
  if (r === 0) return noop(base);
  if (!(r > 0)) return invalid(`move-disk-radius: invalid radius ${r}`);
  const candidate: AuthoringShape = { ...base, r, holes: [...base.holes] };
  return finalize(candidate, { kind: "disk" }, null);
}

// ----- move-hole-* -----
//
// Hole drag = remove this circle hole, then re-add a circle at the new
// (cx, cy, r). Reuses the add-hole pipeline so validity rules are identical:
// crossing the outer or hitting another hole produces a warning + polygon
// conversion; entirely outside is an error.

function moveHoleCenter(base: AuthoringShape, index: number, target: Vec2): ApplyResult {
  return reAddCircleHole(base, index, (h) => ({ cx: target.x, cy: target.y, r: h.r }));
}

function moveHoleRadius(base: AuthoringShape, index: number, r: number): ApplyResult {
  const target = base.holes[index];
  if (!target) return invalid(`hole index ${index} out of range (length ${base.holes.length})`);
  if (target.kind !== "circle") return invalid(`hole at index ${index} is a polygon, not a circle`);
  if (r === 0) return noop(base);
  if (!(r > 0)) return invalid(`move-hole-radius: invalid radius ${r}`);
  return reAddCircleHole(base, index, (h) => ({ cx: h.cx, cy: h.cy, r }));
}

function reAddCircleHole(
  base: AuthoringShape,
  index: number,
  next: (h: CircleHole) => { cx: number; cy: number; r: number },
): ApplyResult {
  const target = base.holes[index];
  if (!target) return invalid(`hole index ${index} out of range (length ${base.holes.length})`);
  if (target.kind !== "circle") return invalid(`hole at index ${index} is a polygon, not a circle`);
  const { cx, cy, r } = next(target);
  const withoutTarget: AuthoringShape = base.kind === "disk"
    ? { ...base, holes: base.holes.filter((_, i) => i !== index) }
    : { kind: "polygon",
        outers: base.outers.map(cloneOutline),
        holes: base.holes.filter((_, i) => i !== index) };
  return addHoleAt(withoutTarget, { x: cx, y: cy }, r);
}

// ----- helpers -----

function rectFromCorners(p1: Vec2, p2: Vec2): Outline | null {
  const x0 = Math.min(p1.x, p2.x), x1 = Math.max(p1.x, p2.x);
  const y0 = Math.min(p1.y, p2.y), y1 = Math.max(p1.y, p2.y);
  if (x1 === x0 || y1 === y0) return null;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function cloneOutline(o: Outline): Outline {
  return o.map((p) => ({ x: p.x, y: p.y }));
}

// Look up the polygon outline a Selection refers to, or null if the selected
// prim doesn't have an editable outline (disk, circle hole). Returns the
// live array — callers must clone before mutating.
function outlineForSel(s: AuthoringShape, sel: Selection): Outline | null {
  if (sel.kind === "outer") {
    if (s.kind !== "polygon") return null;
    return s.outers[sel.index] ?? null;
  }
  if (sel.kind === "hole") {
    const h = s.holes[sel.index];
    if (!h || h.kind !== "polygon") return null;
    return h.outline;
  }
  return null;
}

// Replace the outline at `sel` with `newOl`, returning a fresh shape. Other
// prims are cloned so the caller's input is never mutated.
function withOutlineReplaced(s: AuthoringShape, sel: Selection, newOl: Outline): AuthoringShape | null {
  if (sel.kind === "outer") {
    if (s.kind !== "polygon") return null;
    if (sel.index < 0 || sel.index >= s.outers.length) return null;
    const newOuters = s.outers.map((o, i) => (i === sel.index ? newOl : cloneOutline(o)));
    return { kind: "polygon", outers: newOuters, holes: [...s.holes] };
  }
  if (sel.kind === "hole") {
    if (sel.index < 0 || sel.index >= s.holes.length) return null;
    const target = s.holes[sel.index]!;
    if (target.kind !== "polygon") return null;
    const newHole: Hole = { kind: "polygon", outline: newOl };
    const newHoles = s.holes.map((hh, i) => (i === sel.index ? newHole : hh));
    if (s.kind === "disk") return { ...s, holes: newHoles };
    return { kind: "polygon", outers: s.outers.map(cloneOutline), holes: newHoles };
  }
  return null;
}

function selDesc(sel: Selection): string {
  if (sel.kind === "disk") return "disk";
  return `${sel.kind}#${sel.index}`;
}

// Final gate: compose() is the production validation oracle. If it accepts
// the candidate, the editor can commit it and the FEM solver will accept
// it too. `warning` is non-null when the op produced a result that commits
// cleanly but cost the user something they should know about (today: a
// circle hole became a polygon).
function finalize(
  candidate: AuthoringShape,
  preselect: Selection | null,
  opWarning: WarnTag | null,
): ApplyResult {
  const r = compose(candidate);
  if (!r.ok) {
    const { ok: _ok, ...tag } = r;
    return err(tag);
  }
  // Op-level warning (e.g. circle-lost) takes precedence over compose's
  // warning (a stale offending hole) — the user wants feedback about the
  // action they just took.
  const w = opWarning ?? r.warning ?? null;
  if (w !== null) return { kind: "warning", shape: candidate, preselect, ...w };
  return { kind: "ok", shape: candidate, preselect };
}

function err(tag: ErrorTag): OpError {
  return { kind: "error", ...tag };
}

function invalid(reason: string): OpInvalid {
  return { kind: "invalid", reason };
}

// Degenerate-but-valid ops (zero-area rect, zero radius): base unchanged,
// no selection change, no message.
function noop(base: AuthoringShape): OpOk {
  return { kind: "ok", shape: base, preselect: null };
}

// Op was geometrically a no-op but cost the user something they should
// know about (today: a hole placed outside the shape — silently dropped).
function warnNoop(base: AuthoringShape, warning: WarnTag): OpWarning {
  return { kind: "warning", shape: base, preselect: null, ...warning };
}
