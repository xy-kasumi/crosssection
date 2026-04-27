# crosssection

In-browser calculator for 2D cross-section properties: Ix, Iy (second moments of area) and J (torsional constant).

## Status

In development. Milestone 0: porting `cytriangle` to Pyodide so `sectionproperties` runs in the browser.

## Layout

```
core/             TypeScript library (Pyodide bridge + types). Stack-neutral.
compute/          Python source loaded into Pyodide.
wheels/           Vendored Pyodide wheels (cytriangle, sectionproperties).
pyodide-build/    Recipes for rebuilding the vendored wheels.
tests/            CLI test battery; validates against external references.
web/              Browser UI (M2). Self-contained; replaceable.
```

## Verification

```
npm install
npm test
```

Expected: all preset shapes match externally-cited closed forms / standards within documented tolerances.
