// Phase B smoke test. Real apply() / preset coverage lands in Phase F
// (apply.test.ts, presets.test.ts, translate-associativity.test.ts).
//
// Goal here: prove the test runner is wired and `@geom` resolves.

import { test } from "node:test";
import assert from "node:assert/strict";

import { rodOf } from "../presets.ts";

test("rodOf produces a disk-kind shape", () => {
  const shape = rodOf(10);
  assert.equal(shape.kind, "disk");
});
