// Op model — see docs/editor-model.md for the vocabulary and invariants.
//
// Every shape mutation in the editor goes through `previewOp(base, op)`. It
// returns either {kind:"ok", shape, ...} (the candidate shape, ready to
// commit) or {kind:"error", reason} (the op cannot commit cleanly).
//
// Invariants:
//   - previewOp is pure: it builds a *new* candidate shape, never edits the
//     base. Discarded ops therefore leave the base untouched by construction.
//   - "ok" implies the candidate is composable. We use compose() itself as
//     the final oracle, so what we hand back can always be drawn and solved.

import polygonClipping, { type MultiPolygon } from "polygon-clipping";

import {
  compose, outlineToRing, rectOutline, ringFromCircle, ringToOutline,
  type AuthoringShape, type Hole, type Outline, type PolygonShape,
  type Selection, type Vec2,
} from "./authoring.ts";

// ----- op types -----

export type Op =
  | { kind: "paint-rect"; anchor: Vec2; cursor: Vec2 }
  | { kind: "erase-rect"; anchor: Vec2; cursor: Vec2 }
  | { kind: "add-hole";   center: Vec2; cursor: Vec2 }
  // Circle-hole center/radius drag, treated as remove-then-add at the new
  // (cx, cy, r). Same validity gate as add-hole, with the original hole
  // excluded from the collision check.
  | { kind: "move-hole";  index: number; cx: number; cy: number; r: number };

export type OpKind = Op["kind"];

// Op results have three states:
//   ok      — commit cleanly, no caveats
//   warning — commit, but the user-visible model lost something (a circle
//             hole became a polygon — they'll lose the ability to drag its
//             center / radius). Single message; we don't categorize beyond
//             "circle-ness lost" because that's the only consequence the
//             user actually feels.
//   error   — cannot commit. Only three causes: zero-area op, would erase
//             everything, would disconnect the shape into pieces.
export interface OpOk {
  kind: "ok";
  shape: AuthoringShape;
  // Optional: which prim (in the new shape) the editor should select after
  // commit. Lets the user immediately drag the just-created prim.
  preselect?: Selection | null;
}

export interface OpWarning {
  kind: "warning";
  shape: AuthoringShape;
  preselect?: Selection | null;
  message: string;
}

export interface OpError {
  kind: "error";
  reason: string;
}

export type OpResult = OpOk | OpWarning | OpError;

// The one warning message the editor uses today. Centralized so it stays
// consistent across ops and easy to tweak. User-facing language: name the
// consequence (loss of drag-center/drag-radius), not the type change.
export const WARN_CIRCLE_LOST = "circle hole will become a polygon — you'll lose drag-center and drag-radius";

const MIN_DIM = 0.05; // mm — anything smaller than this is treated as zero

// Public: compute the candidate shape for an op against the given base.
// Returns "ok" with a shape that is guaranteed composable (compose() is the
// validation oracle), or "error" with a human-readable reason.
export function previewOp(base: AuthoringShape, op: Op): OpResult {
  switch (op.kind) {
    case "paint-rect": return previewPaintRect(base, op.anchor, op.cursor);
    case "erase-rect": return previewEraseRect(base, op.anchor, op.cursor);
    case "add-hole":   return previewAddHole(base, op.center, op.cursor);
    case "move-hole":  return previewMoveHole(base, op.index, op.cx, op.cy, op.r);
  }
}

// ----- paint-rect -----

function previewPaintRect(base: AuthoringShape, p1: Vec2, p2: Vec2): OpResult {
  const rect = rectFromCorners(p1, p2);
  if (!rect) return err("rectangle has zero area");

  // Disk → swap to inscribed-rect polygon so we have a polygon to union into.
  // Same UX choice as before; documented in the model.
  const polyBase: PolygonShape = base.kind === "disk"
    ? { kind: "polygon",
        outers: [rectOutline(base.cx, base.cy, base.r * Math.SQRT2, base.r * Math.SQRT2)],
        holes: [...base.holes] }
    : { kind: "polygon", outers: base.outers.map(cloneOutline), holes: [...base.holes] };

  // Union the new rect into the existing outer(s). polygon-clipping returns
  // a MultiPolygon; if the user's rect doesn't overlap any existing outer
  // we get >1 piece, which is a disconnected shape and an op error.
  const outerMP: MultiPolygon = polygonClipping.union(
    ...polyBase.outers.map((o): MultiPolygon => [[outlineToRing(o)]]),
    [[outlineToRing(rect)]],
  );
  if (outerMP.length === 0) return err("paint produced empty outer (impossible?)");
  if (outerMP.length > 1)   return err("rect doesn't overlap the existing shape (would create disconnected piece)");

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
    holes: [...polyBase.holes, ...computedHoles],
  };

  return finalize(candidate, { kind: "outer", index: 0 }, null);
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
// If the erase touches an existing circle hole, that circle's identity is
// dissolved — the new polygon-hole carries it forward — and we emit a
// warning so the user knows they've lost drag-center / drag-radius on it.

