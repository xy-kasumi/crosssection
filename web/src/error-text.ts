// Geom uses tag-based diagnostics; this is the web-side render to English.
// Future localization adds parallel tables. Keep tag→string switches
// exhaustive — TS will refuse to compile if a new tag is added in geom/
// without a case here.

import type { ApplyErrorTag, ComposeErrorTag, WarnTag } from "@geom/index.ts";

export function warnText(tag: WarnTag): string {
  switch (tag) {
    case "circle-lost":
      return "circle prim will become a polygon — you'll lose drag-center and drag-radius";
  }
}

export function applyErrorText(e: ApplyErrorTag): string {
  switch (e.tag) {
    case "paint-disconnected":
      return "rect doesn't overlap the existing shape (would create a disconnected piece)";
    case "erase-empties-shape":
      return "shape would be erased entirely";
    case "erase-cuts-shape":
      return "shape would be cut in two";
    case "hole-outside-shape":
      return "hole is entirely outside the shape";
    case "hole-empties-shape":
      return "hole would erase the shape entirely";
    case "hole-disconnects-shape":
      return "hole would disconnect the shape";
    case "vertex-min-points":
      return "can't delete vertex — outline must keep at least 3 points";
    case "compose-failed":
      return composeErrorText(e.cause);
  }
}

export function composeErrorText(c: ComposeErrorTag): string {
  switch (c.tag) {
    case "disk-radius-nonpositive":
      return "disk radius must be positive";
    case "no-outer":
      return "no outer geometry";
    case "outer-empty":
      return "outer geometry is empty";
    case "outer-disconnected":
      return "shape isn't connected (multiple outer pieces)";
    case "hole-too-few-points":
      return `hole #${c.holeIndex + 1} has too few points`;
    case "hole-crosses-outer":
      return `hole #${c.holeIndex + 1} crosses the outer boundary or lies outside`;
  }
}
