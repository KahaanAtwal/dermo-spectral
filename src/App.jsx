import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import PresetCalibrationBench, { TARGETS } from './PresetCalibrationBench'
import SpectralHeatmapViewer from './SpectralHeatmapViewer'
import useTissueOptics from './hooks/useTissueOptics'

const MAX_FILE_SIZE = 20 * 1024 * 1024
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg'])

const calibrationModes = [
  ['white-balance', 'White Balance Reference', 'Brightest pixels inside the ROI provide I0.', '◌'],
  ['melanin', 'Melanin Map Mode', 'Relative melanin-dominant signal estimate.', '◒'],
  ['hemoglobin', 'Hemoglobin / Perfusion Map Mode', 'Relative hemoglobin-dominant signal estimate.', '⌁'],
]

function App() {
  const [imageUrl, setImageUrl] = useState(null)
  const [fileName, setFileName] = useState('No image loaded')
  const [activeMode, setActiveMode] = useState('white-balance')
  const [roi, setRoi] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [fileError, setFileError] = useState('')
  const [heatmapOpacity, setHeatmapOpacity] = useState(58)
  const [selectedTarget, setSelectedTarget] = useState(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })

  const fileInputRef = useRef(null)
  const workspaceRef = useRef(null)
  const canvasRef = useRef(null)
  const imageRef = useRef(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const imageUrlRef = useRef(null)

  const analysis = useTissueOptics({
    canvas: canvasRef,
    roi,
    baselineMode: activeMode === 'white-balance' ? 'white-balance' : 'surrounding',
  })

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setIsCameraOpen(false)
  }, [])

  const clearImageUrl = useCallback(() => {
    if (imageUrlRef.current?.startsWith('blob:')) URL.revokeObjectURL(imageUrlRef.current)
    imageUrlRef.current = null
  }, [])

  const loadFile = useCallback((file) => {
    if (!file || !IMAGE_TYPES.has(file.type)) {
      setFileError('Choose a PNG, JPG, or JPEG image to continue.')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setFileError('Image is too large. Please choose a file below 20 MB.')
      return
    }
    clearImageUrl()
    const nextUrl = URL.createObjectURL(file)
    imageUrlRef.current = nextUrl
    setImageUrl(nextUrl)
    setFileName(file.name)
    setSelectedTarget(null)
    setRoi(null)
    setFileError('')
    setCameraError('')
    stopCamera()
  }, [clearImageUrl, stopCamera])

  const selectTarget = useCallback((target) => {
    clearImageUrl()
    setImageUrl(target.dataUrl)
    setFileName(`${target.shortLabel} · synthetic`)
    setSelectedTarget(target)
    setRoi(null)
    setFileError('')
    stopCamera()
  }, [clearImageUrl, stopCamera])

  const toggleCamera = async () => {
    if (isCameraOpen) {
      stopCamera()
      return
    }
    setCameraError('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Live camera is not available in this browser.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      streamRef.current = stream
      setIsCameraOpen(true)
    } catch {
      setCameraError('Camera access was unavailable. Check browser permissions.')
    }
  }

  const captureCameraFrame = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setCameraError('Camera stream is not ready yet. Try again in a moment.')
      return
    }
    const context = canvas.getContext('2d')
    canvas.width = canvasSize.width
    canvas.height = canvasSize.height
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    setImageUrl('camera-canvas')
    setFileName(`camera-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`)
    setSelectedTarget(null)
    setRoi(null)
    setCameraError('')
    stopCamera()
  }

  useEffect(() => {
    if (isCameraOpen && videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current
  }, [isCameraOpen])

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) return undefined
    const updateSize = () => {
      const bounds = workspace.getBoundingClientRect()
      setCanvasSize({ width: Math.max(1, Math.floor(bounds.width)), height: Math.max(1, Math.floor(bounds.height)) })
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(workspace)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!imageUrl || imageUrl === 'camera-canvas') return undefined
    const image = new Image()
    image.onload = () => { imageRef.current = image }
    image.onerror = () => setFileError('Unable to load image. Try a different file.')
    image.src = imageUrl
    return () => { imageRef.current = null }
  }, [imageUrl])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !canvasSize.width || !canvasSize.height) return
    canvas.width = canvasSize.width
    canvas.height = canvasSize.height
    const context = canvas.getContext('2d')
    context.fillStyle = '#0f1720'
    context.fillRect(0, 0, canvas.width, canvas.height)
    if (imageRef.current) {
      const image = imageRef.current
      const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight)
      const width = image.naturalWidth * scale
      const height = image.naturalHeight * scale
      context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
    }
    if (roi) {
      context.strokeStyle = '#d8ff63'
      context.lineWidth = 2
      context.strokeRect(roi.x, roi.y, roi.width, roi.height)
      context.fillStyle = 'rgba(5, 13, 14, .35)'
      context.fillRect(0, 0, canvas.width, roi.y)
      context.fillRect(0, roi.y, roi.x, roi.height)
      context.fillRect(roi.x + roi.width, roi.y, canvas.width - roi.x - roi.width, roi.height)
      context.fillRect(0, roi.y + roi.height, canvas.width, canvas.height - roi.y - roi.height)
    }
  }, [canvasSize, imageUrl, roi])

  const pointFromEvent = (event) => {
    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!bounds) return null
    return {
      x: Math.max(0, Math.min(canvasSize.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(canvasSize.height, event.clientY - bounds.top)),
    }
  }

  const startRoi = (event) => {
    if (!imageUrl || isCameraOpen) return
    const point = pointFromEvent(event)
    if (!point) return
    setRoi({ x: point.x, y: point.y, width: 0, height: 0 })
    setIsDragging(true)
    canvasRef.current?.setPointerCapture?.(event.pointerId)
  }

  const updateRoi = (event) => {
    if (!isDragging || !roi) return
    const point = pointFromEvent(event)
    if (!point) return
    setRoi((current) => ({ ...current, width: point.x - current.x, height: point.y - current.y }))
  }

  const endRoi = () => {
    setIsDragging(false)
    setRoi((current) => {
      if (!current) return null
      const normalized = {
        x: Math.min(current.x, current.x + current.width),
        y: Math.min(current.y, current.y + current.height),
        width: Math.abs(current.width),
        height: Math.abs(current.height),
      }
      return normalized.width >= 2 && normalized.height >= 2 ? normalized : null
    })
  }

  useEffect(() => () => {
    stopCamera()
    clearImageUrl()
  }, [clearImageUrl, stopCamera])

  const heatmapData = analysis.concentrations[activeMode === 'hemoglobin' ? 'Ch' : 'Cm']
  const hasAnalysis = analysis.width > 0 && analysis.height > 0

  return (
    <main className="app-shell">
      <header className="clinical-header">
        <div className="brand-lockup"><div className="brand-mark" aria-hidden="true">D<span>•</span>S</div><div><p className="eyebrow">Clinical imaging workspace</p><h1>DermoSpectral <span>Tissue Optics Analyzer</span></h1></div></div>
        <div className="header-status"><i /> System ready <span>v0.2.0</span></div>
      </header>

      <div className="top-bench"><PresetCalibrationBench selectedId={selectedTarget?.id} onSelect={selectTarget} /></div>

      <div className="dashboard-grid">
        <section className="workspace-column" aria-label="Image workspace">
          <div className="section-heading"><div><p className="eyebrow">01 / Image workspace</p><h2>Load a tissue image</h2></div><div className="workspace-meta"><span className="status-dot" /> ROI tool active</div></div>
          <div ref={workspaceRef} className="image-workspace" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); loadFile(event.dataTransfer.files?.[0]) }}>
            <canvas ref={canvasRef} className="analysis-canvas" onPointerDown={startRoi} onPointerMove={updateRoi} onPointerUp={endRoi} onPointerCancel={endRoi} aria-label="Image canvas for ROI selection" />
            {isCameraOpen && <video ref={videoRef} className="camera-feed" autoPlay playsInline muted />}
            {!imageUrl && !isCameraOpen && <div className="dropzone-content"><div className="upload-orbit" aria-hidden="true"><span>↑</span></div><h3>Drop an image to begin</h3><p>or choose a high-resolution skin photograph</p><button type="button" className="primary-button" onClick={() => fileInputRef.current?.click()}><span>＋</span> Select image</button><p className="format-note">PNG, JPG or JPEG <b>·</b> up to 20 MB</p></div>}
            {isCameraOpen && <><div className="camera-label"><i /> LIVE CAMERA</div><button type="button" className="capture-button" onClick={captureCameraFrame}>Capture frame for ROI</button></>}
            {imageUrl && !roi && !isDragging && !isCameraOpen && <div className="workspace-hint">Click and drag to define a region of interest</div>}
          </div>
          <div className="workspace-footer"><div className="file-status"><span className="file-icon">▧</span><div><b>{fileName}</b><small>{imageUrl ? 'Ready for analysis' : 'Awaiting image input'}</small></div></div><div className="workspace-actions"><input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" onChange={(event) => loadFile(event.target.files?.[0])} hidden /><button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()}>Import image</button><button type="button" className={`camera-button ${isCameraOpen ? 'active' : ''}`} onClick={toggleCamera}><span>◉</span>{isCameraOpen ? 'Close camera' : 'Live capture'}</button></div></div>
          <div className="overlay-controls"><label htmlFor="opacity-slider">Heatmap opacity <output>{heatmapOpacity}%</output></label><input id="opacity-slider" type="range" min="0" max="100" value={heatmapOpacity} onChange={(event) => setHeatmapOpacity(Number(event.target.value))} /></div>
          {(cameraError || fileError || analysis.error) && <p className="inline-error" role="alert">{cameraError || fileError || analysis.error}</p>}
        </section>

        <aside className="calibration-panel" aria-label="Calibration controls"><div className="section-heading panel-heading"><div><p className="eyebrow">02 / Analysis setup</p><h2>Calibration</h2></div><span className="settings-icon">⌘</span></div><p className="panel-intro">Choose a reference mode to tune how tissue signals are interpreted.</p><div className="mode-list">{calibrationModes.map(([id, label, detail, icon]) => <button key={id} type="button" className={`mode-card ${activeMode === id ? 'selected' : ''}`} onClick={() => setActiveMode(id)} aria-pressed={activeMode === id}><span className="mode-icon">{icon}</span><span className="mode-copy"><b>{label}</b><small>{detail}</small></span><span className="radio-indicator" /></button>)}</div><div className="calibration-note"><span>✦</span><p><b>Research preview.</b> Results are relative image signals, not clinical diagnoses.</p></div><div className="panel-bottom"><div><span>Input color space</span><b>sRGB / 8-bit</b></div><div><span>Capture condition</span><b>Uncalibrated</b></div></div></aside>
      </div>

      <div className="lower-dashboard"><section className="metrics-card" aria-labelledby="metrics-title"><div className="bench-heading"><div><p className="eyebrow">03 / ROI readout</p><h2 id="metrics-title">Tissue optics summary</h2></div><span className="metrics-status">{hasAnalysis ? 'Computed in browser' : 'Waiting for ROI'}</span></div>{hasAnalysis ? <><div className="metric-grid"><div className="metric"><span>ROI pixels</span><strong>{analysis.width}×{analysis.height}</strong><small>selected region</small></div><div className="metric"><span>Mean Cm</span><strong>{analysis.summary.meanCm.toFixed(3)}</strong><small>relative melanin signal</small></div><div className="metric"><span>Mean Ch</span><strong>{analysis.summary.meanCh.toFixed(3)}</strong><small>relative hemoglobin signal</small></div><div className="metric"><span>I0 baseline</span><strong>{analysis.baseline.r.toFixed(0)}</strong><small>red-channel reference</small></div></div><div className="analysis-heatmap"><SpectralHeatmapViewer concentrationData={{ width: analysis.width, height: analysis.height, values: heatmapData.flat() }} mode={activeMode === 'hemoglobin' ? 'Ch' : 'Cm'} opacity={heatmapOpacity} /></div></> : <p className="empty-metrics">Load an image, then click and drag over a region to calculate a relative map.</p>}</section></div>
      <footer className="app-footer"><span>DERMOSPECTRAL / RESEARCH PREVIEW</span><span>Privacy-first · Images stay in your browser</span></footer>
    </main>
  )
}

export default App
