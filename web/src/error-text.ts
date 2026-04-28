// Geom uses tag-based diagnostics; this is the web-side render to a
// localized string. The switches must stay exhaustive — TS refuses to
// compile if a tag is added in geom/ without a case here.
//
// EN voice rules: subject is bare ("shape", "hole", "circle", "outline" —
// no definite article). Predicted consequences use "will" or "would"; hard
// constraints use "must". No internal jargon ("prim", "drag-center", etc.).

import type { ErrorTag, WarnTag } from "@geom/index.ts";
import { t } from "./ui/i18n.ts";

export function warnText(w: WarnTag): string {
  switch (w.tag) {
    case "circle-lost":
      return t({
        en: "circle will become a polygon — center and radius handles will be lost",
        ja: "円がポリゴンに変換されます — 中心と半径のハンドルは失われます",
      });
    case "hole-outside-shape":
      return t({
        en: "hole will not be added (not overlapping with the shape)",
        ja: "穴は追加されません（形状と重なっていません）",
      });
  }
}

export function errorText(e: ErrorTag): string {
  switch (e.tag) {
    case "empties-shape":
      return t({ en: "shape would be empty",                              ja: "形状が空になります" });
    case "disconnects-shape":
      return t({ en: "shape would have multiple disjoint pieces",         ja: "形状が複数に分断されます" });
    case "breaks-polygon":
      return t({ en: "outline must have at least 3 vertices",             ja: "外形は3頂点以上必要です" });
    case "self-intersecting":
      return t({ en: "outline must not cross itself",                     ja: "外形が自己交差しています" });
    case "hole-overlap":
      return t({ en: "hole must not overlap outer or another hole",       ja: "穴が外形または他の穴と重なってはいけません" });
    case "outers-overlap":
      return t({ en: "outlines must not overlap each other",              ja: "外形どうしが重なってはいけません" });
  }
}
