import { useEffect, useRef } from 'react'

const palette = [[20, 45, 160], [20, 145, 210], [35, 195, 145], [245, 220, 55], [235, 75, 35]]

const colorForValue = (value) => {
  const position = Math.max(0, Math.min(1, Number(value) || 0)) * (palette.length - 1)
  const lower = Math.floor(position)
  const upper = Math.min(palette.length - 1, lower + 1)
  const amount = position - lower
  return palette[lower].map((channel, index) => Math.round(channel + (palette[upper][index] - channel) * amount))
}

export default function SpectralHeatmapViewer({ concentrationData, mode = 'Cm', opacity = 58 }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const width = concentrationData?.width || 64
    const height = concentrationData?.height || 44
    const values = concentrationData?.values || []
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    const pixels = context.createImageData(width, height)
    for (let index = 0; index < width * height; index += 1) {
      const color = colorForValue(values[index] ?? 0)
      const offset = index * 4
      pixels.data[offset] = color[0]
      pixels.data[offset + 1] = color[1]
      pixels.data[offset + 2] = color[2]
      pixels.data[offset + 3] = 255
    }
    context.putImageData(pixels, 0, 0)
  }, [concentrationData])
  return <div className="heatmap-viewer" style={{ opacity: opacity / 100 }} aria-label={`${mode} false-color heatmap`}><canvas ref={canvasRef} className="heatmap-canvas" /><span className="heatmap-mode-label">{mode} / FALSE COLOR</span></div>
}
