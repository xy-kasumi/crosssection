// Geom uses tag-based diagnostics; this is the web-side render to English.
// Future localization adds a parallel table. The switches must stay
// exhaustive — TS refuses to compile if a tag is added in geom/ without
// a case here.

import type { ErrorTag, WarnTag } from "@geom/index.ts";

export function warnText(w: WarnTag): string {
  switch (w.tag) {
    case "circle-lost":
      return "circle prim will become a polygon — you'll lose drag-center and drag-radius";
    case "hole-outside-shape":
      return "hole was dropped (lay outside the shape)";
  }
}

export function errorText(e: ErrorTag): string {
  switch (e.tag) {
    case "empties-shape":
      return "shape would have no area";
    case "disconnects-shape":
      return "shape would split into disjoint pieces";
    case "breaks-polygon":
      return "outline must have at least 3 points";
  }
}
