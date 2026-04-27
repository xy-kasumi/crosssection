"""Section-property solve, called from JS via Pyodide.

Input contract (across the JS<->Python boundary):
    shape: list[list[list[float]]]
        A polygon-with-holes specification.
        shape[0] is the outer ring (CCW).
        shape[1:] are inner rings / holes (CW), if any.
        Each ring is a list of [x, y] pairs. First and last point need NOT
        coincide; shapely closes rings automatically.
    mesh_size: float
        Target maximum element area for `sectionproperties` Tri6 mesher.
        Smaller -> finer mesh -> closer to truth, slower.

Output: a dict (auto-converted to a JS object by Pyodide):
    ixx_c, iyy_c, ixy_c : float  (second moments of area about the centroid)
    j                    : float  (St. Venant torsional constant)
    area                 : float
    cx, cy               : float  (centroid in input coordinate system)

Failure modes raise Python exceptions — Pyodide propagates these to JS as
PythonError, which run-battery.ts surfaces in its FAIL row.
"""

from sectionproperties.analysis import Section
from sectionproperties.pre.geometry import Geometry
from shapely.geometry import Polygon as ShPolygon


def solve(shape, mesh_size):
    if not shape:
        raise ValueError("solve(): shape is empty")
    outer = shape[0]
    holes = shape[1:] if len(shape) > 1 else []

    sh_poly = ShPolygon(outer, holes=holes)
    if not sh_poly.is_valid:
        # shapely's reason string is more useful than the bool
        from shapely.validation import explain_validity
        raise ValueError(f"solve(): invalid polygon: {explain_validity(sh_poly)}")

    geom = Geometry(sh_poly)
    geom.create_mesh(mesh_sizes=[float(mesh_size)])

    sec = Section(geom)
    sec.calculate_geometric_properties()
    sec.calculate_warping_properties()

    ixx_c, iyy_c, ixy_c = sec.get_ic()
    cx, cy = sec.get_c()

    return {
        "ixx_c": float(ixx_c),
        "iyy_c": float(iyy_c),
        "ixy_c": float(ixy_c),
        "j":     float(sec.get_j()),
        "area":  float(sec.get_area()),
        "cx":    float(cx),
        "cy":    float(cy),
    }
