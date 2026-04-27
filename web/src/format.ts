// Two-significant-figure number formatter for readouts.
// Examples:
//   490.87  -> "490"
//   12345   -> "12,000"
//   1.23e7  -> "12,000,000"
//   0.0123  -> "0.012"
//   2.4e-6  -> "0.0000024"   (very small, falls back to fixed)
// Above ~1e8 or below 1e-4, switch to scientific so the readout doesn't blow up.
export function twoSigFigs(x: number): string {
  if (!Number.isFinite(x)) return "—";
  if (x === 0) return "0";
  const sign = x < 0 ? "-" : "";
  const ax = Math.abs(x);
  const order = Math.floor(Math.log10(ax));
  if (order > 7 || order < -3) {
    // scientific
    const m = ax / Math.pow(10, order);
    return `${sign}${(Math.round(m * 10) / 10).toFixed(1)}×10${superscript(order)}`;
  }
  // round to 2 sig figs
  const factor = Math.pow(10, order - 1);
  const rounded = Math.round(ax / factor) * factor;
  // Use toLocaleString with 0–1 fraction digits to keep "490" / "12,000" / "0.012" tidy.
  const fractionDigits = order >= 1 ? 0 : Math.max(0, 1 - order);
  return sign + rounded.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

const SUPERSCRIPT_DIGITS = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
function superscript(n: number): string {
  const s = String(Math.abs(n));
  let out = n < 0 ? "⁻" : "";
  for (const ch of s) out += SUPERSCRIPT_DIGITS[Number(ch)];
  return out;
}
