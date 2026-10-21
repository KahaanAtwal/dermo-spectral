import { useEffect, useRef, useState } from 'react'
import './App.css'
import PresetCalibrationBench, { makeConcentration, TARGETS } from './PresetCalibrationBench'
import SpectralHeatmapViewer from './SpectralHeatmapViewer'

const calibrationModes = [
  ['white-balance', 'White Balance Reference', 'Neutral reference for color correction', '◌'],
  ['melanin', 'Melanin Map Mode', 'Relative melanin concentration', '◒'],
  ['hemoglobin', 'Hemoglobin / Perfusion Map Mode', 'Relative blood oxygenation signal', '⌁'],
]

function App() {
  const [imageUrl, setImageUrl] = useState(null)
  const [fileName, setFileName] = useState('No image loaded')
  const [activeMode, setActiveMode] = useState('white-balance')
  const [roi, setRoi] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [selectedTarget, setSelectedTarget] = useState(null)
  const [heatmapOpacity, setHeatmapOpacity] = useState(58)
  const [concentrationData, setConcentrationData] = useState(() => makeConcentration(TARGETS[2]))
  const [fileError, setFileError] = useState('')
  const fileInputRef = useRef(null)
  const workspaceRef = useRef(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const imageUrlRef = useRef(null)

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setIsCameraOpen(false)
  }

  const loadFile = (file) => {
    const isSupportedImage = file && ['image/png', 'image/jpeg'].includes(file.type)
    if (!isSupportedImage) {
      setFileError('Choose a PNG, JPG, or JPEG image to continue.')
      return
    }
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
    const nextImageUrl = URL.createObjectURL(file)
    imageUrlRef.current = nextImageUrl
    setImageUrl(nextImageUrl)
    setFileName(file.name)
    setRoi(null)
    stopCamera()
    setFileError('')
  }

  const selectTarget = (target) => {
    setImageUrl(target.dataUrl)
    setFileName(`${target.shortLabel} · synthetic`)
    setSelectedTarget(target)
    setConcentrationData(target.concentrationData)
    setRoi(null)
    setIsCameraOpen(false)
  }

  const getPoint = (event) => {
    const bounds = workspaceRef.current.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100)),
    }
  }

  const startRoi = (event) => {
    if (!imageUrl || isCameraOpen) return
    const point = getPoint(event)
    setRoi({ startX: point.x, startY: point.y, width: 0, height: 0 })
    setIsDragging(true)
    workspaceRef.current.setPointerCapture?.(event.pointerId)
  }

  const updateRoi = (event) => {
    if (!isDragging || !roi) return
    const point = getPoint(event)
    setRoi((current) => ({ ...current, width: point.x - current.startX, height: point.y - current.startY }))
  }

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

  useEffect(() => {
    if (isCameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
    }
  }, [isCameraOpen])

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
  }, [])

  const normalizedRoi = roi && {
    left: `${Math.min(roi.startX, roi.startX + roi.width)}%`,
    top: `${Math.min(roi.startY, roi.startY + roi.height)}%`,
    width: `${Math.abs(roi.width)}%`,
    height: `${Math.abs(roi.height)}%`,
  }

  return (
    <main className="app-shell">
      <header className="clinical-header">
        <div className="brand-lockup"><div className="brand-mark" aria-hidden="true">D<span>•</span>S</div><div><p className="eyebrow">Clinical imaging workspace</p><h1>DermoSpectral <span>Tissue Optics Analyzer</span></h1></div></div>
        <div className="header-status"><i /> System ready <span>v0.1.0</span></div>
      </header>
      <div className="top-bench"><PresetCalibrationBench selectedId={selectedTarget?.id} onSelect={selectTarget} /></div>
      <div className="dashboard-grid">
        <section className="workspace-column" aria-label="Image workspace">
          <div className="section-heading"><div><p className="eyebrow">01 / Image workspace</p><h2>Load a tissue image</h2></div><div className="workspace-meta"><span className="status-dot" /> ROI tool active</div></div>
          <div ref={workspaceRef} className={`image-workspace ${imageUrl ? 'has-image' : ''} ${isCameraOpen ? 'camera-active' : ''}`} onPointerDown={startRoi} onPointerMove={updateRoi} onPointerUp={() => setIsDragging(false)} onPointerCancel={() => setIsDragging(false)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); loadFile(event.dataTransfer.files?.[0]) }}>
            {imageUrl && <img src={imageUrl} alt="Uploaded skin tissue" className="uploaded-image" />}
            {imageUrl && !isCameraOpen && <SpectralHeatmapViewer concentrationData={concentrationData} mode={activeMode === 'hemoglobin' ? 'Ch' : 'Cm'} opacity={heatmapOpacity} />}
            {isCameraOpen && <video ref={videoRef} className="camera-feed" autoPlay playsInline muted />}
            {!imageUrl && !isCameraOpen && <div className="dropzone-content"><div className="upload-orbit" aria-hidden="true"><span>↑</span></div><h3>Drop an image to begin</h3><p>or choose a high-resolution skin photograph</p><button type="button" className="primary-button" onClick={() => fileInputRef.current?.click()}><span>＋</span> Select image</button><p className="format-note">PNG, JPG or JPEG <b>·</b> up to 20 MB</p></div>}
            {isCameraOpen && <div className="camera-label"><i /> LIVE CAMERA</div>}
            {normalizedRoi && <div className="roi-box" style={normalizedRoi}><span>ROI</span></div>}
            {imageUrl && !isDragging && !roi && <div className="workspace-hint">Click and drag to define a region of interest</div>}
          </div>
          <div className="workspace-footer"><div className="file-status"><span className="file-icon">▧</span><div><b>{fileName}</b><small>{imageUrl ? 'Ready for analysis' : 'Awaiting image input'}</small></div></div><div className="workspace-actions"><input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" onChange={(event) => loadFile(event.target.files?.[0])} hidden /><button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()}>Import image</button><button type="button" className={`camera-button ${isCameraOpen ? 'active' : ''}`} onClick={toggleCamera}><span>◉</span>{isCameraOpen ? 'Close camera' : 'Live capture'}</button></div></div>
          <div className="overlay-controls"><label htmlFor="opacity-slider">Heatmap opacity <output>{heatmapOpacity}%</output></label><input id="opacity-slider" type="range" min="0" max="100" value={heatmapOpacity} onChange={(event) => setHeatmapOpacity(Number(event.target.value))} disabled={!imageUrl} /></div>
          {(cameraError || fileError) && <p className="inline-error" role="alert">{cameraError || fileError}</p>}
        </section>
        <aside className="calibration-panel" aria-label="Calibration controls"><div className="section-heading panel-heading"><div><p className="eyebrow">02 / Analysis setup</p><h2>Calibration</h2></div><span className="settings-icon">⌘</span></div><p className="panel-intro">Choose a reference mode to tune how tissue signals are interpreted.</p><div className="mode-list">{calibrationModes.map(([id, label, detail, icon]) => <button key={id} type="button" className={`mode-card ${activeMode === id ? 'selected' : ''}`} onClick={() => setActiveMode(id)} aria-pressed={activeMode === id}><span className="mode-icon">{icon}</span><span className="mode-copy"><b>{label}</b><small>{detail}</small></span><span className="radio-indicator" /></button>)}</div><div className="calibration-note"><span>✦</span><p><b>Tip</b> Include a neutral white reference in frame when available for more consistent results.</p></div><div className="panel-bottom"><div><span>Input color space</span><b>sRGB / 8-bit</b></div><div><span>Capture condition</span><b>Uncalibrated</b></div></div></aside>
      </div>
      <div className="lower-dashboard"><section className="metrics-card" aria-labelledby="metrics-title"><div className="bench-heading"><div><p className="eyebrow">04 / ROI readout</p><h2 id="metrics-title">Calibration metrics</h2></div><span className="metrics-status">{selectedTarget ? 'TARGET LOADED' : 'AWAITING TARGET'}</span></div><div className="metric-grid"><div className="metric"><span>Mean Melanin Index</span><strong>{selectedTarget ? selectedTarget.melanin.toFixed(2) : '—'}</strong><small>within selected ROI</small></div><div className="metric"><span>Mean Hemoglobin Perfusion</span><strong>{selectedTarget ? selectedTarget.hemoglobin.toFixed(2) : '—'}</strong><small>within selected ROI</small></div><div className="metric"><span>White-balance SNR</span><strong>{selectedTarget ? `${selectedTarget.snr.toFixed(1)} dB` : '—'}</strong><small>calibration signal quality</small></div></div></section></div>
      <footer className="app-footer"><span>DERMOSPECTRAL / RESEARCH PREVIEW</span><span>Privacy-first · Images stay in your browser</span></footer>
    </main>
  )
}

export default App
