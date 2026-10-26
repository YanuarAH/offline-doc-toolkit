import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileImage,
  FilePlus2,
  Lock,
  RotateCcw,
  ScanLine,
  Trash2,
  Upload,
} from 'lucide-react'
import { Quadscan, type CornerPoints } from 'quadscan'
import quadscanModelUrl from 'quadscan/models/lcnet?url'
import { Dropzone } from '../components/Dropzone'
import { SliderField } from '../components/Controls'
import {
  adjustImage,
  cropToCorners,
  createFallbackDocumentCorners,
  loadImageToCanvas,
  type EdgePoints,
  type ScannerControls,
} from '../lib/documentScanner'
import { buildScannedPagesPdf } from '../lib/imagesToPdf'
import {
  compactDay,
  downloadBlob,
  errorMessage,
} from '../lib/format'

interface ScanPage {
  original: HTMLCanvasElement
  processed?: HTMLCanvasElement
  filename: string
  corners: EdgePoints
  autoDetected: boolean
  detectionMessage: string | null
  controls: ScannerControls
  mode: 'adjust' | 'preview'
}

interface QuadscanDetection {
  message: string
  corners: EdgePoints | null
}

const DEFAULT_CONTROLS: ScannerControls = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  filter: 'auto',
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

function quadscanCornersToEdgePoints(corners: CornerPoints): EdgePoints {
  return {
    topLeft: [corners.topLeft.x, corners.topLeft.y],
    topRight: [corners.topRight.x, corners.topRight.y],
    bottomRight: [corners.bottomRight.x, corners.bottomRight.y],
    bottomLeft: [corners.bottomLeft.x, corners.bottomLeft.y],
  }
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
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
    const preview = canvasRef.current
    if (!dragTarget || !preview) return
    const rect = preview.getBoundingClientRect()
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
            canvasRef.current = element
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
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-ink-500">
        <p>Geser titik sudut atau pegangan di tengah sisi untuk menyesuaikan batas dokumen.</p>
      </div>
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
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/[0.07] bg-ink-950/60 p-1">
          {[
            { value: 'auto' as const, label: 'Otomatis' },
            { value: 'color' as const, label: 'Asli' },
            { value: 'enhanced' as const, label: 'Warna cerah' },
            { value: 'grayscale' as const, label: 'Abu-abu' },
            { value: 'document' as const, label: 'Hitam-putih' },
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
  const [pages, setPages] = useState<ScanPage[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [busyMessage, setBusyMessage] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const quadscanRef = useRef<Quadscan | null>(null)
  const scan = pages[activeIndex] ?? null
  const original = scan?.original
  const controls = scan?.controls

  const adjustedCanvas = useMemo(
    () => (original && controls ? adjustImage(original, controls) : null),
    [original, controls],
  )

  useEffect(
    () => () => {
      requestIdRef.current += 1
      quadscanRef.current?.dispose()
      quadscanRef.current = null
    },
    [],
  )

  async function runQuadscanDetection(
    source: HTMLCanvasElement,
  ): Promise<QuadscanDetection> {
    try {
      const quadscan =
        quadscanRef.current ??
        new Quadscan({
          modelUrl: quadscanModelUrl,
          wasmPaths: `${import.meta.env.BASE_URL}ort/`,
          executionProviders: ['wasm'],
        })
      quadscanRef.current = quadscan
      const result = await quadscan.scan(source, {
        mode: 'detect',
        minDetectionConfidence: 0,
      })
      return {
        message: result.corners ? '' : 'Quadscan tidak memberikan koordinat sudut.',
        corners: result.corners ? quadscanCornersToEdgePoints(result.corners) : null,
      }
    } catch (detectionError) {
      return {
        message: `Deteksi otomatis Quadscan gagal: ${errorMessage(detectionError)}`,
        corners: null,
      }
    }
  }

  async function handleFiles(files: File[]) {
    if (files.length === 0) return
    const requestId = ++requestIdRef.current
    setBusy(true)
    setError(null)
    const importedPages: ScanPage[] = []
    const failures: string[] = []
    const startIndex = pages.length

    for (let index = 0; index < files.length; index += 1) {
      if (requestId !== requestIdRef.current) return
      const file = files[index]
      setBusyMessage(`Menyiapkan dokumen ${index + 1} dari ${files.length}…`)
      try {
        const image = await loadImageToCanvas(file)
        if (requestId !== requestIdRef.current) return
        const detection = await runQuadscanDetection(image)
        if (requestId !== requestIdRef.current) return
        const detected = detection.corners !== null
        importedPages.push({
          original: image,
          filename: file.name,
          corners:
            detection.corners ??
            createFallbackDocumentCorners(image.width, image.height),
          autoDetected: detected,
          detectionMessage: detected ? null : detection.message,
          controls: DEFAULT_CONTROLS,
          mode: 'adjust',
        })
      } catch (loadError) {
        failures.push(`${file.name}: ${errorMessage(loadError)}`)
      }
    }
    if (requestId !== requestIdRef.current) return
    if (importedPages.length > 0) {
      setPages((current) => [...current, ...importedPages])
      setActiveIndex(startIndex)
    }
    setError(failures.length > 0 ? failures.join(' · ') : null)
    setBusy(false)
    setBusyMessage('')
  }

  async function detectAgain() {
    if (!scan) return
    const requestId = ++requestIdRef.current
    setBusy(true)
    setError(null)
    try {
      const quadscanResult = await runQuadscanDetection(scan.original)
      if (requestId !== requestIdRef.current) return
      const detected = quadscanResult.corners !== null
      setPages((current) =>
        current.map((page, index) =>
          index === activeIndex && page.original === scan.original
            ? {
                ...page,
              corners:
                quadscanResult.corners ??
                createFallbackDocumentCorners(
                  page.original.width,
                  page.original.height,
                ),
              autoDetected: detected,
              detectionMessage: detected ? null : quadscanResult.message,
              processed: undefined,
            }
            : page,
        ),
      )
      setError(null)
    } catch (detectionError) {
      if (requestId === requestIdRef.current) setError(errorMessage(detectionError))
    } finally {
      if (requestId === requestIdRef.current) setBusy(false)
    }
  }

  function handleApply() {
    if (!scan || !adjustedCanvas) return
    try {
      const processed = cropToCorners(adjustedCanvas, scan.corners)
      setPages((current) =>
        current.map((page, index) =>
          index === activeIndex ? { ...page, processed, mode: 'preview' } : page,
        ),
      )
      const nextUnprocessed = pages.findIndex(
        (page, index) => index > activeIndex && !page.processed,
      )
      if (nextUnprocessed >= 0) setActiveIndex(nextUnprocessed)
      setError(null)
    } catch (processError) {
      setError(errorMessage(processError))
    }
  }

  async function handleExportPdf() {
    if (pages.length === 0 || pages.some((page) => !page.processed) || exporting) return
    setExporting(true)
    setExportProgress(0)
    setError(null)
    try {
      const bytes = await buildScannedPagesPdf(
        pages.flatMap((page) => (page.processed ? [page.processed] : [])),
        (done, total) => setExportProgress(Math.round((done / total) * 100)),
      )
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
      downloadBlob(blob, `localkit-scan-${compactDay(new Date())}.pdf`)
    } catch (exportError) {
      setError(errorMessage(exportError))
    } finally {
      setExporting(false)
      setExportProgress(0)
    }
  }

  function resetScan() {
    requestIdRef.current += 1
    setBusy(false)
    setBusyMessage('')
    setPages([])
    setActiveIndex(0)
    setError(null)
  }

  function removeCurrentPage() {
    if (busy || !scan) return
    const nextPages = pages.filter((_, index) => index !== activeIndex)
    setPages(nextPages)
    setActiveIndex(Math.min(activeIndex, nextPages.length - 1))
    setError(null)
  }

  function updateCurrentPage(updates: Partial<ScanPage>) {
    setPages((current) =>
      current.map((page, index) =>
        index === activeIndex ? { ...page, ...updates } : page,
      ),
    )
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
                hint="Pilih beberapa foto sekaligus · JPG, PNG, WebP"
                multiple
                busy={busy}
                onFiles={(files) => void handleFiles(files)}
              />
              {busy ? (
                <p className="py-3 text-center text-[11px] text-ink-400">{busyMessage}</p>
              ) : null}
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
                  Pindai beberapa foto, rapikan tiap halaman, lalu simpan menjadi satu PDF.
                </p>
              </div>
            </div>
            <ol className="space-y-2.5 text-[10.5px] text-ink-400">
              <li>1. Pilih atau ambil beberapa foto dokumen sekaligus.</li>
              <li>2. Periksa sudut dan filter untuk tiap halaman.</li>
              <li>3. Terapkan koreksi pada setiap halaman.</li>
              <li>4. Simpan seluruh hasil sebagai satu PDF.</li>
            </ol>
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.055] bg-white/[0.02] px-3 py-2">
              <Lock size={12} className="text-accent/80" />
              <p className="text-[10px] text-ink-500">Gambar tidak diunggah ke server.</p>
            </div>
          </aside>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                className="icon-btn size-8"
                aria-label="Dokumen sebelumnya"
                disabled={activeIndex === 0 || busy || exporting}
                onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
              >
                <ChevronLeft size={14} />
              </button>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-white">
                  Dokumen {activeIndex + 1} dari {pages.length}
                  <span className="ml-2 font-normal text-ink-500">
                    · {pages.filter((page) => page.processed).length} selesai
                  </span>
                </p>
                <p className="max-w-[60vw] truncate text-[10px] text-ink-400">
                  {scan.filename}
                </p>
              </div>
              <button
                type="button"
                className="icon-btn size-8"
                aria-label="Dokumen berikutnya"
                disabled={activeIndex >= pages.length - 1 || busy || exporting}
                onClick={() =>
                  setActiveIndex((index) => Math.min(pages.length - 1, index + 1))
                }
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-ghost !px-2.5 !py-1.5 !text-[10px]"
                onClick={removeCurrentPage}
                disabled={busy || exporting}
              >
                <Trash2 size={11} />
                Hapus halaman
              </button>
              <button
                type="button"
                className="btn-ghost !px-2.5 !py-1.5 !text-[10px]"
                onClick={resetScan}
                disabled={busy || exporting}
              >
                <RotateCcw size={11} />
                Hapus semua
              </button>
            </div>
          </div>
          {busy ? (
            <p className="text-center text-[11px] text-ink-400">{busyMessage}</p>
          ) : null}
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
                  {scan.autoDetected ? 'Sudut Quadscan' : 'Batas awal seluruh gambar'}
                </span>
              ) : null}
            </header>
            {scan.mode === 'adjust' && adjustedCanvas ? (
              <>
                <DocumentPreview
                  canvas={adjustedCanvas}
                  corners={scan.corners}
                  onCornersChange={(corners) => updateCurrentPage({ corners })}
                />
                {!scan.autoDetected ? (
                  <p className="text-[10px] leading-relaxed text-warn">
                    {scan.detectionMessage} Batas awal mencakup seluruh gambar; sesuaikan
                    sudut bila perlu atau langsung terapkan koreksi.
                  </p>
                ) : null}
                <button
                  type="button"
                  className="btn-ghost w-full"
                  onClick={() => void detectAgain()}
                  disabled={busy || exporting}
                >
                  <ScanLine size={12} className={busy ? 'animate-pulse' : undefined} />
                  {busy ? 'Mendeteksi ulang…' : 'Deteksi ulang dengan Quadscan'}
                </button>
                <button
                  type="button"
                  className="btn-primary w-full"
                  onClick={handleApply}
                  disabled={busy || exporting}
                >
                  <Check size={14} />
                  Terapkan halaman {activeIndex + 1}
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
                onControlChange={(controls) => updateCurrentPage({ controls })}
                onReset={() => updateCurrentPage({ controls: DEFAULT_CONTROLS })}
              />
            ) : null}
            {scan.mode === 'preview' ? (
              <section className="panel space-y-3 p-4">
                <button
                  type="button"
                  className="btn-ghost w-full"
                  onClick={() => updateCurrentPage({ mode: 'adjust', processed: undefined })}
                  disabled={exporting}
                >
                  <Upload size={12} />
                  Atur ulang halaman ini
                </button>
              </section>
            ) : null}
            <section className="panel space-y-3 p-3">
              <Dropzone
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                icon={FilePlus2}
                title="Tambah dokumen"
                subtitle="Pilih satu atau beberapa foto lagi"
                multiple
                compact
                busy={busy || exporting}
                onFiles={(files) => void handleFiles(files)}
              />
              {busy ? (
                <p className="text-center text-[10px] text-ink-400">{busyMessage}</p>
              ) : null}
            </section>
            <section className="panel space-y-3 p-4">
              <p className="text-[10px] leading-relaxed text-ink-400">
                {pages.filter((page) => page.processed).length} dari {pages.length} halaman
                siap digabung menjadi satu PDF.
              </p>
              <button
                type="button"
                className="btn-primary w-full"
                onClick={() => void handleExportPdf()}
                disabled={
                  exporting || pages.length === 0 || pages.some((page) => !page.processed)
                }
              >
                <Download size={13} />
                {exporting
                  ? `Membuat PDF… ${exportProgress}%`
                  : 'Simpan semua sebagai satu PDF'}
              </button>
              {pages.some((page) => !page.processed) ? (
                <p className="text-[9px] leading-relaxed text-ink-500">
                  Terapkan koreksi pada setiap dokumen sebelum membuat PDF.
                </p>
              ) : null}
            </section>
            <div className="rounded-lg border border-white/[0.055] bg-white/[0.02] px-3 py-2.5 text-[10px] leading-relaxed text-ink-500">
              Pemindaian dan pembuatan PDF berjalan lokal di perangkat.
            </div>
          </aside>
        </div>
        </div>
      )}
    </div>
  )
}
