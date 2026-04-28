// Property-based fuzz: long random op sequences must (a) never throw and
// (b) never return OpInvalid. The kernel's stated contract is that any
// well-formed Op against a check-valid shape yields ok / warning / error;
// "invalid" indicates a *kernel bug* (the editor's crashIfInvalid() rethrow
// is what the user sees as the "unexpected error" overlay). Same contract
// for symCompose, which has only ok / warning / error.
//
// The op generator excludes inputs that the editor can't produce (NaN,
// Infinity, negative radii). Garbage-in handling is not part of the
// contract under test.
//
// Determinism: FUZZ_SEED / FUZZ_ITERATIONS / FUZZ_SEEDS env vars. The
// resolved seed is logged at start; any failure prints seed, iteration,
// last 10 actions, and the input shape — paste into a regression test in
// apply.test.ts / symmetry.test.ts after fixing the bug.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  apply, check, symCompose,
  type AuthoringShape, type Op, type Selection, type SymGroup, type Vec2,
} from "../index.ts";
import {
  defaultDisk, rodOf, pipeOf, rectShapeOf, boxOf, extrusionOf,
} from "../presets.ts";

// ---------- PRNG ----------

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- knobs ----------

const BASE_SEED = process.env.FUZZ_SEED ? Number(process.env.FUZZ_SEED) : (Date.now() >>> 0);
const ITERATIONS = Number(process.env.FUZZ_ITERATIONS ?? 200);
const N_SEEDS = Number(process.env.FUZZ_SEEDS ?? 10);

// ---------- starting presets ----------

interface PresetEntry { name: string; make: () => AuthoringShape }

const PRESETS: PresetEntry[] = [
  { name: "defaultDisk()",   make: () => defaultDisk() },
  { name: "rodOf(8)",        make: () => rodOf(8) },
  { name: "pipeOf(12,2)",    make: () => pipeOf(12, 2) },
  { name: "rectShapeOf(20,5)", make: () => rectShapeOf(20, 5) },
  { name: "boxOf(20,20,2)",  make: () => boxOf(20, 20, 2) },
  { name: "extrusionOf()",   make: () => extrusionOf() },
];

// ---------- coordinate / scalar generation ----------

function pickLandmark(rnd: () => number, shape: AuthoringShape): Vec2 | null {
  const candidates: Vec2[] = [];
  if (shape.kind === "disk") candidates.push({ x: shape.cx, y: shape.cy });
  else for (const o of shape.outers) for (const p of o) candidates.push(p);
  for (const h of shape.holes) {
    if (h.kind === "circle") candidates.push({ x: h.cx, y: h.cy });
    else for (const p of h.outline) candidates.push(p);
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rnd() * candidates.length)]!;
}

function randVec2(rnd: () => number, shape: AuthoringShape): Vec2 {
  const r = rnd();
  if (r < 0.05) return { x: 0, y: 0 };
  if (r < 0.15) {
    const lm = pickLandmark(rnd, shape);
    if (lm) return { x: lm.x + (rnd() - 0.5) * 2e-6, y: lm.y + (rnd() - 0.5) * 2e-6 };
  }
  if (r < 0.30) return { x: (rnd() - 0.5) * 1000, y: (rnd() - 0.5) * 1000 };
  return { x: (rnd() - 0.5) * 100, y: (rnd() - 0.5) * 100 };
}

function randRadius(rnd: () => number, shape: AuthoringShape): number {
  const r = rnd();
  if (r < 0.15) return rnd() * 0.001;
  if (r < 0.20) {
    const radii: number[] = [];
    if (shape.kind === "disk") radii.push(shape.r);
    for (const h of shape.holes) if (h.kind === "circle") radii.push(h.r);
    if (radii.length > 0) return radii[Math.floor(rnd() * radii.length)]!;
  }
  return 0.1 + rnd() * 50;
}

// ---------- structural pickers ----------

