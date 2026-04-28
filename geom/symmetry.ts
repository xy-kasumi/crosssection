// symCompose: clip-and-symmetrize a shape with no awareness of edit modes.
// The UI supplies the region polygon and the affine-transform list; this
// module just runs the union-of-clipped-and-transformed-copies pipeline.

import polygonClipping, { type MultiPolygon } from "polygon-clipping";

import {
  decompose, holesMultiPolygon, outerMultiPolygonOf, outlineToRing, quantize,
} from "./internal.ts";
import type { AuthoringShape, Outline } from "./shape.ts";

// Affine: (x',y') = (a*x + b*y + e, c*x + d*y + f). Pure-rotation + reflection
// matrices have e=f=0, but translations are allowed in case future modes need
// them.
export type AffineMat = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY: AffineMat = [1, 0, 0, 1, 0, 0];

function isIdentity(m: AffineMat): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

function transformMP(mp: MultiPolygon, m: AffineMat): MultiPolygon {
  const [a, b, c, d, e, f] = m;
  return mp.map(poly => poly.map(ring =>
    ring.map(([x, y]): [number, number] => [
      quantize(a * x + b * y + e),
      quantize(c * x + d * y + f),
    ]),
  ));
}

// Clip the shape's filled region to `region` (if any), then form the union of
// each transformed copy. Returns null when the result is empty. The output is
// a polygon-kind AuthoringShape (circle identity is dissolved by the boolean
// ops); the fast path preserves the input as-is when no work is requested.
export function symCompose(
  s: AuthoringShape,
  region: Outline | null,
  transforms: readonly AffineMat[],
): AuthoringShape | null {
  if (region === null && transforms.length === 1 && isIdentity(transforms[0]!)) {
    return s;
  }

  let filled: MultiPolygon = polygonClipping.difference(
    outerMultiPolygonOf(s),
    holesMultiPolygon(s.holes),
  );

  if (region) {
    filled = polygonClipping.intersection(filled, [[outlineToRing(region)]]);
    if (filled.length === 0) return null;
  }

  let unioned: MultiPolygon;
  if (transforms.length === 0) {
    unioned = filled;
  } else {
    const parts: MultiPolygon[] = transforms.map(t => isIdentity(t) ? filled : transformMP(filled, t));
    unioned = parts.length === 1 ? parts[0]! : polygonClipping.union(parts[0]!, ...parts.slice(1));
  }

  if (unioned.length === 0) return null;
  const { outers, holes } = decompose(unioned);
  if (outers.length === 0) return null;
  return { kind: "polygon", outers, holes };
}
