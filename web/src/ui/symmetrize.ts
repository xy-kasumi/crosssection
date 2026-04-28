// Symmetrize-action specs. The user-facing label per SymGroup; the geom
// kernel owns the actual regions/transforms.

import type { SymGroup } from "@geom/index.ts";

export interface SymSpec {
  kind: SymGroup;
  label: string;
}

export const SYM_SPECS: SymSpec[] = [
  { kind: "D1", label: "Mirror" },
  { kind: "D4", label: "Extrusion" },
];