function pickOutlineSelection(
  rnd: () => number, shape: AuthoringShape,
): { sel: Selection; vertCount: number } | null {
  const choices: { sel: Selection; vertCount: number }[] = [];
  if (shape.kind === "polygon") {
    for (let i = 0; i < shape.outers.length; i++) {
      choices.push({ sel: { kind: "outer", index: i }, vertCount: shape.outers[i]!.length });
    }
  }
  for (let i = 0; i < shape.holes.length; i++) {
    const h = shape.holes[i]!;
    if (h.kind === "polygon") {
      choices.push({ sel: { kind: "hole", index: i }, vertCount: h.outline.length });
    }
  }
  if (choices.length === 0) return null;
  return choices[Math.floor(rnd() * choices.length)]!;
}

function pickHoleIndex(rnd: () => number, shape: AuthoringShape, kind?: "circle"): number | null {
  const indices: number[] = [];
  for (let i = 0; i < shape.holes.length; i++) {
    if (!kind || shape.holes[i]!.kind === kind) indices.push(i);
  }
  if (indices.length === 0) return null;
  return indices[Math.floor(rnd() * indices.length)]!;
}

// ---------- weighted action picker ----------

type Action =
  | { kind: "op";  op: Op }
  | { kind: "sym"; group: SymGroup };

function randomAction(rnd: () => number, shape: AuthoringShape): Action | null {
  const r = rnd();
  if (r < 0.10) return { kind: "op", op: { kind: "paint-rect", anchor: randVec2(rnd, shape), cursor: randVec2(rnd, shape) } };
  if (r < 0.20) return { kind: "op", op: { kind: "erase-rect", anchor: randVec2(rnd, shape), cursor: randVec2(rnd, shape) } };
  if (r < 0.38) return { kind: "op", op: { kind: "add-hole",   center: randVec2(rnd, shape), cursor: randVec2(rnd, shape) } };
  if (r < 0.46) {
    const c = pickOutlineSelection(rnd, shape);
    if (!c) return null;
    return { kind: "op", op: { kind: "move-vert", sel: c.sel, index: Math.floor(rnd() * c.vertCount), target: randVec2(rnd, shape) } };
  }
  if (r < 0.51) {
    const c = pickOutlineSelection(rnd, shape);
    if (!c) return null;
    return { kind: "op", op: { kind: "delete-vert", sel: c.sel, index: Math.floor(rnd() * c.vertCount) } };
  }
  if (r < 0.56) {
    if (shape.kind !== "disk") return null;
    return { kind: "op", op: { kind: "move-disk-center", target: randVec2(rnd, shape) } };
  }
  if (r < 0.61) {
    if (shape.kind !== "disk") return null;
    return { kind: "op", op: { kind: "move-disk-radius", r: randRadius(rnd, shape) } };
  }
  if (r < 0.71) {
    // move-hole-center is circle-hole-only (its builder is `moveCircleHole`).
    // Polygon holes translate via per-vertex moves, not a center op.
    const idx = pickHoleIndex(rnd, shape, "circle");
    if (idx === null) return null;
    return { kind: "op", op: { kind: "move-hole-center", index: idx, target: randVec2(rnd, shape) } };
  }
  if (r < 0.80) {
    const idx = pickHoleIndex(rnd, shape, "circle");
    if (idx === null) return null;
    return { kind: "op", op: { kind: "move-hole-radius", index: idx, r: randRadius(rnd, shape) } };
  }
  if (r < 0.90) return { kind: "sym", group: "D1" };
  return { kind: "sym", group: "D4" };
}

// ---------- repro formatter ----------

interface ReproOpts {
  baseSeed: number;
  seed: number;
  preset: string;
  iter: number;
  history: ReadonlyArray<{ action: Action; kind: string }>;
  shape: AuthoringShape;
  failingAction: Action;
  resultKind: string;
  thrown?: unknown;
}

