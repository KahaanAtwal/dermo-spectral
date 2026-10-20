import { useEffect, useMemo, useRef, useState } from 'react'
import useTissueOptics from './hooks/useTissueOptics'
import './App.css'

const calibrationModes = [
  ['white-balance', 'White Balance Reference', 'Use bright neutral reference pixels for I0', '◌'],
  ['melanin', 'Melanin Map Mode', 'Prioritize epidermal melanin contrast', '◒'],
  ['hemoglobin', 'Hemoglobin / Perfusion Map Mode', 'Prioritize dermal blood perfusion contrast', '⌁'],
]

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg'])
const MAX_FILE_SIZE_MB = 20

function App() {
  const [imageUrl, setImageUrl] = useState(null)
  const [fileName, setFileName] = useState('No image loaded')
  const [activeMode, setActiveMode] = useState('white-balance')
  const [roi, setRoi] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [fileError, setFileError] = useState('')
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })

  const fileInputRef = useRef(null)
  const workspaceRef = useRef(null)
  const canvasRef = useRef(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const imageRef = useRef(null)
  const imageUrlRef = useRef(null)
  const drawBoundsRef = useRef(null)

  const { analysis, error: analysisError, analyzeRoi, clearAnalysis } = useTissueOptics()

  const selectedRoi = useMemo(() => {
    if (!roi) return null
    const x = Math.min(roi.startX, roi.startX + roi.width)
    const y = Math.min(roi.startY, roi.startY + roi.height)
    return {
      x,
      y,
      width: Math.abs(roi.width),
      height: Math.abs(roi.height),
    }
  }, [roi])

  const clearImage = () => {
    imageRef.current = null
    drawBoundsRef.current = null
    setRoi(null)
    clearAnalysis()
  }

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setIsCameraOpen(false)
  }

  const loadFile = (file) => {
    if (!file || !SUPPORTED_IMAGE_TYPES.has(file.type)) {
      setFileError('Choose a PNG, JPG, or JPEG image to continue.')
      return
    }

    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setFileError(`Image is too large. Please select a file below ${MAX_FILE_SIZE_MB} MB.`)
      return
    }

    if (imageUrlRef.current?.startsWith('blob:')) {
      URL.revokeObjectURL(imageUrlRef.current)
    }

    const nextImageUrl = URL.createObjectURL(file)
    imageUrlRef.current = nextImageUrl
    setImageUrl(nextImageUrl)
    setFileName(file.name)
    stopCamera()
    clearImage()
    setFileError('')
    setCameraError('')
  }

  const captureCameraFrame = () => {
    if (!videoRef.current || !videoRef.current.videoWidth || !videoRef.current.videoHeight) {
      setCameraError('Camera stream is not ready yet. Try again in a moment.')
      return
    }

    const frameCanvas = document.createElement('canvas')
    frameCanvas.width = videoRef.current.videoWidth
    frameCanvas.height = videoRef.current.videoHeight
    const frameContext = frameCanvas.getContext('2d')
    frameContext?.drawImage(videoRef.current, 0, 0, frameCanvas.width, frameCanvas.height)

    if (imageUrlRef.current?.startsWith('blob:')) {
      URL.revokeObjectURL(imageUrlRef.current)
    }

    const captureUrl = frameCanvas.toDataURL('image/jpeg', 0.95)
    imageUrlRef.current = captureUrl
    setImageUrl(captureUrl)
    setFileName(`camera-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`)
    clearImage()
    stopCamera()
    setCameraError('')
    setFileError('')
  }

  const getCanvasPoint = (event) => {
    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!bounds) return null
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    }
  }

  const startRoi = (event) => {
    if (!imageRef.current || isCameraOpen) return
    const point = getCanvasPoint(event)
    if (!point) return

    setRoi({ startX: point.x, startY: point.y, width: 0, height: 0 })
    setIsDragging(true)
    canvasRef.current?.setPointerCapture?.(event.pointerId)
  }

  const updateRoi = (event) => {
    if (!isDragging || !roi) return
    const point = getCanvasPoint(event)
    if (!point) return

    setRoi((current) =>
      current
        ? {
            ...current,
            width: point.x - current.startX,
            height: point.y - current.startY,
          }
        : current,
    )
  }

  const endRoi = () => {
    setIsDragging(false)
    setRoi((current) => {
      if (!current || Math.abs(current.width) < 2 || Math.abs(current.height) < 2) {
        clearAnalysis()
        return null
      }
      return current
    })
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
    if (!workspaceRef.current) return undefined

    const updateCanvasSize = () => {
      const bounds = workspaceRef.current?.getBoundingClientRect()
      if (!bounds) return
      setCanvasSize({ width: Math.floor(bounds.width), height: Math.floor(bounds.height) })
    }

    updateCanvasSize()
    const observer = new ResizeObserver(updateCanvasSize)
    observer.observe(workspaceRef.current)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!imageUrl) return undefined

    const image = new Image()
    image.onload = () => {
      imageRef.current = image
      drawBoundsRef.current = null
    }
    image.onerror = () => {
      imageRef.current = null
      setFileError('Unable to load image. Try a different file.')
    }
    image.src = imageUrl

    return undefined
  }, [imageUrl])

  useEffect(() => {
    if (!isCameraOpen || !videoRef.current || !streamRef.current) return
    videoRef.current.srcObject = streamRef.current
  }, [isCameraOpen])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !canvasSize.width || !canvasSize.height) return

    const context = canvas.getContext('2d')
    if (!context) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(canvasSize.width * dpr)
    canvas.height = Math.floor(canvasSize.height * dpr)
    context.setTransform(dpr, 0, 0, dpr, 0, 0)

    context.fillStyle = '#0f171c'
    context.fillRect(0, 0, canvasSize.width, canvasSize.height)

    if (imageRef.current) {
      const imageWidth = imageRef.current.naturalWidth || imageRef.current.width
      const imageHeight = imageRef.current.naturalHeight || imageRef.current.height
      const scale = Math.min(canvasSize.width / imageWidth, canvasSize.height / imageHeight)
      const drawWidth = imageWidth * scale
      const drawHeight = imageHeight * scale
      const x = (canvasSize.width - drawWidth) / 2
      const y = (canvasSize.height - drawHeight) / 2

      context.drawImage(imageRef.current, x, y, drawWidth, drawHeight)
      drawBoundsRef.current = { x, y, width: drawWidth, height: drawHeight }
    }

    if (selectedRoi?.width && selectedRoi.height) {
      context.strokeStyle = '#d8ff63'
      context.lineWidth = 1.5
      context.strokeRect(selectedRoi.x, selectedRoi.y, selectedRoi.width, selectedRoi.height)
      context.fillStyle = 'rgba(5, 13, 14, 0.35)'
      context.fillRect(0, 0, canvasSize.width, selectedRoi.y)
      context.fillRect(0, selectedRoi.y, selectedRoi.x, selectedRoi.height)
      context.fillRect(
        selectedRoi.x + selectedRoi.width,
        selectedRoi.y,
        canvasSize.width - (selectedRoi.x + selectedRoi.width),
        selectedRoi.height,
      )
      context.fillRect(0, selectedRoi.y + selectedRoi.height, canvasSize.width, canvasSize.height - (selectedRoi.y + selectedRoi.height))

      context.fillStyle = '#d8ff63'
      context.fillRect(selectedRoi.x, Math.max(0, selectedRoi.y - 18), 34, 16)
      context.fillStyle = '#172017'
      context.font = "10px 'DM Mono', monospace"
      context.fillText('ROI', selectedRoi.x + 6, Math.max(11, selectedRoi.y - 7))
    }
  }, [canvasSize, selectedRoi])

  useEffect(() => {
    if (!imageRef.current || !selectedRoi || !canvasRef.current || selectedRoi.width < 2 || selectedRoi.height < 2) {
      clearAnalysis()
      return
    }

    analyzeRoi({
      canvas: canvasRef.current,
      roi: selectedRoi,
      sourceBounds: drawBoundsRef.current,
      baselineMode: activeMode === 'white-balance' ? 'white-balance' : 'surrounding',
    })
  }, [activeMode, analyzeRoi, clearAnalysis, selectedRoi])

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      if (imageUrlRef.current?.startsWith('blob:')) {
        URL.revokeObjectURL(imageUrlRef.current)
      }
    },
    [],
  )

  return (
    <main className="app-shell">
      <header className="clinical-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            D<span>•</span>S
          </div>
          <div>
            <p className="eyebrow">Clinical imaging workspace</p>
            <h1>
              DermoSpectral <span>Tissue Optics Analyzer</span>
            </h1>
          </div>
        </div>
        <div className="header-status">
          <i /> System ready <span>v0.2.0</span>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="workspace-column" aria-label="Image workspace">
          <div className="section-heading">
            <div>
              <p className="eyebrow">01 / Image workspace</p>
              <h2>Load a tissue image</h2>
            </div>
            <div className="workspace-meta">
              <span className="status-dot" /> ROI tool active
            </div>
          </div>

          <div
            ref={workspaceRef}
            className={`image-workspace ${imageUrl ? 'has-image' : ''} ${isCameraOpen ? 'camera-active' : ''}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              loadFile(event.dataTransfer.files?.[0])
            }}
          >
            <canvas
              ref={canvasRef}
              className="analysis-canvas"
              onPointerDown={startRoi}
              onPointerMove={updateRoi}
              onPointerUp={endRoi}
              onPointerCancel={endRoi}
              aria-label="Tissue image canvas for region of interest selection"
            />

            {isCameraOpen && <video ref={videoRef} className="camera-feed" autoPlay playsInline muted />}

            {!imageUrl && !isCameraOpen && (
              <div className="dropzone-content" role="region" aria-label="Image upload dropzone">
                <div className="upload-orbit" aria-hidden="true">
                  <span>↑</span>
                </div>
                <h3>Drop an image to begin</h3>
                <p>or choose a high-resolution skin photograph</p>
                <button type="button" className="primary-button" onClick={() => fileInputRef.current?.click()}>
                  <span>＋</span> Select image
                </button>
                <p className="format-note">
                  PNG, JPG or JPEG <b>·</b> up to {MAX_FILE_SIZE_MB} MB
                </p>
              </div>
            )}

            {isCameraOpen && (
              <>
                <div className="camera-label">
                  <i /> LIVE CAMERA
                </div>
                <button type="button" className="camera-capture-button" onClick={captureCameraFrame}>
                  Capture frame for ROI
                </button>
              </>
            )}

            {imageUrl && !isDragging && !selectedRoi && (
              <div className="workspace-hint">Click and drag on the canvas to define a region of interest</div>
            )}
          </div>

          <div className="workspace-footer">
            <div className="file-status">
              <span className="file-icon">▧</span>
              <div>
                <b>{fileName}</b>
                <small>{imageUrl ? 'Ready for analysis' : 'Awaiting image input'}</small>
              </div>
            </div>

            <div className="workspace-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                onChange={(event) => loadFile(event.target.files?.[0])}
                hidden
              />
              <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()}>
                Import image
              </button>
              <button type="button" className={`camera-button ${isCameraOpen ? 'active' : ''}`} onClick={toggleCamera}>
                <span>◉</span>
                {isCameraOpen ? 'Close camera' : 'Live capture'}
              </button>
            </div>
          </div>

          {(cameraError || fileError || analysisError) && (
            <p className="inline-error" role="alert">
              {cameraError || fileError || analysisError}
            </p>
          )}

          {analysis && (
            <div className="analysis-results" aria-live="polite">
              <div>
                <span>ROI pixels</span>
                <b>
                  {analysis.width} × {analysis.height}
                </b>
              </div>
              <div>
                <span>Melanin (Cm)</span>
                <b>{analysis.summary.meanCm.toFixed(3)}</b>
              </div>
              <div>
                <span>Hemoglobin (Ch)</span>
                <b>{analysis.summary.meanCh.toFixed(3)}</b>
              </div>
              <div>
                <span>I0 baseline RGB</span>
                <b>
                  {analysis.baseline.r.toFixed(1)} / {analysis.baseline.g.toFixed(1)} / {analysis.baseline.b.toFixed(1)}
                </b>
              </div>
            </div>
          )}
        </section>

        <aside className="calibration-panel" aria-label="Calibration controls">
          <div className="section-heading panel-heading">
            <div>
              <p className="eyebrow">02 / Analysis setup</p>
              <h2>Calibration</h2>
            </div>
            <span className="settings-icon">⌘</span>
          </div>

          <p className="panel-intro">Choose a reference mode to tune how tissue signals are interpreted.</p>

          <div className="mode-list">
            {calibrationModes.map(([id, label, detail, icon]) => (
              <button
                key={id}
                type="button"
                className={`mode-card ${activeMode === id ? 'selected' : ''}`}
                onClick={() => setActiveMode(id)}
                aria-pressed={activeMode === id}
              >
                <span className="mode-icon">{icon}</span>
                <span className="mode-copy">
                  <b>{label}</b>
                  <small>{detail}</small>
                </span>
                <span className="radio-indicator" />
              </button>
            ))}
          </div>

          <div className="calibration-note">
            <span>✦</span>
            <p>
              <b>Tip</b> White Balance mode derives I0 from brightest neutral pixels in ROI; other modes derive I0 from
              nearby surrounding skin.
            </p>
          </div>

          <div className="panel-bottom">
            <div>
              <span>Input color space</span>
              <b>sRGB / 8-bit</b>
            </div>
            <div>
              <span>Optics model</span>
              <b>RGB absorbance approximation</b>
            </div>
          </div>
        </aside>
      </div>

      <footer className="app-footer">
        <span>DERMOSPECTRAL / RESEARCH PREVIEW</span>
        <span>Privacy-first · Images stay in your browser</span>
      </footer>
    </main>
  )
}

export default App
