// Re-export shim: the authoring shape types and compose() live in @geom now.
// This file exists so editor.ts and canvas/* don't all have to flip imports
// in the same commit. Phase E deletes it.

export {
  // types
  type Vec2,
  type Outline,
  type CircleHole,
  type PolygonHole,
  type Hole,
  type DiskShape,
  type PolygonShape,
  type AuthoringShape,
  type Selection,
  type ComposeOk,
  type ComposeError,
  type ComposeResult,
  type BBox,
  // compose + bbox
  compose,
  authoringBBox,
  // presets
  defaultDisk,
  rodOf,
  rectShapeOf,
  extrusionOf,
  // internal helpers (consumed by canvas/* during transition)
  outlineToRing,
  ringToOutline,
  ringFromCircle,
  rectOutline,
} from "@geom/index.ts";