function previewEraseRect(base: AuthoringShape, p1: Vec2, p2: Vec2): OpResult {
  const rect = rectFromCorners(p1, p2);
  if (!rect) return err("rectangle has zero area");
  const rectMP: MultiPolygon = [[outlineToRing(rect)]];

  // Detect circle holes the rect touches; their circle identity is consumed.
  let consumesCircle = false;
  for (const h of base.holes) {
    if (h.kind !== "circle") continue;
    const overlap = polygonClipping.intersection(rectMP, [[ringFromCircle(h.cx, h.cy, h.r)]]);
    if (overlap.length > 0) { consumesCircle = true; break; }
  }

  // Build the current filled region (outer \ all-holes), then subtract rect.
  const outerMP = outerMultiPolygonOf(base);
  const allHolesMP = holesMultiPolygon(base.holes);
  const filled = allHolesMP.length > 0
    ? polygonClipping.difference(outerMP, allHolesMP)
    : outerMP;
  const remaining = polygonClipping.difference(filled, rectMP);
  if (remaining.length === 0) return err("shape would be erased entirely");
  if (remaining.length > 1)   return err("shape would be cut in two");

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
  return finalize(candidate, preselect, consumesCircle ? WARN_CIRCLE_LOST : null);
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

function previewAddHole(base: AuthoringShape, center: Vec2, edge: Vec2): OpResult {
  const r = Math.hypot(edge.x - center.x, edge.y - center.y);
  if (r < MIN_DIM) return err("hole has zero radius");

  const outerMP = outerMultiPolygonOf(base);
  const holeRing = ringFromCircle(center.x, center.y, r);
  const holeMP: MultiPolygon = [[holeRing]];

  const inside = polygonClipping.intersection(holeMP, outerMP);
  if (inside.length === 0) return err("hole is entirely outside the shape");

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
  if (newFilled.length === 0) return err("hole would erase the shape entirely");
  if (newFilled.length > 1)   return err("hole would disconnect the shape");

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
  return finalize(candidate, preselect, WARN_CIRCLE_LOST);
}

// ----- move-hole -----
//
// Hole drag = remove this circle hole, then re-add a circle at the new
// (cx, cy, r). Reuses the add-hole pipeline so validity rules are identical:
// crossing the outer or hitting another hole produces a warning + polygon
// conversion; entirely outside is an error. Caller is the editor's drag
// loop, which today commits only on "ok" (mid-drag polygon-conversion would
// invalidate the live drag handles).

function previewMoveHole(
  base: AuthoringShape, index: number, cx: number, cy: number, r: number,
): OpResult {
  const target = base.holes[index];
  if (!target || target.kind !== "circle") return err("can only move-hole a circle hole");

  const withoutTarget: AuthoringShape = base.kind === "disk"
    ? { ...base, holes: base.holes.filter((_, i) => i !== index) }
    : { kind: "polygon",
        outers: base.outers.map(cloneOutline),
        holes: base.holes.filter((_, i) => i !== index) };
  return previewAddHole(withoutTarget, { x: cx, y: cy }, { x: cx + r, y: cy });
}

// ----- helpers -----

function rectFromCorners(p1: Vec2, p2: Vec2): Outline | null {
  const x0 = Math.min(p1.x, p2.x), x1 = Math.max(p1.x, p2.x);
  const y0 = Math.min(p1.y, p2.y), y1 = Math.max(p1.y, p2.y);
  if (x1 - x0 < MIN_DIM || y1 - y0 < MIN_DIM) return null;
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

// Build a MultiPolygon for the outer envelope of an authoring shape (no
// holes). Used by erase/add-hole to test against the shape's outer boundary.
function outerMultiPolygonOf(s: AuthoringShape): MultiPolygon {
  if (s.kind === "disk") {
    return [[ringFromCircle(s.cx, s.cy, s.r)]];
  }
  if (s.outers.length === 1) return [[outlineToRing(s.outers[0]!)]];
  return polygonClipping.union(
    ...s.outers.map((o): MultiPolygon => [[outlineToRing(o)]]),
  );
}

// Build a MultiPolygon for the union of all holes (circles + polygon).
function holesMultiPolygon(holes: readonly Hole[]): MultiPolygon {
  if (holes.length === 0) return [];
  const parts: MultiPolygon[] = holes.map((h): MultiPolygon =>
    h.kind === "circle"
      ? [[ringFromCircle(h.cx, h.cy, h.r)]]
      : [[outlineToRing(h.outline)]],
  );
  return polygonClipping.union(...parts);
}

// Final gate: compose() is the production validation oracle. If it accepts
// the candidate, the editor can commit it and the FEM solver will accept
// it too. `warning` is non-null when the op produced a result that commits
// cleanly but cost the user something they should know about (today: a
// circle hole became a polygon).
function finalize(
  candidate: AuthoringShape,
  preselect: Selection | null,
  warning: string | null,
): OpResult {
  const r = compose(candidate);
  if (!r.ok) return err(r.reason);
  if (warning !== null) return { kind: "warning", shape: candidate, preselect, message: warning };
  return { kind: "ok", shape: candidate, preselect };
}

function err(reason: string): OpError {
  return { kind: "error", reason };
}
