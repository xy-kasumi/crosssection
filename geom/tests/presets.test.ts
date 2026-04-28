// Each preset must produce a check-valid AuthoringShape.

import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../shape.ts";
import { defaultDisk, extrusionOf, rectShapeOf, rodOf } from "../presets.ts";

test("defaultDisk is valid", () => {
  assert.equal(check(defaultDisk()), null);
});

test("rodOf(D) returns a disk with r = D/2 and is valid", () => {
  for (const D of [1, 5, 10, 100]) {
    const s = rodOf(D);
    assert.equal(s.kind, "disk");
    assert.equal(s.r, D / 2);
    assert.equal(s.holes.length, 0);
    assert.equal(check(s), null);
  }
});

test("rectShapeOf(W, H) returns a polygon with one outer of 4 verts and is valid", () => {
  const s = rectShapeOf(10, 20);
  assert.equal(s.kind, "polygon");
  assert.equal(s.outers.length, 1);
  assert.equal(s.outers[0]?.length, 4);
  assert.equal(s.holes.length, 0);
  assert.equal(check(s), null);
});

test("extrusionOf returns a polygon with one outer + one polygon hole, valid", () => {
  const s = extrusionOf(2020);
  assert.equal(s.kind, "polygon");
  assert.equal(s.outers.length, 1);
  assert.equal(s.holes.length, 1);
  assert.equal(s.holes[0]?.kind, "polygon");
  assert.equal(check(s), null);
});
