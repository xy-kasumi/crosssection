// Each preset must produce a check-valid AuthoringShape.

import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../shape.ts";
import { boxOf, defaultDisk, extrusionOf, pipeOf, rectShapeOf, rodOf } from "../presets.ts";

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

test("pipeOf(D, T) returns a disk with one circle hole and is valid", () => {
  const s = pipeOf(12, 2);
  assert.equal(s.kind, "disk");
  assert.equal(s.r, 6);
  assert.equal(s.holes.length, 1);
  assert.equal(s.holes[0]?.kind, "circle");
  assert.equal(check(s), null);
});

test("rectShapeOf(W, H) returns a polygon with one outer of 4 verts and is valid", () => {
  const s = rectShapeOf(10, 20);
  assert.equal(s.kind, "polygon");
  assert.equal(s.outers.length, 1);
  assert.equal(s.outers[0]?.length, 4);
  assert.equal(s.holes.length, 0);
  assert.equal(check(s), null);
});

test("boxOf(W, H, T) returns a polygon with one rect outer and one rect hole, valid", () => {
  const s = boxOf(20, 10, 2);
  assert.equal(s.kind, "polygon");
  assert.equal(s.outers.length, 1);
  assert.equal(s.outers[0]?.length, 4);
  assert.equal(s.holes.length, 1);
  assert.equal(s.holes[0]?.kind, "polygon");
  assert.equal(check(s), null);
});

test("extrusionOf returns a hand-authored T-slot polygon with a circular hole, valid", () => {
  const s = extrusionOf();
  assert.equal(s.kind, "polygon");
  assert.equal(s.outers.length, 1);
  assert.equal(s.holes.length, 1);
  assert.equal(s.holes[0]?.kind, "circle");
  assert.equal(check(s), null);
});
