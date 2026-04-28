// Public surface of the geometry kernel. Consumers import from this file
// (or the package alias `@geom`) and from nothing else under geom/.

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
  ErrorTag,
  WarnTag,
  BBox,
} from "./shape.ts";
export { check, compose, authoringBBox } from "./shape.ts";

export type { Op, OpKind } from "./op.ts";
export type {
  ApplyResult,
  OpOk,
  OpWarning,
  OpError,
  OpInvalid,
} from "./apply.ts";
export { apply } from "./apply.ts";

export {
  defaultDisk,
  rodOf,
  rectShapeOf,
  extrusionOf,
} from "./presets.ts";

export { rectOutline } from "./internal.ts";
