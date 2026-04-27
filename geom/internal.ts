// Polygon-clipping helpers and other private machinery used by shape.ts /
// apply.ts / presets.ts. Not in the public surface; consumers must import
// only from `./index.ts`.
//
// Phase B: empty marker module. Phase C migrates the helpers from
// web/src/authoring.ts here:
//   outlineToRing, ringToOutline, ringFromCircle, rectOutline,
//   holesMultiPolygon, outerMultiPolygonOf, authoringBBox.
// The polygon-clipping import lives here, not in shape.ts.
//
// Field-name freedom: internals may use cx/cy/x/y as the upstream library
// expects. Vec2 is required only on the public surface.
export {};
