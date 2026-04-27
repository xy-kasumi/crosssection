// Public surface of the geometry kernel. Consumers (web/) import from this
// file (or the package alias `@geom`) and from nothing else under geom/.
//
// `compose` is exported because main.ts still drives FEM solves off the
// composed SolverShape — the embedded-`composed` field in AuthoringShape
// is a future cleanup. `rectOutline` is exported because debug-pane.ts
// uses it as the fallback when the user deletes the last outer.

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
  ComposeErrorTag,
  ComposeResult,
  BBox,
} from "./shape.ts";
export { compose, authoringBBox } from "./shape.ts";

export type { Op, OpKind } from "./op.ts";
export type {
  ApplyResult,
  ApplyErrorTag,
  OpOk,
  OpWarning,
  OpError,
  OpInvalid,
  WarnTag,
} from "./apply.ts";
export { apply } from "./apply.ts";

export {
  defaultDisk,
  rodOf,
  rectShapeOf,
  extrusionOf,
} from "./presets.ts";

export { rectOutline } from "./internal.ts";
