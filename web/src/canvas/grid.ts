// Centered grid: minor lines + major emphasis + axes + tick numbers + axis
// labels. Engineering halfSpan ladder ({1,2,5} × 10^k) means the user sees
// "5" / "10" / "20" rather than "13.7". Receives a View; emits CSS pixels.

import { authoringBBox, type AuthoringShape } from "../authoring.ts";
import type { View } from "./index.ts";

const FIT_MARGIN = 1.15; // halfSpan must be >= FIT_MARGIN * max abs world coord

const ENG_SPANS: number[] = (() => {
  const out: number[] = [];
  for (let p = -3; p <= 4; p++) for (const m of [1, 2, 5]) out.push(m * Math.pow(10, p));
  out.sort((a, b) => a - b);
  return out;
})();

export function targetHalfSpan(shape: AuthoringShape): number {
  const bbox = authoringBBox(shape);
  if (!bbox) return 5;
  const m = Math.max(Math.abs(bbox.minX), Math.abs(bbox.maxX), Math.abs(bbox.minY), Math.abs(bbox.maxY));
  const want = Math.max(0.05, m * FIT_MARGIN);
  for (const s of ENG_SPANS) if (s >= want) return s;
  return ENG_SPANS[ENG_SPANS.length - 1]!;
}

export function unitForSpan(halfSpan: number): number {
  // Largest power-of-10 unit such that halfSpan/unit ≥ 5.
  return Math.pow(10, Math.floor(Math.log10(halfSpan / 5)));
}

export function drawGrid(ctx: CanvasRenderingContext2D, view: View): void {
  const { halfSpan, unit, scale, offsetX, offsetY, cssW, cssH } = view;
  const minorN = Math.round(halfSpan / unit);
  const majorEvery = 5;
  const showMajor = minorN > majorEvery;

  const minorXs: number[] = [];
  const minorYs: number[] = [];
  const majorXs: number[] = [];
  const majorYs: number[] = [];

  for (let i = -minorN; i <= minorN; i++) {
    if (i === 0) continue; // axes drawn separately at higher contrast
    const w = i * unit;
    const sx = offsetX + w * scale;
    const sy = offsetY - w * scale;
    if (showMajor && i % majorEvery === 0) { majorXs.push(sx); majorYs.push(sy); }
    else                                    { minorXs.push(sx); minorYs.push(sy); }
  }

  drawLines(ctx, minorXs, minorYs, cssW, cssH, "rgba(127,127,127,0.10)");
  if (showMajor) drawLines(ctx, majorXs, majorYs, cssW, cssH, "rgba(127,127,127,0.22)");

  // Origin axes (slightly stronger than majors).
  ctx.strokeStyle = "rgba(127,127,127,0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(offsetX, 0); ctx.lineTo(offsetX, cssH);
  ctx.moveTo(0, offsetY); ctx.lineTo(cssW, offsetY);
  ctx.stroke();

  // Tick numbers: every minor when there are no majors, every major otherwise.
  // Skip 0 (axis intersection) and the outermost tick (overlaps the X/Y label).
  const tickStep = showMajor ? majorEvery : 1;
  ctx.fillStyle = "rgba(80,80,80,0.7)";
  ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
  for (let i = -minorN + 1; i <= minorN - 1; i++) {
    if (i === 0 || i % tickStep !== 0) continue;
    const w = i * unit;
    const sx = offsetX + w * scale;
    const sy = offsetY - w * scale;
    ctx.textAlign = "center";  ctx.textBaseline = "top";    ctx.fillText(formatTick(w), sx, offsetY + 3);
    ctx.textAlign = "right";   ctx.textBaseline = "middle"; ctx.fillText(formatTick(w), offsetX - 4, sy);
  }

  // Axis labels at the ends.
  ctx.fillStyle = "rgba(80,80,80,0.85)";
  ctx.font = "italic 12px ui-monospace, SFMono-Regular, monospace";
  ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText("X", cssW - 4, offsetY - 8);
  ctx.textAlign = "center"; ctx.textBaseline = "top";   ctx.fillText("Y", offsetX + 10, 4);

  // Unit marker, bottom-right.
  ctx.fillStyle = "rgba(80,80,80,0.6)";
  ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
  ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
  ctx.fillText("mm", cssW - 6, cssH - 6);
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  xs: number[], ys: number[],
  cssW: number, cssH: number,
  stroke: string,
): void {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const sx of xs) { ctx.moveTo(sx, 0); ctx.lineTo(sx, cssH); }
  for (const sy of ys) { ctx.moveTo(0, sy); ctx.lineTo(cssW, sy); }
  ctx.stroke();
}

function formatTick(v: number): string {
  if (Number.isInteger(v)) return String(v);
  // Trim trailing zeros / dangling dot so 0.10 → "0.1", 1.00 → "1".
  return v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
