// Public surface of the geometry kernel. Web should import from this file
// (or the package alias `@geom`) and from nothing else under geom/.
//
// `compose`, `mkShape`, and the polygon-clipping helpers in `internal.ts`
// are deliberately not re-exported.

export type {
  Vec2,
  Outline,
  CircleHole,
  PolygonHole,
  Hole,
  DiskShape,
  PolygonShape,
  AuthoringShape,
  Selection,
} from "./shape.ts";
export type { Op } from "./op.ts";
export type { ApplyResult } from "./apply.ts";

export { apply } from "./apply.ts";
export { rodOf } from "./presets.ts";
