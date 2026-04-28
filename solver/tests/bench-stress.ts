// What happens with very complex shapes? Probe high-vertex-count circles
// and report timing + element count + any thrown errors.

import { compute } from "../compute.ts";
import { circle } from "../presets.ts";

const VERTEX_COUNTS = [64, 256, 1024, 4096, 16384];

async function main(): Promise<void> {
  console.log(`vertices │ n_elem  │ solve_ms │ outcome`);
  console.log(`─────────┼─────────┼──────────┼────────────`);
  for (const n of VERTEX_COUNTS) {
    const shape = circle(20, n);
    const meshSize = (Math.PI * 100) / 500; // N_TARGET=500 for area=π·10²
    try {
      const t0 = performance.now();
      const r = await compute(shape, { meshSize });
      const wall = performance.now() - t0;
      console.log(
        `${String(n).padStart(8)} │ ${String(r.n_elems).padStart(7)} │ ${r.solveMs.toFixed(0).padStart(8)} │ ok (wall=${wall.toFixed(0)}ms)`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
      console.log(`${String(n).padStart(8)} │ ─       │ ─        │ FAIL: ${msg}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
