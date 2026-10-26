import { useCallback, useEffect, useMemo, useState } from 'react'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const intensity = (value) => clamp(Number.isFinite(value) ? value : 255, 1, 255)

const normalize = (matrix) => {
  const values = matrix.flat()
  if (!values.length) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < Number.EPSILON) return matrix.map((row) => row.map(() => 0))
  return matrix.map((row) => row.map((value) => clamp((value - min) / (max - min), 0, 1)))
}

const mean = (matrix) => {
  const values = matrix.flat()
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

const topBrightestBaseline = (pixels) => {
  const sorted = [...pixels].sort((a, b) => (0.2126 * b.r + 0.7152 * b.g + 0.0722 * b.b) - (0.2126 * a.r + 0.7152 * a.g + 0.0722 * a.b))
  const sample = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.05)))
  return {
    r: sample.reduce((sum, pixel) => sum + pixel.r, 0) / sample.length,
    g: sample.reduce((sum, pixel) => sum + pixel.g, 0) / sample.length,
    b: sample.reduce((sum, pixel) => sum + pixel.b, 0) / sample.length,
    source: 'brightest-5-percent',
  }
}

const surroundingBaseline = (context, roi, canvas) => {
  const margin = Math.max(6, Math.floor(Math.min(roi.width, roi.height) * 0.15))
  const x = Math.max(0, Math.floor(roi.x - margin))
  const y = Math.max(0, Math.floor(roi.y - margin))
  const right = Math.min(canvas.width, Math.ceil(roi.x + roi.width + margin))
  const bottom = Math.min(canvas.height, Math.ceil(roi.y + roi.height + margin))
  const width = Math.max(1, right - x)
  const height = Math.max(1, bottom - y)
  const data = context.getImageData(x, y, width, height).data
  const pixels = []
  for (let row = 0; row < height; row += 1) for (let col = 0; col < width; col += 1) {
    const globalX = x + col
    const globalY = y + row
    if (globalX >= roi.x && globalX < roi.x + roi.width && globalY >= roi.y && globalY < roi.y + roi.height) continue
    const index = (row * width + col) * 4
    pixels.push({ r: data[index], g: data[index + 1], b: data[index + 2] })
  }
  if (!pixels.length) return { r: 255, g: 255, b: 255, source: 'fallback' }
  return { r: mean([pixels.map((pixel) => pixel.r)]), g: mean([pixels.map((pixel) => pixel.g)]), b: mean([pixels.map((pixel) => pixel.b)]), source: 'surrounding-ring' }
}

const compute = (canvas, roi, baselineMode) => {
  if (!canvas || !roi || roi.width < 2 || roi.height < 2) return { width: 0, height: 0, error: null, baseline: { r: 255, g: 255, b: 255 }, rgb: { r: [], g: [], b: [] }, opticalDensity: { r: [], g: [], b: [] }, concentrations: { Cm: [], Ch: [] }, summary: { meanCm: 0, meanCh: 0 } }
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return { width: 0, height: 0, error: 'Canvas context is unavailable.', baseline: { r: 255, g: 255, b: 255 }, rgb: { r: [], g: [], b: [] }, opticalDensity: { r: [], g: [], b: [] }, concentrations: { Cm: [], Ch: [] }, summary: { meanCm: 0, meanCh: 0 } }

  const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(roi.x)))
  const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(roi.y)))
  const right = Math.max(x + 1, Math.min(canvas.width, Math.ceil(roi.x + roi.width)))
  const bottom = Math.max(y + 1, Math.min(canvas.height, Math.ceil(roi.y + roi.height)))
  const width = right - x
  const height = bottom - y
  const data = context.getImageData(x, y, width, height).data
  const pixels = []
  for (let index = 0; index < data.length; index += 4) pixels.push({ r: data[index], g: data[index + 1], b: data[index + 2] })
  const baseline = baselineMode === 'white-balance' ? topBrightestBaseline(pixels) : surroundingBaseline(context, { x, y, width, height }, canvas)
  const rgb = { r: [], g: [], b: [] }
  const opticalDensity = { r: [], g: [], b: [] }
  const cm = []
  const ch = []
  for (let row = 0; row < height; row += 1) {
    const rowR = []; const rowG = []; const rowB = []; const rowAr = []; const rowAg = []; const rowAb = []; const rowCm = []; const rowCh = []
    for (let col = 0; col < width; col += 1) {
      const pixel = pixels[row * width + col]
      const r = intensity(pixel.r); const g = intensity(pixel.g); const b = intensity(pixel.b)
      const ar = Math.max(0, -Math.log10(r / intensity(baseline.r)))
      const ag = Math.max(0, -Math.log10(g / intensity(baseline.g)))
      const ab = Math.max(0, -Math.log10(b / intensity(baseline.b)))
      rowR.push(r); rowG.push(g); rowB.push(b); rowAr.push(ar); rowAg.push(ag); rowAb.push(ab)
      rowCm.push(0.7 * ar + 0.1 * ag - 0.3 * ab)
      rowCh.push(0.1 * ar + 0.7 * ag - 0.25 * ab)
    }
    rgb.r.push(rowR); rgb.g.push(rowG); rgb.b.push(rowB); opticalDensity.r.push(rowAr); opticalDensity.g.push(rowAg); opticalDensity.b.push(rowAb); cm.push(rowCm); ch.push(rowCh)
  }
  const Cm = normalize(cm); const Ch = normalize(ch)
  return { width, height, baseline, rgb, opticalDensity, concentrations: { Cm, Ch }, summary: { meanCm: mean(Cm), meanCh: mean(Ch) }, error: null }
}

export default function useTissueOptics({ canvas, roi, baselineMode = 'surrounding' } = {}) {
  const [revision, setRevision] = useState(0)
  const canvasElement = canvas?.current ?? canvas
  const recompute = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => { recompute() }, [recompute, roi, baselineMode, canvasElement, revision])
  return useMemo(() => compute(canvasElement, roi, baselineMode), [canvasElement, roi, baselineMode, revision])
}

export { compute }
