import { useCallback, useMemo, useState } from 'react'

const DEFAULT_BASELINE_VALUE = 255
const DEFAULT_COEFFICIENTS = {
  melanin: { r: 1, g: 0.15, b: -0.1 },
  hemoglobin: { r: 0.1, g: 1, b: -0.2 },
}

const clampIntensity = (value) => Math.max(1, Math.min(255, Number.isFinite(value) ? value : DEFAULT_BASELINE_VALUE))
const clampCoordinate = (value) => (Number.isFinite(value) ? Math.trunc(value) : 0)

const toPoint = (roi = {}) => {
  const x = roi.x ?? roi.left ?? roi.startX ?? 0
  const y = roi.y ?? roi.top ?? roi.startY ?? 0
  const width = roi.width ?? roi.w ?? 0
  const height = roi.height ?? roi.h ?? 0
  return {
    x: clampCoordinate(x),
    y: clampCoordinate(y),
    width: clampCoordinate(width),
    height: clampCoordinate(height),
  }
}

const toRect = (roi, maxWidth, maxHeight) => {
  const point = toPoint(roi)
  const x1 = Math.min(point.x, point.x + point.width)
  const y1 = Math.min(point.y, point.y + point.height)
  const x2 = Math.max(point.x, point.x + point.width)
  const y2 = Math.max(point.y, point.y + point.height)

  const clippedX1 = Math.max(0, Math.min(maxWidth, x1))
  const clippedY1 = Math.max(0, Math.min(maxHeight, y1))
  const clippedX2 = Math.max(0, Math.min(maxWidth, x2))
  const clippedY2 = Math.max(0, Math.min(maxHeight, y2))

  return {
    x: clippedX1,
    y: clippedY1,
    width: Math.max(0, clippedX2 - clippedX1),
    height: Math.max(0, clippedY2 - clippedY1),
  }
}

const normalizeMatrix = (matrix, width, height) => {
  if (!width || !height || matrix.length === 0) return []
  let min = Infinity
  let max = -Infinity

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const value = matrix[row][col]
      if (value < min) min = value
      if (value > max) max = value
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    return Array.from({ length: height }, () => Array.from({ length: width }, () => 0))
  }

  const range = max - min
  return matrix.map((row) => row.map((value) => (value - min) / range))
}

const emptyResult = (rect = { x: 0, y: 0, width: 0, height: 0 }, baseline = null) => ({
  roi: rect,
  baseline,
  rgb: { r: [], g: [], b: [] },
  opticalDensity: { r: [], g: [], b: [] },
  concentrations: { Cm: [], Ch: [] },
})

const deriveBaselineFromRect = (ctx, rect) => {
  if (!rect.width || !rect.height) return null

  const sample = ctx.getImageData(rect.x, rect.y, rect.width, rect.height)
  const sums = { r: 0, g: 0, b: 0 }
  const pixels = rect.width * rect.height

  for (let i = 0; i < sample.data.length; i += 4) {
    sums.r += sample.data[i]
    sums.g += sample.data[i + 1]
    sums.b += sample.data[i + 2]
  }

  if (!pixels) return null
  return {
    r: clampIntensity(sums.r / pixels),
    g: clampIntensity(sums.g / pixels),
    b: clampIntensity(sums.b / pixels),
  }
}

const resolveBaseline = ({ baseline, ctx, canvasWidth, canvasHeight, roiRect }) => {
  const baselineValues = baseline?.values ?? baseline?.channels ?? null
  const fallbackValue = clampIntensity(baseline?.fallbackValue ?? DEFAULT_BASELINE_VALUE)
  const referenceRect = baseline?.referenceRoi ? toRect(baseline.referenceRoi, canvasWidth, canvasHeight) : null

  let sampled = null
  if (referenceRect && referenceRect.width && referenceRect.height) {
    sampled = deriveBaselineFromRect(ctx, referenceRect)
  } else if (baseline?.useRoiAsReference && roiRect.width && roiRect.height) {
    sampled = deriveBaselineFromRect(ctx, roiRect)
  }

  return {
    r: clampIntensity(baselineValues?.r ?? sampled?.r ?? baselineValues?.red ?? fallbackValue),
    g: clampIntensity(baselineValues?.g ?? sampled?.g ?? baselineValues?.green ?? fallbackValue),
    b: clampIntensity(baselineValues?.b ?? sampled?.b ?? baselineValues?.blue ?? fallbackValue),
    source: sampled
      ? 'sampled-reference'
      : baselineValues
        ? 'configured-values'
        : 'fallback',
  }
}

