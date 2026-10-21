import { useEffect, useRef } from 'react'

const TARGETS = [
  { id: 'hyperpigmentation', label: 'Hyperpigmentation Spot', shortLabel: 'Target A', detail: 'Dark freckle / nevus', melanin: 0.84, hemoglobin: 0.28, snr: 40.2 },
  { id: 'erythema', label: 'Local Erythema', shortLabel: 'Target B', detail: 'Flushed inflammation patch', melanin: 0.38, hemoglobin: 0.81, snr: 38.6 },
  { id: 'baseline', label: 'Uniform Skin Baseline Calibration', shortLabel: 'Target C', detail: 'Homogeneous skin-tone block', melanin: 0.28, hemoglobin: 0.31, snr: 42.8 },
]
const drawTarget = (context, target, width = 720, height = 460) => {
  context.fillStyle = '#d9a47d'; context.fillRect(0, 0, width, height)
  const glow = context.createRadialGradient(width / 2, height / 2, 20, width / 2, height / 2, width * 0.75)
  glow.addColorStop(0, 'rgba(255, 222, 187, .3)'); glow.addColorStop(1, 'rgba(126, 66, 53, .18)'); context.fillStyle = glow; context.fillRect(0, 0, width, height)
  if (target.id === 'hyperpigmentation') { context.fillStyle = 'rgba(65, 27, 25, .78)'; context.beginPath(); context.ellipse(width * .53, height * .5, 84, 66, -.2, 0, Math.PI * 2); context.fill() }
  if (target.id === 'erythema') { const patch = context.createRadialGradient(width / 2, height / 2, 16, width / 2, height / 2, 150); patch.addColorStop(0, 'rgba(224, 46, 44, .78)'); patch.addColorStop(1, 'rgba(196, 59, 46, 0)'); context.fillStyle = patch; context.fillRect(width * .22, height * .12, width * .56, height * .76) }
}
const makeConcentration = (target) => {
  const width = 64; const height = 44; const values = []
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const distance = Math.sqrt(((x - 32) / 15) ** 2 + ((y - 22) / 11) ** 2); const feature = target.id === 'hyperpigmentation' ? Math.max(0, 1 - distance) * .68 : target.id === 'erythema' ? Math.max(0, 1 - distance / 1.6) * .52 : 0; values.push(Math.max(0, Math.min(1, .16 + feature + Math.sin(x * 2.3 + y) * .012))) }
  return { width, height, values }
}
export default function PresetCalibrationBench({ selectedId, onSelect }) {
  const previews = useRef({})
  useEffect(() => { TARGETS.forEach((target) => { const canvas = previews.current[target.id]; if (canvas) drawTarget(canvas.getContext('2d'), target) }) }, [])
  const selectTarget = (target) => { const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 460; drawTarget(canvas.getContext('2d'), target); onSelect({ ...target, dataUrl: canvas.toDataURL('image/png'), concentrationData: makeConcentration(target) }) }
  return <section className="calibration-bench" aria-labelledby="bench-title"><div className="bench-heading"><div><p className="eyebrow">03 / Synthetic controls</p><h2 id="bench-title">Preset calibration bench</h2></div><span className="bench-note">Canvas-generated test targets</span></div><div className="target-list">{TARGETS.map((target) => <button type="button" className={`target-card ${selectedId === target.id ? 'selected' : ''}`} key={target.id} onClick={() => selectTarget(target)} aria-pressed={selectedId === target.id}><canvas ref={(element) => { previews.current[target.id] = element }} width="720" height="460" className="target-preview" /><span className="target-copy"><b>{target.shortLabel}</b><em>{target.label}</em><small>{target.detail}</small></span><span className="target-check">{selectedId === target.id ? '✓' : '＋'}</span></button>)}</div></section>
}
export { TARGETS, makeConcentration }
