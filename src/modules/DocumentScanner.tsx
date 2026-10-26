import { useMemo, useRef, useState, type PointerEvent } from 'react'
import {
  AlertTriangle,
  Check,
  Download,
  FileImage,
  Lock,
  RotateCcw,
  ScanLine,
  Upload,
} from 'lucide-react'
import { Dropzone } from '../components/Dropzone'
import { SliderField } from '../components/Controls'
import {
  adjustImage,
  cropToCorners,
  detectDocumentCorners,
  loadImageToCanvas,
  type EdgePoints,
  type ScannerControls,
} from '../lib/documentScanner'
import { downloadBlob, errorMessage, sanitizeBaseName } from '../lib/format'

interface ScanState {
  original: HTMLCanvasElement
  processed?: HTMLCanvasElement
  filename: string
  corners: EdgePoints
  autoDetected: boolean
  controls: ScannerControls
  mode: 'adjust' | 'preview'
}

const DEFAULT_CONTROLS: ScannerControls = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  filter: 'color',
}

const CORNER_LABELS: Record<keyof EdgePoints, string> = {
  topLeft: 'Pojok kiri atas',
  topRight: 'Pojok kanan atas',
  bottomLeft: 'Pojok kiri bawah',
  bottomRight: 'Pojok kanan bawah',
}

const SIDE_HANDLES = [
  { label: 'Sisi atas', points: ['topLeft', 'topRight'] },
  { label: 'Sisi kanan', points: ['topRight', 'bottomRight'] },
  { label: 'Sisi bawah', points: ['bottomLeft', 'bottomRight'] },
  { label: 'Sisi kiri', points: ['topLeft', 'bottomLeft'] },
] as const satisfies ReadonlyArray<{
  label: string
  points: readonly [keyof EdgePoints, keyof EdgePoints]
}>

type DragTarget =
  | { kind: 'corner'; key: keyof EdgePoints; startCorners: EdgePoints }
  | {
      kind: 'side'
      points: readonly [keyof EdgePoints, keyof EdgePoints]
      startPointer: [number, number]
      startCorners: EdgePoints
    }

