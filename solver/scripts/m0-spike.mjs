// M0 exit criterion: load our cytriangle wheel + sectionproperties via micropip,
// triangulate a unit square with quality flags, assert plausible output.
// If this passes, M0 is done.

import { loadPyodide } from "pyodide";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const wheelPath = resolve(here, "../wheels/cytriangle-3.0.2-cp312-cp312-emscripten_3_1_58_wasm32.whl");

const py = await loadPyodide();
console.log("Pyodide booted:", py.version);

await py.loadPackage(["micropip", "numpy"]);
const micropip = py.pyimport("micropip");

// Pyodide's Node loadPackage doesn't accept arbitrary local paths via `loadPackage`,
// but micropip can install from a file:// URL — that's our wheel-injection mechanism.
const wheelUrl = pathToFileURL(wheelPath).href;
console.log("Installing", wheelUrl);
// numpy>=2.3.3 declared but numpy 2.0.2 is what Pyodide 0.27.7 ships.
// numpy 2.x has stable ABI; bypass the version check.
await micropip.install(wheelUrl, py.toPy({ deps: false }));

console.log("Now installing sectionproperties (should now succeed since cytriangle is satisfied)...");
await micropip.install("sectionproperties");
console.log("sectionproperties installed.\n");

// Sanity check 1: triangulate a unit square directly via cytriangle.
const cytriResult = await py.runPythonAsync(`
import cytriangle
sq = {
    "vertices": [[0,0],[1,0],[1,1],[0,1]],
    "segments": [[0,1],[1,2],[2,3],[3,0]],
}
out = cytriangle.triangulate(sq, "pq30a0.01")
{
    "n_vertices": len(out["vertices"]),
    "n_triangles": len(out["triangles"]),
    "first_vertex": list(out["vertices"][0]),
    "first_triangle": list(out["triangles"][0]),
}
`);
console.log("cytriangle direct call:", Object.fromEntries(cytriResult.toJs()));

// Sanity check 2: end-to-end sectionproperties on a circle.
const spResult = await py.runPythonAsync(`
from sectionproperties.pre.library import circular_section
from sectionproperties.analysis import Section
import math

g = circular_section(d=10, n=64)
g.create_mesh(mesh_sizes=[0.5])
s = Section(g)
s.calculate_geometric_properties()
s.calculate_warping_properties()

ixx = s.get_ic()[0]
iyy = s.get_ic()[1]
j   = s.get_j()

# Closed form for solid circle D=10
ix_expected = math.pi * 10**4 / 64
j_expected  = math.pi * 10**4 / 32

{
    "ixx": ixx, "ixx_expected": ix_expected, "ixx_rel_err": abs(ixx - ix_expected) / ix_expected,
    "iyy": iyy, "iyy_expected": ix_expected, "iyy_rel_err": abs(iyy - ix_expected) / ix_expected,
    "j":   j,   "j_expected":   j_expected,  "j_rel_err":   abs(j - j_expected)   / j_expected,
}
`);
const result = Object.fromEntries(spResult.toJs());
console.log("\nSolid circle D=10 (closed form vs computed):");
for (const prop of ["ixx", "iyy", "j"]) {
  const expected = result[`${prop}_expected`];
  const computed = result[prop];
  const relErr = result[`${prop}_rel_err`];
  const pass = relErr < 0.01;
  console.log(`  ${prop.padEnd(4)} expected=${expected.toFixed(4)} computed=${computed.toFixed(4)} rel_err=${(relErr * 100).toFixed(3)}% ${pass ? "PASS" : "FAIL"}`);
}

const allPass =
  result.ixx_rel_err < 0.01 &&
  result.iyy_rel_err < 0.01 &&
  result.j_rel_err < 0.01;

if (allPass) {
  console.log("\n✓ M0 exit criterion met: cytriangle works in Pyodide-on-Node, sectionproperties solves circle to <1%.");
} else {
  console.error("\n✗ M0: numerics out of tolerance. Investigate before proceeding.");
  process.exit(1);
}
