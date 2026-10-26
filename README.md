# DermoSpectral

DermoSpectral is a browser-only React/Vite research prototype for inspecting skin or tissue images. It supports image upload, drag-and-drop, webcam capture, region-of-interest selection, and relative melanin/hemoglobin-style false-color maps.

## Important disclaimer

The outputs are simplified, relative image-signal estimates. They are not clinically validated measurements, medical diagnoses, or a substitute for professional evaluation.

## Run locally

Requirements: Node.js 20 or newer is recommended.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

To validate a production build:

```bash
npm run build
npm run lint
npm run preview
```

## Use the app

1. Click **Select image** or **Import image**, or drag a PNG/JPG/JPEG into the workspace.
2. Images are limited to 20 MB and stay in the browser; there is no upload backend.
3. Click and drag over the displayed image to define a region of interest.
4. Choose a calibration mode:
   - **White Balance Reference** uses the brightest 5% of ROI pixels as the channel baseline.
   - **Melanin Map Mode** emphasizes the red-channel absorbance signal.
   - **Hemoglobin / Perfusion Map Mode** emphasizes the green-channel absorbance signal.
5. Review the ROI size, relative Cm/Ch summaries, baseline, and false-color heatmap.
6. For camera input, click **Live capture**, allow camera access, then click **Capture frame for ROI**.
7. Use the heatmap opacity slider to compare the visualization with the source image.

The analysis uses the simplified optical-density relation `A = -log10(I / I0)` and normalizes the resulting Cm and Ch maps from 0 to 1 within the selected ROI. All processing happens in the browser canvas.

## Project structure

- `src/App.jsx` — dashboard, image/camera input, ROI selection, and metrics
- `src/hooks/useTissueOptics.js` — browser-side RGB extraction and relative tissue-optics calculations
- `src/PresetCalibrationBench.jsx` — synthetic calibration examples
- `src/SpectralHeatmapViewer.jsx` — false-color heatmap renderer
