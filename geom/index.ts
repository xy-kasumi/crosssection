// Public surface of the geometry kernel. Web should import from this file
// (or the package alias `@geom`) and from nothing else under geom/.
//
// Phase D will tighten the surface: `compose` becomes private, the granular
// Op variants land, the result trichotomy gains `invalid`. Phase C exposes
// what web/src/{authoring,ops}.ts used to expose so the shims stay thin.

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
  ComposeOk,
  ComposeError,
  ComposeResult,
  BBox,
} from "./shape.ts";
export { compose, authoringBBox } from "./shape.ts";

export type { Op, OpKind } from "./op.ts";
export type { ApplyResult, OpOk, OpWarning, OpError, OpInvalid, OpResult } from "./apply.ts";
export { apply, WARN_CIRCLE_LOST } from "./apply.ts";

export {
  defaultDisk,
  rodOf,
  rectShapeOf,
  extrusionOf,
} from "./presets.ts";

// Internal helpers exposed transitionally — canvas/* still consumes them
// while the kernel migration to a fully sealed surface is in progress.
// Phase E removes these re-exports along with the web shims.
export {
  outlineToRing,
  ringToOutline,
  ringFromCircle,
  rectOutline,
} from "./internal.ts";