const toCanvasElement = (canvasOrRef) => {
  if (!canvasOrRef) return null
  if (typeof canvasOrRef.getContext === 'function') return canvasOrRef
  return canvasOrRef.current ?? null
}

export const computeTissueOptics = ({ canvas, roi, baseline }) => {
  const canvasElement = toCanvasElement(canvas)

  if (!canvasElement) {
    return { ...emptyResult(), error: 'Canvas source is unavailable.' }
  }

  const width = canvasElement.width ?? 0
  const height = canvasElement.height ?? 0
  const rect = toRect(roi, width, height)

  if (!rect.width || !rect.height) {
    return { ...emptyResult(rect), error: null }
  }

  const ctx = canvasElement.getContext?.('2d', { willReadFrequently: true })
  if (!ctx) {
    return { ...emptyResult(rect), error: '2D canvas context is unavailable.' }
  }

  try {
    const imageData = ctx.getImageData(rect.x, rect.y, rect.width, rect.height)
    const coefficients = {
      melanin: { ...DEFAULT_COEFFICIENTS.melanin, ...(baseline?.coefficients?.melanin ?? {}) },
      hemoglobin: { ...DEFAULT_COEFFICIENTS.hemoglobin, ...(baseline?.coefficients?.hemoglobin ?? {}) },
    }

    const baselineResolved = resolveBaseline({ baseline, ctx, canvasWidth: width, canvasHeight: height, roiRect: rect })

    const r = Array.from({ length: rect.height }, () => Array(rect.width).fill(0))
    const g = Array.from({ length: rect.height }, () => Array(rect.width).fill(0))
    const b = Array.from({ length: rect.height }, () => Array(rect.width).fill(0))
    const odR = Array.from({ length: rect.height }, () => Array(rect.width).fill(0))
    const odG = Array.from({ length: rect.height }, () => Array(rect.width).fill(0))
    const odB = Array.from({ length: rect.height }, () => Array(rect.width).fill(0))
    const cmRaw = Array.from({ length: rect.height }, () => Array(rect.width).fill(0))
    const chRaw = Array.from({ length: rect.height }, () => Array(rect.width).fill(0))

    for (let row = 0; row < rect.height; row += 1) {
      for (let col = 0; col < rect.width; col += 1) {
        const index = (row * rect.width + col) * 4

        const rI = clampIntensity(imageData.data[index])
        const gI = clampIntensity(imageData.data[index + 1])
        const bI = clampIntensity(imageData.data[index + 2])

        r[row][col] = rI
        g[row][col] = gI
        b[row][col] = bI

        const aR = -Math.log10(rI / baselineResolved.r)
        const aG = -Math.log10(gI / baselineResolved.g)
        const aB = -Math.log10(bI / baselineResolved.b)

        odR[row][col] = aR
        odG[row][col] = aG
        odB[row][col] = aB

        cmRaw[row][col] = coefficients.melanin.r * aR + coefficients.melanin.g * aG + coefficients.melanin.b * aB
        chRaw[row][col] = coefficients.hemoglobin.r * aR + coefficients.hemoglobin.g * aG + coefficients.hemoglobin.b * aB
      }
    }

    return {
      ...emptyResult(rect, baselineResolved),
      rgb: { r, g, b },
      opticalDensity: { r: odR, g: odG, b: odB },
      concentrations: {
        Cm: normalizeMatrix(cmRaw, rect.width, rect.height),
        Ch: normalizeMatrix(chRaw, rect.width, rect.height),
      },
      error: null,
    }
  } catch (error) {
    return {
      ...emptyResult(rect),
      error: error instanceof Error ? error.message : 'Failed to read pixel data from canvas.',
    }
  }
}

export function useTissueOptics({ canvas, roi, baseline, autoCompute = true } = {}) {
  const [manualResult, setManualResult] = useState(() => ({
    ...emptyResult(),
    error: null,
  }))

  const computedResult = useMemo(
    () => computeTissueOptics({ canvas, roi, baseline }),
    [canvas, roi, baseline],
  )

  const recompute = useCallback(() => {
    const next = computeTissueOptics({ canvas, roi, baseline })
    setManualResult(next)
    return next
  }, [canvas, roi, baseline])

  const result = autoCompute ? computedResult : manualResult

  return {
    ...result,
    isLoading: false,
    recompute,
  }
}

export default useTissueOptics
