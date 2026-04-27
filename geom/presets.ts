// Preset constructors: `defaultDisk`, `rodOf`, `rectShapeOf`, `extrusionOf`.
// Each returns a fully-populated AuthoringShape (composed field included).
//
// Phase B: stubs that satisfy the smoke test. Phase C lifts the live
// implementations out of web/src/authoring.ts.

import type { AuthoringShape, DiskShape } from "./shape.ts";

export function rodOf(_diameter: number): AuthoringShape {
  // Stub — Phase C replaces this with the real construction (compose included).
  const stub: DiskShape = {
    kind: "disk",
    center: { x: 0, y: 0 },
    r: _diameter / 2,
    holes: [],
    composed: [],
  };
  return stub;
}
