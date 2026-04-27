// Probe: try `micropip.install("sectionproperties")` and report what actually fails.
// This de-risks M0 by replacing assumptions with measurement.

import { loadPyodide } from "pyodide";

const py = await loadPyodide();
console.log("Pyodide booted:", py.version);

await py.loadPackage("micropip");
const micropip = py.pyimport("micropip");

console.log("\n--- attempting micropip.install('sectionproperties') ---");
try {
  await micropip.install("sectionproperties", py.toPy({ keep_going: true }));
  console.log("install OK");

  // If it installed, probe what we got
  const sp = py.pyimport("sectionproperties");
  console.log("sectionproperties imported. version =", sp.__version__);
  // Try a trivial mesh
  const code = `
from sectionproperties.pre.library import circular_section
from sectionproperties.analysis import Section
g = circular_section(d=10, n=32)
g.create_mesh(mesh_sizes=[1.0])
s = Section(g)
s.calculate_geometric_properties()
s.calculate_warping_properties()
ixx, iyy = s.get_ic()[:2]
j = s.get_j()
{"ixx": ixx, "iyy": iyy, "j": j}
`;
  const result = await py.runPythonAsync(code);
  console.log("trivial circle solve result:", result.toJs ? Object.fromEntries(result.toJs()) : result);
} catch (err) {
  console.error("\n--- install failed ---");
  console.error(err.message ?? err);
  // Check if it's specifically the cytriangle blocker
  if (String(err).includes("triangle") || String(err).includes("cytriangle")) {
    console.error("\n>>> CONFIRMED: cytriangle is the blocker (matches plan assumption)");
  } else {
    console.error("\n>>> UNEXPECTED failure shape — re-read before proceeding");
  }
}
