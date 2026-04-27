// Each preset should return a sound AuthoringShape — sound = compose()
// returns ok against it. Sanity check that the constructors produce
// something the kernel won't immediately reject. Composed-embedding lands
// later; for now we run compose() externally as the oracle.

import { test } from "node:test";
import assert from "node:assert/strict";

import { compose } from "../shape.ts";
import { defaultDisk, extrusionOf, rectShapeOf, rodOf } from "../presets.ts";

test("defaultDisk is sound (composes ok)", () => {
  const r = compose(defaultDisk());
  assert.equal(r.ok, true);
});

test("rodOf(D) returns a disk with r = D/2 and composes ok", () => {
  for (const D of [1, 5, 10, 100]) {
    const s = rodOf(D);
    assert.equal(s.kind, "disk");
    assert.equal(s.r, D / 2);
    assert.equal(s.holes.length, 0);
    assert.equal(compose(s).ok, true);
  }
});

test("rectShapeOf(W, H) returns a polygon with one outer of 4 verts and composes ok", () => {
  const s = rectShapeOf(10, 20);
  assert.equal(s.kind, "polygon");
  assert.equal(s.outers.length, 1);
  assert.equal(s.outers[0]?.length, 4);
  assert.equal(s.holes.length, 0);
  assert.equal(compose(s).ok, true);
});

test("extrusionOf returns a polygon with one outer + one polygon hole, composes ok", () => {
  const s = extrusionOf(2020); // 20×20
  assert.equal(s.kind, "polygon");
  assert.equal(s.outers.length, 1);
  assert.equal(s.holes.length, 1);
  assert.equal(s.holes[0]?.kind, "polygon");
  assert.equal(compose(s).ok, true);
});
