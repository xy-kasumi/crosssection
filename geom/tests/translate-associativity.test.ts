// Translate-prim associativity. The editor doesn't actually chain frames
// (Phase D's drag is base-relative), but the kernel property still has to
// hold: dragging by `a` and then by `b` should land in the same place as
// dragging by `a + b`. If this ever drifted, a slow drag and a fast drag
// over the same distance would produce different geometry — confusing UX.
//
// Property only holds when both intermediate and final results are clean
// (no polygonization). Tests pick deltas that keep the prim well inside.

import { test } from "node:test";
import assert from "node:assert/strict";

import { apply, type Op, type Vec2 } from "../index.ts";
import { rodOf, rectShapeOf } from "../presets.ts";

function translate(delta: Vec2, sel: { kind: "disk" } | { kind: "outer"; index: number }): Op {
  return { kind: "translate-prim", sel, delta };
}

function applyOk(s: ReturnType<typeof rodOf> | ReturnType<typeof rectShapeOf>, op: Op): unknown {
  const r = apply(s, op);
  if (r.kind !== "ok") throw new Error(`expected ok, got ${r.kind} (${"reason" in r ? r.reason : "no reason"})`);
  return r.shape;
}

test("translate-prim disk: chained == cumulative", () => {
  const rod = rodOf(2); // r=1, well inside any reasonable canvas
  const a = { x: 1, y: 2 };
  const b = { x: -3, y: 5 };
  const ab = { x: a.x + b.x, y: a.y + b.y };

  const chained = applyOk(applyOk(rod, translate(a, { kind: "disk" })) as ReturnType<typeof rodOf>, translate(b, { kind: "disk" }));
  const cumulative = applyOk(rod, translate(ab, { kind: "disk" }));
  assert.deepEqual(chained, cumulative);
});

test("translate-prim outer (rectangle): chained == cumulative", () => {
  const rect = rectShapeOf(4, 6);
  const a = { x: 1.5, y: -2 };
  const b = { x: 3, y: 4.5 };
  const ab = { x: a.x + b.x, y: a.y + b.y };

  const chained = applyOk(
    applyOk(rect, translate(a, { kind: "outer", index: 0 })) as ReturnType<typeof rectShapeOf>,
    translate(b, { kind: "outer", index: 0 }),
  );
  const cumulative = applyOk(rect, translate(ab, { kind: "outer", index: 0 }));
  assert.deepEqual(chained, cumulative);
});

test("translate-prim with zero delta is a no-op", () => {
  const rod = rodOf(5);
  const r = apply(rod, translate({ x: 0, y: 0 }, { kind: "disk" }));
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.deepEqual(r.shape, rod);
});
