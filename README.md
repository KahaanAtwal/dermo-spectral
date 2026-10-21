# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## `useTissueOptics` hook

`src/hooks/useTissueOptics.js` exports `useTissueOptics` and a pure helper `computeTissueOptics` for canvas ROI analysis.

### Input

```js
useTissueOptics({
  canvas, // HTMLCanvasElement or { current: HTMLCanvasElement }
  roi: { x, y, width, height },
  baseline: {
    values: { r, g, b }, // optional fixed channel baseline values
    referenceRoi: { x, y, width, height }, // optional white-balance/healthy-skin sample
    useRoiAsReference: false, // optional fallback sample source
    fallbackValue: 255,
    coefficients: {
      melanin: { r: 1, g: 0.15, b: -0.1 },
      hemoglobin: { r: 0.1, g: 1, b: -0.2 },
    },
  },
  autoCompute: true,
})
```

### Output behavior

- ROI is clipped to canvas bounds; invalid/empty ROI returns empty matrices.
- `rgb.{r,g,b}` returns per-channel pixel matrices (`height x width`).
- Optical density is computed per pixel and channel: `A = -log10(I / I0)`.
  - `I` and `I0` are clamped into `[1, 255]` to avoid invalid logarithms.
  - Baseline precedence per channel: explicit `baseline.values` → sampled `referenceRoi` (or ROI if enabled) → `fallbackValue`.
- Tissue optics model is intentionally simplified and tunable:
  - red-heavy absorbance for melanin (`Cm`)
  - green-heavy absorbance for hemoglobin (`Ch`)
  - blue term as a surface-scatter correction
- `concentrations.{Cm,Ch}` are min-max normalized to `[0, 1]` across the ROI.
  - Constant or empty ROIs return zero-filled arrays.

> This model is a research-oriented relative signal estimate and is **not** a clinically validated diagnostic measurement.
