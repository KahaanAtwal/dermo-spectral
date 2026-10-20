import { useEffect, useMemo, useRef, useState } from 'react'
import useTissueOptics from './hooks/useTissueOptics'

const calibrationModes = [
  ['white-balance', 'White Balance Reference', 'Use bright neutral reference pixels for I0', '◌'],
  ['melanin', 'Melanin Map Mode', 'Prioritize epidermal melanin contrast', '◒'],
  ['hemoglobin', 'Hemoglobin/Perfusion Map Mode', 'Prioritize dermal blood perfusion contrast', '⌁'],
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
    return { x, y, width: Math.abs(roi.width), height: Math.abs(roi.height) }
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

    setRoi((current) => (current ? { ...current, width: point.x - current.startX, height: point.y - current.startY } : current))
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

    context.fillStyle = '#0f1720'
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
      context.strokeStyle = '#a3e635'
      context.lineWidth = 1.5
      context.strokeRect(selectedRoi.x, selectedRoi.y, selectedRoi.width, selectedRoi.height)
      context.fillStyle = 'rgba(2, 6, 23, 0.42)'
      context.fillRect(0, 0, canvasSize.width, selectedRoi.y)
      context.fillRect(0, selectedRoi.y, selectedRoi.x, selectedRoi.height)
      context.fillRect(selectedRoi.x + selectedRoi.width, selectedRoi.y, canvasSize.width - (selectedRoi.x + selectedRoi.width), selectedRoi.height)
      context.fillRect(0, selectedRoi.y + selectedRoi.height, canvasSize.width, canvasSize.height - (selectedRoi.y + selectedRoi.height))
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
    <main className="min-h-screen bg-slate-950 text-slate-100 antialiased">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-10">
        <header className="mb-8 flex flex-col gap-4 border-b border-slate-800 pb-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-12 w-12 place-items-center rounded border border-lime-300/35 bg-slate-900 text-sm font-semibold tracking-tight text-lime-300">
              DS
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Clinical imaging workspace</p>
              <h1 className="text-lg font-semibold sm:text-xl">DermoSpectral Tissue Optics Analyzer</h1>
            </div>
          </div>
          <p className="inline-flex items-center gap-2 text-xs text-slate-300">
            <span className="h-2 w-2 rounded-full bg-lime-300 shadow-[0_0_16px_rgba(163,230,53,0.75)]" />
            System ready
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-label="Image workspace">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">01 / Image workspace</p>
                <h2 className="text-2xl font-medium text-slate-100">Load a tissue image</h2>
              </div>
              <p className="hidden items-center gap-2 text-xs text-slate-300 sm:inline-flex">
                <span className="h-2 w-2 rounded-full bg-lime-300" /> ROI tool active
              </p>
            </div>

            <div
              ref={workspaceRef}
              className="relative min-h-[380px] overflow-hidden rounded-xl border border-slate-700 bg-gradient-to-br from-slate-900 via-slate-950 to-emerald-950/40"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                loadFile(event.dataTransfer.files?.[0])
              }}
            >
              <canvas
                ref={canvasRef}
                className="absolute inset-0 z-10 h-full w-full cursor-crosshair touch-none"
                onPointerDown={startRoi}
                onPointerMove={updateRoi}
                onPointerUp={endRoi}
                onPointerCancel={endRoi}
                aria-label="Tissue image canvas for region of interest selection"
              />

              {isCameraOpen && <video ref={videoRef} className="absolute inset-0 z-20 h-full w-full object-cover [transform:scaleX(-1)]" autoPlay playsInline muted />}

              {!imageUrl && !isCameraOpen && (
                <div role="region" aria-label="Image upload dropzone" className="absolute inset-0 z-20 flex flex-col items-center justify-center px-6 text-center">
                  <div className="mb-5 grid h-16 w-16 place-items-center rounded-full border border-dashed border-slate-400 text-2xl text-lime-300">↑</div>
                  <h3 className="text-lg font-medium text-slate-100">Drop an image to begin</h3>
                  <p className="mt-1 text-sm text-slate-400">or choose a high-resolution skin photograph</p>
                  <button
                    type="button"
                    className="mt-5 inline-flex items-center gap-2 rounded-md bg-lime-300 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-lime-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <span className="text-base leading-none">＋</span>
                    Select image
                  </button>
                  <p className="mt-3 text-xs text-slate-500">PNG, JPG, JPEG · up to {MAX_FILE_SIZE_MB} MB</p>
                </div>
              )}

              {isCameraOpen && (
                <>
                  <p className="absolute left-3 top-3 z-30 inline-flex items-center gap-2 rounded bg-slate-900/85 px-2.5 py-1 text-[11px] tracking-wide text-lime-300">
                    <span className="h-2 w-2 rounded-full bg-rose-400" /> LIVE CAMERA
                  </p>
                  <button
                    type="button"
                    className="absolute bottom-3 right-3 z-30 rounded-md bg-lime-300 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-lime-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300"
                    onClick={captureCameraFrame}
                  >
                    Capture frame for ROI
                  </button>
                </>
              )}

              {imageUrl && !isDragging && !selectedRoi && (
                <p className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded bg-slate-900/80 px-2.5 py-1.5 text-[11px] text-slate-300">
                  Click and drag on the canvas to define a region of interest
                </p>
              )}
            </div>

            <div className="mt-4 flex flex-col gap-4 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded border border-cyan-400/40 text-cyan-300">▧</span>
                <div>
                  <p className="max-w-[18rem] truncate text-sm font-medium text-slate-200">{fileName}</p>
                  <p className="text-xs text-slate-400">{imageUrl ? 'Ready for analysis' : 'Awaiting image input'}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                  onChange={(event) => loadFile(event.target.files?.[0])}
                  hidden
                />
                <button
                  type="button"
                  className="rounded-md border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-300 hover:text-cyan-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Import image
                </button>
                <button
                  type="button"
                  className={`rounded-md px-3 py-2 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${
                    isCameraOpen ? 'bg-rose-900/50 text-rose-200 hover:bg-rose-800/60' : 'bg-emerald-900/60 text-emerald-200 hover:bg-emerald-800/60'
                  }`}
                  onClick={toggleCamera}
                >
                  ◉ {isCameraOpen ? 'Close camera' : 'Live capture'}
                </button>
              </div>
            </div>

            {(cameraError || fileError || analysisError) && <p className="mt-3 text-sm text-rose-300">{cameraError || fileError || analysisError}</p>}

            {analysis && (
              <dl className="mt-4 grid grid-cols-1 gap-2 rounded-lg border border-slate-700 bg-slate-900/45 p-4 sm:grid-cols-2" aria-live="polite">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400">ROI pixels</dt>
                  <dd className="font-mono text-sm text-slate-100">
                    {analysis.width} × {analysis.height}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400">Melanin (Cm)</dt>
                  <dd className="font-mono text-sm text-slate-100">{analysis.summary.meanCm.toFixed(3)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400">Hemoglobin (Ch)</dt>
                  <dd className="font-mono text-sm text-slate-100">{analysis.summary.meanCh.toFixed(3)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400">I0 baseline RGB</dt>
                  <dd className="font-mono text-sm text-slate-100">
                    {analysis.baseline.r.toFixed(1)} / {analysis.baseline.g.toFixed(1)} / {analysis.baseline.b.toFixed(1)}
                  </dd>
                </div>
              </dl>
            )}
          </section>

          <aside className="rounded-xl border border-slate-700 bg-slate-900/55 p-5" aria-label="Calibration controls">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">02 / Analysis setup</p>
                <h2 className="text-xl font-medium">Calibration</h2>
              </div>
              <span className="text-slate-500">⌘</span>
            </div>

            <p className="mb-4 text-sm text-slate-400">Choose a reference mode to tune how tissue signals are interpreted.</p>

            <div className="space-y-2">
              {calibrationModes.map(([id, label, detail, icon]) => (
                <button
                  key={id}
                  type="button"
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300 ${
                    activeMode === id
                      ? 'border-lime-300/70 bg-emerald-950/40 shadow-[inset_3px_0_0_0_rgba(190,242,100,1)]'
                      : 'border-slate-700 bg-slate-900 hover:border-slate-500'
                  }`}
                  onClick={() => setActiveMode(id)}
                  aria-pressed={activeMode === id}
                >
                  <span className="w-5 text-lg text-cyan-300">{icon}</span>
                  <span className="flex flex-1 flex-col">
                    <span className="text-sm font-semibold text-slate-100">{label}</span>
                    <span className="text-xs text-slate-400">{detail}</span>
                  </span>
                  <span className={`h-3 w-3 rounded-full border ${activeMode === id ? 'border-lime-300 bg-lime-300' : 'border-slate-500'}`} />
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-md bg-emerald-950/30 p-3 text-xs text-slate-300">
              <p>
                <span className="mr-1 text-lime-300">✦</span>
                White Balance mode derives I0 from bright neutral ROI pixels; other modes derive I0 from surrounding skin.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}

export default App
