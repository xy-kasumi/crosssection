// Re-export shim: the op model lives in @geom now. previewOp was renamed
// to apply per the plan; the alias here keeps editor.ts compiling until
// Phase D rewrites it. Phase E deletes this shim entirely.

export {
  type Op,
  type OpKind,
  type OpOk,
  type OpWarning,
  type OpError,
  type OpResult,
  type ApplyResult,
  apply as previewOp,
  WARN_CIRCLE_LOST,
} from "@geom/index.ts";
