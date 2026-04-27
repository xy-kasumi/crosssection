// Translate-prim associativity. The editor doesn't actually chain frames
// (its drag is base-relative), but the kernel property still has to hold:
// dragging by `a` and then by `b` should land in the same place as dragging
// by `a + b`. If this ever drifted, a slow drag and a fast drag over the
// same distance would produce different geometry — confusing UX.
//
// translate-prim only handles circle prims (disks and circle holes); polygon
// outers and polygon holes don't translate as a unit.

import { test } from "node:test";
import assert from "node:assert/strict";

import { apply, type AuthoringShape, type Op, type Vec2 } from "../index.ts";
import { rodOf } from "../presets.ts";

function translateDisk(delta: Vec2): Op {
  return { kind: "translate-prim", sel: { kind: "disk" }, delta };
}

function applyOk(s: AuthoringShape, op: Op): AuthoringShape {
  const r = apply(s, op);
  if (r.kind !== "ok") throw new Error(`expected ok, got ${r.kind}`);
  return r.shape;
}

test("translate-prim disk: chained == cumulative", () => {
  const rod = rodOf(2); // r=1, well inside any reasonable canvas
  const a = { x: 1, y: 2 };
  const b = { x: -3, y: 5 };
  const ab = { x: a.x + b.x, y: a.y + b.y };

  const chained = applyOk(applyOk(rod, translateDisk(a)), translateDisk(b));
  const cumulative = applyOk(rod, translateDisk(ab));
  assert.deepEqual(chained, cumulative);
});

test("translate-prim with zero delta is a no-op", () => {
  const rod = rodOf(5);
  const r = apply(rod, translateDisk({ x: 0, y: 0 }));
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.deepEqual(r.shape, rod);
});

test("translate-prim on a polygon outer is invalid", () => {
  const rod = rodOf(5);
  // Build a polygon shape via paint-rect crossing the disk.
  const seeded = apply(rod, { kind: "paint-rect", anchor: { x: 2, y: 0 }, cursor: { x: 3, y: 1 } });
  if (seeded.kind !== "warning") throw new Error("setup failed");
  const r = apply(seeded.shape, {
    kind: "translate-prim", sel: { kind: "outer", index: 0 }, delta: { x: 1, y: 1 },
  });
  assert.equal(r.kind, "invalid");
});
