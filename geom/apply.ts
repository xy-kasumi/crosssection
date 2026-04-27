// apply(shape, op) → ApplyResult trichotomy + InvalidOp.
//
//   ok      — clean commit; new shape returned.
//   warn    — committable but lossy (e.g. circle prim becomes polygon).
//   err     — user intent rejected (zero-area, would-disconnect, ...).
//   invalid — bug; UI shouldn't reach here. Editor logs + throws; the
//             top-level window.onerror handler shows the boot-overlay.
//
// Phase B: signature only — Phase C cribs the live implementations from
// web/src/ops.ts and the direct-mutation paths in editor.ts.

import type { AuthoringShape } from "./shape.ts";
import type { Op } from "./op.ts";

export type ApplyResult =
  | { readonly kind: "ok"; readonly shape: AuthoringShape }
  | { readonly kind: "warn"; readonly shape: AuthoringShape; readonly reason: string }
  | { readonly kind: "err"; readonly reason: string }
  | { readonly kind: "invalid"; readonly reason: string };

export function apply(_shape: AuthoringShape, _op: Op): ApplyResult {
  return { kind: "invalid", reason: "apply() not implemented yet (Phase B skeleton)" };
}
