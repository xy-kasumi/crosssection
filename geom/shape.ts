// Geometry-kernel data types. AuthoringShape is the editor-facing
// representation: a small immutable record that carries its composed
// (solver-ready) form alongside its editable primitives.
//
// Phase B: skeleton types only — `compose()` and the constructors that
// populate `composed` move in during Phase C.

import type { SolverShape } from "@solver/shape.ts";

export type Vec2 = { readonly x: number; readonly y: number };
export type Outline = readonly Vec2[]; // ring; no closing duplicate

export type CircleHole = {
  readonly kind: "circle";
  readonly center: Vec2;
  readonly r: number;
};
export type PolygonHole = {
  readonly kind: "polygon";
  readonly outline: Outline;
};
export type Hole = CircleHole | PolygonHole;

export type DiskShape = {
  readonly kind: "disk";
  readonly center: Vec2;
  readonly r: number;
  readonly holes: readonly Hole[];
  readonly composed: SolverShape;
};
export type PolygonShape = {
  readonly kind: "polygon";
  readonly outers: readonly Outline[];
  readonly holes: readonly Hole[];
  readonly composed: SolverShape;
};
export type AuthoringShape = DiskShape | PolygonShape;

// Selection: addresses a specific editable primitive in an AuthoringShape.
export type Selection =
  | { readonly kind: "outer"; readonly index: number }
  | { readonly kind: "disk" }
  | { readonly kind: "hole"; readonly index: number };
