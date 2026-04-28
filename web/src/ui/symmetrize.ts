// Symmetrize-action specs. The user-facing label per SymGroup; the geom
// kernel owns the actual regions/transforms.

import type { SymGroup } from "@geom/index.ts";
import { t } from "./i18n.ts";

export interface SymSpec {
  kind: SymGroup;
  label: string;
}

export const SYM_SPECS: SymSpec[] = [
  { kind: "D1", label: t({ en: "Mirror",    ja: "ミラー" }) },
  { kind: "D4", label: t({ en: "Extrusion", ja: "押出" }) },
];
