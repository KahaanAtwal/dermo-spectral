import { useCallback, useState } from 'react'

const MIN_INTENSITY = 1

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const log10 = (value) => Math.log(value) / Math.LN10

const mean = (values) => {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

const normalize2d = (matrix) => {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const row of matrix) {
    for (const value of row) {
      if (value < min) min = value
      if (value > max) max = value
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < Number.EPSILON) {
    return matrix.map((row) => row.map(() => 0))
  }

  const scale = max - min
  return matrix.map((row) => row.map((value) => clamp((value - min) / scale, 0, 1)))
}

const deriveWhiteBalanceBaseline = (data) => {
  const pixels = []

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    pixels.push({
      r,
      g,
      b,
      luma: 0.2126 * r + 0.7152 * g + 0.0722 * b,
    })
  }

  pixels.sort((a, b) => b.luma - a.luma)
  const sampleCount = Math.max(1, Math.floor(pixels.length * 0.05))
  const selected = pixels.slice(0, sampleCount)

  return {
    r: mean(selected.map((pixel) => pixel.r)),
    g: mean(selected.map((pixel) => pixel.g)),
    b: mean(selected.map((pixel) => pixel.b)),
  }
}

const deriveSurroundingBaseline = (context, roiRect, sourceBounds) => {
  const margin = Math.max(6, Math.floor(Math.min(roiRect.width, roiRect.height) * 0.12))

  const sampleX = Math.floor(clamp(roiRect.x - margin, sourceBounds.x, sourceBounds.x + sourceBounds.width - 1))
  const sampleY = Math.floor(clamp(roiRect.y - margin, sourceBounds.y, sourceBounds.y + sourceBounds.height - 1))
  const sampleEndX = Math.ceil(clamp(roiRect.x + roiRect.width + margin, sourceBounds.x + 1, sourceBounds.x + sourceBounds.width))
  const sampleEndY = Math.ceil(clamp(roiRect.y + roiRect.height + margin, sourceBounds.y + 1, sourceBounds.y + sourceBounds.height))

  const width = Math.max(1, sampleEndX - sampleX)
  const height = Math.max(1, sampleEndY - sampleY)

  const sampleData = context.getImageData(sampleX, sampleY, width, height).data
  const channelSums = { r: 0, g: 0, b: 0 }
  let pixelCount = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const globalX = sampleX + x
      const globalY = sampleY + y
      const inRoi =
        globalX >= roiRect.x &&
        globalX < roiRect.x + roiRect.width &&
        globalY >= roiRect.y &&
        globalY < roiRect.y + roiRect.height

      if (inRoi) continue

      const idx = (y * width + x) * 4
      channelSums.r += sampleData[idx]
      channelSums.g += sampleData[idx + 1]
      channelSums.b += sampleData[idx + 2]
      pixelCount += 1
    }
  }

  if (pixelCount === 0) {
    return { r: 255, g: 255, b: 255 }
  }

  return {
    r: channelSums.r / pixelCount,
    g: channelSums.g / pixelCount,
    b: channelSums.b / pixelCount,
  }
}

function useTissueOptics() {
  const [analysis, setAnalysis] = useState(null)
  const [error, setError] = useState('')

  const clearAnalysis = useCallback(() => {
    setAnalysis(null)
    setError('')
  }, [])

  const analyzeRoi = useCallback(({ canvas, roi, sourceBounds, baselineMode = 'surrounding' }) => {
    if (!canvas || !roi || !sourceBounds) {
      setAnalysis(null)
      setError('Load an image and draw an ROI to start analysis.')
      return null
    }

    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      setAnalysis(null)
      setError('Canvas context is unavailable for analysis.')
      return null
    }

    const clampedX = Math.floor(clamp(roi.x, sourceBounds.x, sourceBounds.x + sourceBounds.width - 1))
    const clampedY = Math.floor(clamp(roi.y, sourceBounds.y, sourceBounds.y + sourceBounds.height - 1))
    const clampedEndX = Math.ceil(clamp(roi.x + roi.width, sourceBounds.x + 1, sourceBounds.x + sourceBounds.width))
    const clampedEndY = Math.ceil(clamp(roi.y + roi.height, sourceBounds.y + 1, sourceBounds.y + sourceBounds.height))

    const width = clampedEndX - clampedX
    const height = clampedEndY - clampedY

    if (width < 2 || height < 2) {
      setAnalysis(null)
      setError('ROI must overlap the displayed image with at least 2x2 pixels.')
      return null
    }

    const imageData = context.getImageData(clampedX, clampedY, width, height)
    const roiData = imageData.data

    const baseline =
      baselineMode === 'white-balance'
        ? deriveWhiteBalanceBaseline(roiData)
        : deriveSurroundingBaseline(context, { x: clampedX, y: clampedY, width, height }, sourceBounds)

    const i0r = Math.max(MIN_INTENSITY, baseline.r)
    const i0g = Math.max(MIN_INTENSITY, baseline.g)
    const i0b = Math.max(MIN_INTENSITY, baseline.b)

    const redMatrix = []
    const greenMatrix = []
    const blueMatrix = []

    const absorbanceR = []
    const absorbanceG = []
    const absorbanceB = []

    const melaninRaw = []
    const hemoglobinRaw = []

    for (let y = 0; y < height; y += 1) {
      const rowR = []
      const rowG = []
      const rowB = []

      const rowAr = []
      const rowAg = []
      const rowAb = []

      const rowMelanin = []
      const rowHemoglobin = []

      for (let x = 0; x < width; x += 1) {
        const idx = (y * width + x) * 4
        const r = roiData[idx]
        const g = roiData[idx + 1]
        const b = roiData[idx + 2]

        rowR.push(r)
        rowG.push(g)
        rowB.push(b)

        const ar = Math.max(0, -log10(Math.max(MIN_INTENSITY, r) / i0r))
        const ag = Math.max(0, -log10(Math.max(MIN_INTENSITY, g) / i0g))
        const ab = Math.max(0, -log10(Math.max(MIN_INTENSITY, b) / i0b))

        rowAr.push(ar)
        rowAg.push(ag)
        rowAb.push(ab)

        const cm = 0.7 * ar + 0.1 * ag - 0.3 * ab
        const ch = 0.7 * ag + 0.1 * ar - 0.25 * ab

        rowMelanin.push(cm)
        rowHemoglobin.push(ch)
      }

      redMatrix.push(rowR)
      greenMatrix.push(rowG)
      blueMatrix.push(rowB)

      absorbanceR.push(rowAr)
      absorbanceG.push(rowAg)
      absorbanceB.push(rowAb)

      melaninRaw.push(rowMelanin)
      hemoglobinRaw.push(rowHemoglobin)
    }

    const Cm = normalize2d(melaninRaw)
    const Ch = normalize2d(hemoglobinRaw)

    const flatCm = Cm.flat()
    const flatCh = Ch.flat()

    const result = {
      width,
      height,
      baseline,
      rgb: {
        red: redMatrix,
        green: greenMatrix,
        blue: blueMatrix,
      },
      opticalDensity: {
        red: absorbanceR,
        green: absorbanceG,
        blue: absorbanceB,
      },
      concentrations: {
        Cm,
        Ch,
      },
      summary: {
        meanCm: mean(flatCm),
        meanCh: mean(flatCh),
      },
    }

    setAnalysis(result)
    setError('')
    return result
  }, [])

  return {
    analysis,
    error,
    analyzeRoi,
    clearAnalysis,
  }
}

export default useTissueOptics
