// CLI test battery. Run via `npm test`.
//
// For each case in cases.ts: dispatch to the Pyodide solver, compare each of
// {ixx_c, iyy_c, j} to the externally-cited expected value, print one row per
// (case × property), exit non-zero on any failure.

import { compute } from "../core/compute.ts";
import { cases, type ExpectedTriple, type ToleranceTriple } from "./cases.ts";

const PROPS = ["ixx_c", "iyy_c", "j"] as const;
type Prop = (typeof PROPS)[number];

interface Row {
  caseName: string;
  prop: Prop;
  expected: number;
  computed: number;
  relErr: number;
  tol: number;
  pass: boolean;
  ms: number; // wall-clock attributed to this case (printed once per case)
}

function fmtNum(x: number): string {
  if (!isFinite(x)) return String(x);
  if (Math.abs(x) >= 1e6 || (Math.abs(x) > 0 && Math.abs(x) < 1e-3)) {
    return x.toExponential(4);
  }
  return x.toFixed(4);
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

async function main(): Promise<void> {
  const t0 = performance.now();
  const rows: Row[] = [];
  let passCount = 0;
  let totalChecks = 0;

  console.log(`crosssection: running ${cases.length} cases × ${PROPS.length} properties\n`);

  for (const c of cases) {
    process.stdout.write(`  ${c.name} ... `);
    let ms = NaN;
    try {
      const result = await compute(c.shape, { meshSize: c.meshSize });
      ms = result.solveMs;
      for (const prop of PROPS) {
        const expected = (c.expected as ExpectedTriple)[prop];
        const computed = result[prop];
        const tol = (c.tolerance as ToleranceTriple)[prop];
        const relErr = Math.abs(computed - expected) / Math.abs(expected);
        const pass = relErr < tol;
        rows.push({ caseName: c.name, prop, expected, computed, relErr, tol, pass, ms });
        totalChecks++;
        if (pass) passCount++;
      }
      process.stdout.write(`${ms.toFixed(0)} ms\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`ERROR: ${msg.split("\n")[0]}`);
      for (const prop of PROPS) {
        rows.push({
          caseName: c.name,
          prop,
          expected: (c.expected as ExpectedTriple)[prop],
          computed: NaN,
          relErr: Infinity,
          tol: (c.tolerance as ToleranceTriple)[prop],
          pass: false,
          ms: NaN,
        });
        totalChecks++;
      }
    }
  }

  console.log("\n" + "─".repeat(110));
  console.log(
    [
      pad("case", 32),
      pad("prop", 6),
      pad("expected", 14),
      pad("computed", 14),
      pad("rel err", 11),
      pad("tol", 8),
      "result",
    ].join(" │ "),
  );
  console.log("─".repeat(110));

  for (const r of rows) {
    const cells = [
      pad(r.caseName, 32),
      pad(r.prop, 6),
      pad(fmtNum(r.expected), 14),
      pad(fmtNum(r.computed), 14),
      pad((r.relErr * 100).toFixed(3) + "%", 11),
      pad((r.tol * 100).toFixed(2) + "%", 8),
      r.pass ? "PASS" : "FAIL",
    ];
    console.log(cells.join(" │ "));
  }

  console.log("─".repeat(110));
  const totalSec = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`${passCount}/${totalChecks} checks passed; total ${totalSec} s\n`);

  process.exit(passCount === totalChecks ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