function DocumentPreview({
  canvas,
  corners,
  onCornersChange,
}: {
  canvas: HTMLCanvasElement
  corners: EdgePoints
  onCornersChange: (corners: EdgePoints) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragTargetRef = useRef<DragTarget | null>(null)
  const maxWidth = Math.max(1, Math.min(680, window.innerWidth - 64))
  const scale = Math.min(1, maxWidth / canvas.width, 540 / canvas.height)
  const width = Math.max(1, Math.round(canvas.width * scale))
  const height = Math.max(1, Math.round(canvas.height * scale))
  const orderedCorners = [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ]

  function moveCorner(event: PointerEvent<HTMLDivElement>) {
    const dragTarget = dragTargetRef.current
    const container = containerRef.current
    if (!dragTarget || !container) return
    const rect = container.getBoundingClientRect()
    const x = Math.max(0, Math.min(canvas.width, ((event.clientX - rect.left) / rect.width) * canvas.width))
    const y = Math.max(0, Math.min(canvas.height, ((event.clientY - rect.top) / rect.height) * canvas.height))
    if (dragTarget.kind === 'corner') {
      onCornersChange({
        ...dragTarget.startCorners,
        [dragTarget.key]: [x, y],
      })
      return
    }

    const deltaX = x - dragTarget.startPointer[0]
    const deltaY = y - dragTarget.startPointer[1]
    const nextCorners = { ...dragTarget.startCorners }
    for (const key of dragTarget.points) {
      const [startX, startY] = dragTarget.startCorners[key]
      nextCorners[key] = [
        Math.max(0, Math.min(canvas.width, startX + deltaX)),
        Math.max(0, Math.min(canvas.height, startY + deltaY)),
      ]
    }
    onCornersChange(nextCorners)
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, target: DragTarget) {
    event.preventDefault()
    event.stopPropagation()
    dragTargetRef.current = target
    containerRef.current?.setPointerCapture(event.pointerId)
  }

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative mx-auto touch-none select-none overflow-hidden rounded-lg border border-white/10 bg-ink-900"
        style={{ width, height }}
        onPointerMove={moveCorner}
        onPointerUp={(event) => {
          dragTargetRef.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onPointerCancel={() => {
          dragTargetRef.current = null
        }}
      >
        <canvas
          width={canvas.width}
          height={canvas.height}
          className="block h-full w-full"
          ref={(element) => {
            if (!element) return
            const context = element.getContext('2d')
            context?.drawImage(canvas, 0, 0)
          }}
        />
        <svg
          viewBox={`0 0 ${canvas.width} ${canvas.height}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          <polygon
            points={orderedCorners
              .map(([x, y]) => `${x},${y}`)
              .join(',')}
            fill="rgba(94,234,212,.12)"
            stroke="rgb(94,234,212)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {SIDE_HANDLES.map(({ label, points }) => {
          const first = corners[points[0]]
          const second = corners[points[1]]
          const x = (first[0] + second[0]) / 2
          const y = (first[1] + second[1]) / 2
          const isHorizontal =
            (points[0] === 'topLeft' && points[1] === 'topRight') ||
            (points[0] === 'bottomLeft' && points[1] === 'bottomRight')
          return (
            <button
              key={label}
              type="button"
              aria-label={`Geser ${label.toLowerCase()}`}
              title={`Geser ${label.toLowerCase()}`}
              className={`absolute z-10 touch-none rounded-full border-2 border-ink-950 bg-accent shadow-[0_0_0_1px_rgba(94,234,212,.8)] ${
                isHorizontal ? 'h-3 w-10 -translate-x-1/2 -translate-y-1/2' : 'h-10 w-3 -translate-x-1/2 -translate-y-1/2'
              }`}
              style={{ left: `${(x / canvas.width) * 100}%`, top: `${(y / canvas.height) * 100}%` }}
              onPointerDown={(event) =>
                startDrag(event, {
                  kind: 'side',
                  points,
                  startPointer: [x, y],
                  startCorners: corners,
                })
              }
            />
          )
        })}
        {(Object.keys(corners) as Array<keyof EdgePoints>).map((key) => {
          const [x, y] = corners[key]
          return (
            <button
              key={key}
              type="button"
              aria-label={CORNER_LABELS[key]}
              title={CORNER_LABELS[key]}
              className="absolute z-10 grid size-8 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center rounded-full border-2 border-accent bg-ink-950/80 shadow-lg"
              style={{ left: `${(x / canvas.width) * 100}%`, top: `${(y / canvas.height) * 100}%` }}
              onPointerDown={(event) =>
                startDrag(event, { kind: 'corner', key, startCorners: corners })
              }
            >
              <span className="size-2 rounded-full bg-accent" />
            </button>
          )
        })}
      </div>
      <p className="text-center text-[10px] text-ink-500">
        Geser titik sudut atau pegangan di tengah sisi untuk menyesuaikan batas dokumen.
      </p>
    </div>
  )
}

function ControlsPanel({
  controls,
  onControlChange,
  onReset,
}: {
  controls: ScannerControls
  onControlChange: (controls: ScannerControls) => void
  onReset: () => void
}) {
  return (
    <section className="panel space-y-4 p-4">
      <h2 className="text-[12.5px] font-semibold text-white">Penyesuaian gambar</h2>
      <SliderField
        label="Kecerahan"
        value={controls.brightness}
        min={-100}
        max={100}
        step={5}
        display={`${controls.brightness}`}
        onChange={(brightness) => onControlChange({ ...controls, brightness })}
      />
      <SliderField
        label="Kontras"
        value={controls.contrast}
        min={-100}
        max={100}
        step={5}
        display={`${controls.contrast}`}
        onChange={(contrast) => onControlChange({ ...controls, contrast })}
      />
      <SliderField
        label="Saturasi"
        value={controls.saturation}
        min={-100}
        max={100}
        step={5}
        display={`${controls.saturation}`}
        onChange={(saturation) => onControlChange({ ...controls, saturation })}
      />
      <div className="space-y-2">
        <span className="eyebrow">Filter</span>
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/[0.07] bg-ink-950/60 p-1">
          {[
            { value: 'color' as const, label: 'Warna' },
            { value: 'grayscale' as const, label: 'Abu-abu' },
            { value: 'document' as const, label: 'Dokumen' },
          ].map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={controls.filter === filter.value}
              onClick={() => onControlChange({ ...controls, filter: filter.value })}
              className={`rounded-lg px-1 py-2 text-[10px] font-medium transition ${
                controls.filter === filter.value
                  ? 'bg-white/[0.075] text-white'
                  : 'text-ink-400 hover:bg-white/[0.03] hover:text-ink-200'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>
      <button type="button" className="btn-ghost w-full" onClick={onReset}>
        <RotateCcw size={12} />
        Atur ulang
      </button>
    </section>
  )
}

export function DocumentScanner() {
  const [scan, setScan] = useState<ScanState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const original = scan?.original
  const controls = scan?.controls

  const adjustedCanvas = useMemo(
    () => (original && controls ? adjustImage(original, controls) : null),
    [original, controls],
  )

  async function handleFiles(files: File[]) {
    const file = files[0]
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const original = await loadImageToCanvas(file)
      const detection = detectDocumentCorners(original)
      setScan({
        original,
        filename: file.name,
        corners: detection.corners,
        autoDetected: detection.detected,
        controls: DEFAULT_CONTROLS,
        mode: 'adjust',
      })
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setBusy(false)
    }
  }

  function detectAgain() {
    if (!scan) return
    try {
      const detection = detectDocumentCorners(scan.original)
      setScan({ ...scan, corners: detection.corners, autoDetected: detection.detected })
      setError(
        detection.detected
          ? null
          : 'Sudut kertas belum terdeteksi dengan yakin. Coba foto dengan latar yang kontras, atau atur titik secara manual.',
      )
    } catch (detectionError) {
      setError(errorMessage(detectionError))
    }
  }

  function handleApply() {
    if (!scan || !adjustedCanvas) return
    try {
      const processed = cropToCorners(adjustedCanvas, scan.corners)
      setScan({ ...scan, processed, mode: 'preview' })
      setError(null)
    } catch (processError) {
      setError(errorMessage(processError))
    }
  }

  function handleDownload() {
    if (!scan?.processed) return
    scan.processed.toBlob((blob) => {
      if (!blob) {
        setError('Gambar hasil tidak bisa disimpan. Coba kurangi ukuran gambar.')
        return
      }
      downloadBlob(blob, `${sanitizeBaseName(scan.filename)}-scan.png`)
    }, 'image/png')
  }

  function resetScan() {
    setScan(null)
    setError(null)
  }

  return (
    <div className="animate-fade-up space-y-5">
      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/[0.06] px-3.5 py-2.5 text-[11.5px] text-danger">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {!scan ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="panel bg-noise relative overflow-hidden p-2">
            <div className="pointer-events-none absolute inset-0 grid-lines opacity-30" />
            <div className="relative">
              <Dropzone
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                icon={ScanLine}
                title="Pindai dokumen"
                subtitle="Ambil foto dengan kamera atau pilih gambar dari perangkat"
                hint="JPG, PNG, WebP · pemrosesan dilakukan di perangkat"
                busy={busy}
                onFiles={(files) => void handleFiles(files)}
              />
            </div>
          </div>
          <aside className="panel space-y-4 p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/[0.08] text-accent">
                <FileImage size={17} />
              </span>
              <div>
                <h2 className="text-[13px] font-semibold text-white">Pemindai dokumen</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
                  Rapikan foto dokumen dengan koreksi perspektif dan penyesuaian gambar.
                </p>
              </div>
            </div>
            <ol className="space-y-2.5 text-[10.5px] text-ink-400">
              <li>1. Ambil foto atau pilih gambar dokumen.</li>
              <li>2. Geser empat titik ke sudut dokumen.</li>
              <li>3. Sesuaikan kecerahan, kontras, dan saturasi.</li>
              <li>4. Terapkan koreksi dan simpan hasil PNG.</li>
            </ol>
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.055] bg-white/[0.02] px-3 py-2">
              <Lock size={12} className="text-accent/80" />
              <p className="text-[10px] text-ink-500">Gambar tidak diunggah ke server.</p>
            </div>
          </aside>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="panel min-w-0 space-y-4 p-4">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <ScanLine size={14} className="shrink-0 text-accent" />
                <h2 className="truncate text-[12px] font-semibold text-white">
                  {scan.mode === 'adjust' ? 'Atur batas dokumen' : 'Hasil pemindaian'}
                </h2>
              </div>
              {scan.mode === 'adjust' ? (
                <span
                  className={`text-[10px] ${
                    scan.autoDetected ? 'text-accent' : 'text-warn'
                  }`}
                >
                  {scan.autoDetected ? 'Sudut terdeteksi' : 'Atur sudut manual'}
                </span>
              ) : null}
              <button type="button" className="btn-ghost !px-2.5 !py-1.5 !text-[10px]" onClick={resetScan}>
                <RotateCcw size={11} />
                Pilih gambar lain
              </button>
            </header>
            {scan.mode === 'adjust' && adjustedCanvas ? (
              <>
                <DocumentPreview
                  canvas={adjustedCanvas}
                  corners={scan.corners}
                  onCornersChange={(corners) => setScan({ ...scan, corners })}
                />
                <button
                  type="button"
                  className="btn-ghost w-full"
                  onClick={detectAgain}
                >
                  <ScanLine size={12} />
                  Deteksi ulang sudut
                </button>
                <button type="button" className="btn-primary w-full" onClick={handleApply}>
                  <Check size={14} />
                  Terapkan koreksi
                </button>
              </>
            ) : scan.processed ? (
              <>
                <div className="checkerboard grid max-h-[70vh] min-h-40 place-items-center overflow-auto rounded-lg p-2">
                  <canvas
                    width={scan.processed.width}
                    height={scan.processed.height}
                    className="h-auto max-h-[65vh] w-auto max-w-full object-contain"
                    ref={(element) => {
                      if (!element) return
                      element.getContext('2d')?.drawImage(scan.processed!, 0, 0)
                    }}
                  />
                </div>
                <p className="text-center font-mono text-[10px] text-ink-500">
                  {scan.processed.width} × {scan.processed.height} px
                </p>
              </>
            ) : null}
          </section>

          <aside className="space-y-4">
            {scan.mode === 'adjust' ? (
              <ControlsPanel
                controls={scan.controls}
                onControlChange={(controls) => setScan({ ...scan, controls })}
                onReset={() => setScan({ ...scan, controls: DEFAULT_CONTROLS })}
              />
            ) : (
              <section className="panel space-y-3 p-4">
                <button type="button" className="btn-primary w-full" onClick={handleDownload}>
                  <Download size={13} />
                  Simpan sebagai PNG
                </button>
                <button
                  type="button"
                  className="btn-ghost w-full"
                  onClick={() => setScan({ ...scan, mode: 'adjust', processed: undefined })}
                >
                  <Upload size={12} />
                  Kembali mengatur
                </button>
              </section>
            )}
            <div className="rounded-lg border border-white/[0.055] bg-white/[0.02] px-3 py-2.5 text-[10px] leading-relaxed text-ink-500">
              Pemindaian berjalan lokal. Hasil disimpan sebagai PNG.
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
