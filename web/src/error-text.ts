// Geom uses tag-based diagnostics; this is the web-side render to English.
// Future localization adds a parallel table. The switches must stay
// exhaustive — TS refuses to compile if a tag is added in geom/ without
// a case here.
//
// Voice rules: subject is bare ("shape", "hole", "circle", "outline" — no
// definite article). Predicted consequences use "will" or "would"; hard
// constraints use "must". No internal jargon ("prim", "drag-center", etc.).

import type { ErrorTag, WarnTag } from "@geom/index.ts";

export function warnText(w: WarnTag): string {
  switch (w.tag) {
    case "circle-lost":
      return "circle will become a polygon — center and radius handles will be lost";
    case "hole-outside-shape":
      return "hole will not be added (not overlapping with the shape)";
  }
}

export function errorText(e: ErrorTag): string {
  switch (e.tag) {
    case "empties-shape":
      return "shape would be empty";
    case "disconnects-shape":
      return "shape would have multiple disjoint pieces";
    case "breaks-polygon":
      return "outline must have at least 3 vertices";
    case "self-intersecting":
      return "outline must not cross itself";
  }
}
