// Disk-outer + rect-tool interactions. The user flagged two bugs from
// pre-rearchitecture days that this file pins down:
//
//   1. rod (D=5) → erase-rect crossing the disk edge → currently `ok` (no
//      warning), but the disk has been polygonized — drag-center/radius
//      are gone. The user expects `warning` because circle identity was
//      consumed.
//
//   2. rod (D=5) → paint-rect crossing the disk edge → currently `error`
//      ("rect doesn't overlap the existing shape") because paint-rect
//      approximates the disk as its inscribed square. The expected
//      result is `warning` (paint succeeded, disk → polygon).
//
// Both reduce to the same root: when an outer-modifying op turns a disk
// into a polygon, that's a circle-loss, same UX consequence as the
// circle-hole-becomes-polygon case.

import { test } from "node:test";
import assert from "node:assert/strict";

import { apply, type Op } from "../index.ts";
import { rodOf } from "../presets.ts";

test("rod → erase-rect crossing the boundary → warning, disk identity lost", () => {
  const rod = rodOf(5); // r=2.5
  // Rect spans x=2..3, y=0..1 — partially inside the disk, partially outside.
  const op: Op = { kind: "erase-rect", anchor: { x: 2, y: 0 }, cursor: { x: 3, y: 1 } };
  const r = apply(rod, op);
  assert.equal(r.kind, "warning");
  if (r.kind !== "warning") return;
  assert.equal(r.shape.kind, "polygon");
});

test("rod → paint-rect crossing the boundary → warning, disk identity lost", () => {
  const rod = rodOf(5); // r=2.5
  // Rect spans x=2..3, y=0..1 — does NOT overlap the disk's inscribed square
  // (~3.54 wide ⇒ x∈±1.77), but DOES overlap the actual disk. Pre-fix this
  // returned an `error` because the disk was approximated as inscribed-square.
  const op: Op = { kind: "paint-rect", anchor: { x: 2, y: 0 }, cursor: { x: 3, y: 1 } };
  const r = apply(rod, op);
  assert.equal(r.kind, "warning");
  if (r.kind !== "warning") return;
  assert.equal(r.shape.kind, "polygon");
});

test("rod → paint-rect entirely outside the disk → error (disconnected piece)", () => {
  // Sanity: the polygonized-disk fix must not regress the genuine
  // "rect doesn't touch the shape" case.
  const rod = rodOf(5);
  const op: Op = { kind: "paint-rect", anchor: { x: 10, y: 10 }, cursor: { x: 11, y: 11 } };
  const r = apply(rod, op);
  assert.equal(r.kind, "error");
});

test("rod → paint-rect entirely inside the disk → ok (rect absorbed, disk identity lost)", () => {
  // Paint-rect strictly inside a disk: the union is just the disk, but the
  // op still produces a polygon outer because we polygonize the disk to do
  // the union. Identity loss → warning.
  const rod = rodOf(20); // r=10, plenty of room
  const op: Op = { kind: "paint-rect", anchor: { x: -1, y: -1 }, cursor: { x: 1, y: 1 } };
  const r = apply(rod, op);
  // Acceptable: warning (disk polygonized). Whatever we choose to do here
  // is fine as long as it's not error.
  assert.notEqual(r.kind, "error");
  if (r.kind === "ok" || r.kind === "warning") {
    assert.equal(r.shape.kind, "polygon");
  }
});