function repro(o: ReproOpts): string {
  const tail = o.history.slice(-10).map((h, i) => {
    const idx = o.history.length - Math.min(10, o.history.length) + i;
    return `  ${idx}. ${JSON.stringify(h.action)} → ${h.kind}`;
  }).join("\n");
  const lines = [
    "",
    `FUZZ_SEED=${o.baseSeed}  (failing seed=${o.seed}, preset=${o.preset}, iter=${o.iter}, result.kind=${o.resultKind})`,
    "shape before failing action:",
    JSON.stringify(o.shape, null, 2),
    "failing action:",
    JSON.stringify(o.failingAction, null, 2),
    "last actions:",
    tail || "  (none)",
  ];
  if (o.thrown !== undefined) {
    const e = o.thrown;
    const str = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ""}` : String(e);
    lines.push("thrown:", str);
  }
  return lines.join("\n");
}

// ---------- the test ----------

test(`fuzz: random op sequences must not throw or yield OpInvalid (FUZZ_SEED=${BASE_SEED})`, () => {
  console.log(`[fuzz] base seed=${BASE_SEED}, seeds=${N_SEEDS}, iterations per (seed × preset)=${ITERATIONS}`);

  for (let s = 0; s < N_SEEDS; s++) {
    const seed = (BASE_SEED + s * 0x9E3779B1) >>> 0;
    const rnd = mulberry32(seed);

    for (const preset of PRESETS) {
      let shape = preset.make();
      assert.equal(check(shape), null, `preset ${preset.name} must start check-valid`);
      const history: { action: Action; kind: string }[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        // Up to a few retries to find a structurally-valid action for the
        // current shape (e.g. move-hole-* needs at least one hole).
        let action: Action | null = null;
        for (let retry = 0; retry < 5; retry++) {
          action = randomAction(rnd, shape);
          if (action) break;
        }
        if (!action) continue;

        let kind: string;
        let nextShape: AuthoringShape | null = null;
        try {
          if (action.kind === "op") {
            const r = apply(shape, action.op);
            kind = r.kind;
            if (r.kind === "invalid") {
              throw new Error(repro({
                baseSeed: BASE_SEED, seed, preset: preset.name, iter: i,
                history, shape, failingAction: action, resultKind: r.kind,
              }));
            }
            if (r.kind === "ok" || r.kind === "warning") {
              const e = check(r.shape);
              if (e !== null) {
                throw new Error(`${preset.name}@${i}: apply returned ${r.kind} but result fails check: ${JSON.stringify(e)}\n${repro({
                  baseSeed: BASE_SEED, seed, preset: preset.name, iter: i,
                  history, shape, failingAction: action, resultKind: r.kind,
                })}`);
              }
              nextShape = r.shape;
            }
          } else {
            const r = symCompose(shape, action.group);
            kind = r.kind;
            // symCompose has no "invalid" kind in its declared union, but
            // type-narrow defensively in case the kernel ever adds one.
            if ((r as { kind: string }).kind === "invalid") {
              throw new Error(repro({
                baseSeed: BASE_SEED, seed, preset: preset.name, iter: i,
                history, shape, failingAction: action, resultKind: r.kind,
              }));
            }
            if (r.kind === "ok" || r.kind === "warning") {
              const e = check(r.shape);
              if (e !== null) {
                throw new Error(`${preset.name}@${i}: symCompose returned ${r.kind} but result fails check: ${JSON.stringify(e)}\n${repro({
                  baseSeed: BASE_SEED, seed, preset: preset.name, iter: i,
                  history, shape, failingAction: action, resultKind: r.kind,
                })}`);
              }
              nextShape = r.shape;
            }
          }
        } catch (thrown) {
          // Re-throw with full repro info attached.
          throw new Error(repro({
            baseSeed: BASE_SEED, seed, preset: preset.name, iter: i,
            history, shape, failingAction: action, resultKind: "<thrown>",
            thrown,
          }));
        }

        history.push({ action, kind });
        if (nextShape) shape = nextShape;
      }
    }
  }
});
