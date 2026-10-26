import { useEffect, useRef, useState, type PointerEvent } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Crop,
  Download,
  FileImage,
  FilePlus2,
  FileText,
  Layers,
  Lock,
  Maximize2,
  Palette,
  RotateCcw,
  RotateCw,
  ScanLine,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react'
import { Quadscan, type CornerPoints } from 'quadscan'
import quadscanModelUrl from 'quadscan/models/lcnet?url'
import { Dropzone } from '../components/Dropzone'
import { Segmented, SliderField } from '../components/Controls'
import {
  adjustImage,
  cropToCorners,
  createFallbackDocumentCorners,
  loadImageToCanvas,
  rotateCanvas,
  rotateCornersClockwise,
  type EdgePoints,
  type ScannerControls,
} from '../lib/documentScanner'
import {
  buildScannedPagesPdf,
  type PdfOrientation,
  type PdfPaperSize,
} from '../lib/imagesToPdf'
import {
  compactDay,
  downloadBlob,
  errorMessage,
} from '../lib/format'

interface ScanPage {
  original: HTMLCanvasElement
  cropped?: HTMLCanvasElement
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

const FILTER_PRESETS = [
  {
    value: 'auto' as const,
    label: 'Otomatis',
    sublabel: 'Magic Color',
    hint: 'Kertas putih bersih & teks tajam',
    icon: Wand2,
  },
  {
    value: 'enhanced' as const,
    label: 'Warna cerah',
    sublabel: 'Vivid Color',
    hint: 'Warna hidup untuk brosur/ID card',
    icon: Palette,
  },
  {
    value: 'document' as const,
    label: 'Hitam-putih',
    sublabel: 'B&W Fotokopi',
    hint: 'Teks pekat, hemat tinta cetak',
    icon: FileText,
  },
  {
    value: 'grayscale' as const,
    label: 'Abu-abu',
    sublabel: 'Grayscale',
    hint: 'Gradasi abu-abu tanpa bayangan',
    icon: Sparkles,
  },
  {
    value: 'color' as const,
    label: 'Asli',
    sublabel: 'Original',
    hint: 'Warna asli tanpa pemutihan kertas',
    icon: FileImage,
  },
]

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
  const scale = Math.min(1, maxWidth / canvas.width, 520 / canvas.height)
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
    const x = Math.max(
      0,
      Math.min(canvas.width, ((event.clientX - rect.left) / rect.width) * canvas.width),
    )
    const y = Math.max(
      0,
      Math.min(canvas.height, ((event.clientY - rect.top) / rect.height) * canvas.height),
    )
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
        className="relative mx-auto touch-none select-none overflow-hidden rounded-xl border border-white/10 bg-ink-900 shadow-xl"
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
            points={orderedCorners.map(([x, y]) => `${x},${y}`).join(',')}
            fill="rgba(94,234,212,.18)"
            stroke="rgb(94,234,212)"
            strokeWidth="2.5"
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
              className={`absolute z-10 touch-none rounded-full border-2 border-ink-950 bg-accent shadow-[0_0_8px_rgba(94,234,212,.8)] transition-transform hover:scale-125 ${
                isHorizontal
                  ? 'h-3.5 w-11 -translate-x-1/2 -translate-y-1/2'
                  : 'h-11 w-3.5 -translate-x-1/2 -translate-y-1/2'
              }`}
              style={{
                left: `${(x / canvas.width) * 100}%`,
                top: `${(y / canvas.height) * 100}%`,
              }}
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
              className="absolute z-10 grid size-9 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center rounded-full border-2 border-white bg-accent shadow-[0_0_12px_rgba(94,234,212,0.9)] transition-transform active:scale-125"
              style={{
                left: `${(x / canvas.width) * 100}%`,
                top: `${(y / canvas.height) * 100}%`,
              }}
              onPointerDown={(event) =>
                startDrag(event, { kind: 'corner', key, startCorners: corners })
              }
            >
              <span className="size-2 rounded-full bg-ink-950" />
            </button>
          )
        })}
      </div>
      <p className="text-center text-[10.5px] text-ink-400">
        Tarik titik sudut atau pegangan sisi untuk merapikan batas dokumen.
      </p>
    </div>
  )
}

function ControlsPanel({
  controls,
  onControlChange,
  onReset,
  onApplyAll,
  showApplyAll,
}: {
  controls: ScannerControls
  onControlChange: (controls: ScannerControls) => void
  onReset: () => void
  onApplyAll?: () => void
  showApplyAll?: boolean
}) {
  const [showSliders, setShowSliders] = useState(false)

  return (
    <section className="panel space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Wand2 size={13} className="text-accent" />
          <h2 className="text-[12px] font-semibold text-white">Filter Dokumen</h2>
        </div>
        <button
          type="button"
          onClick={() => setShowSliders(!showSliders)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition ${
            showSliders
              ? 'bg-accent/15 text-accent'
              : 'text-ink-400 hover:bg-white/[0.04] hover:text-ink-200'
          }`}
        >
          <SlidersHorizontal size={11} />
          {showSliders ? 'Tutup Atur' : 'Atur Manual'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
        {FILTER_PRESETS.map((filter) => {
          const Icon = filter.icon
          const active = controls.filter === filter.value
          return (
            <button
              key={filter.value}
              type="button"
              aria-pressed={active}
              onClick={() => onControlChange({ ...controls, filter: filter.value })}
              className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition ${
                active
                  ? 'border-accent/40 bg-accent/[0.08] shadow-[0_0_12px_rgba(94,234,212,0.08)]'
                  : 'border-white/[0.06] bg-ink-950/40 hover:border-white/[0.12] hover:bg-white/[0.02]'
              }`}
            >
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-lg border transition ${
                  active
                    ? 'border-accent/30 bg-accent/20 text-accent'
                    : 'border-white/[0.06] bg-white/[0.03] text-ink-400'
                }`}
              >
                <Icon size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={`text-[11px] font-semibold ${
                      active ? 'text-white' : 'text-ink-200'
                    }`}
                  >
                    {filter.label}
                  </span>
                  <span className="text-[9px] text-ink-500">{filter.sublabel}</span>
                </div>
                <p className="truncate text-[9.5px] text-ink-400">{filter.hint}</p>
              </div>
            </button>
          )
        })}
      </div>

      {showSliders ? (
        <div className="space-y-3 rounded-xl border border-white/[0.06] bg-ink-950/60 p-3">
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
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          className="btn-ghost flex-1 !text-[10px]"
          onClick={onReset}
        >
          <RotateCcw size={11} />
          Reset Filter
        </button>
        {showApplyAll && onApplyAll ? (
          <button
            type="button"
            className="btn-ghost flex-1 !text-[10px]"
            onClick={onApplyAll}
            title="Terapkan filter ini ke semua halaman dokumen"
          >
            <Layers size={11} />
            Ke Semua Hal.
          </button>
        ) : null}
      </div>
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
  const [paper, setPaper] = useState<PdfPaperSize>('a4')
  const [orientation, setOrientation] = useState<PdfOrientation>('portrait')
  const [margin, setMargin] = useState(12)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const quadscanRef = useRef<Quadscan | null>(null)
  const scan = pages[activeIndex] ?? null

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
      setBusyMessage(`Mendeteksi dokumen ${index + 1} dari ${files.length}…`)
      try {
        const image = await loadImageToCanvas(file)
        if (requestId !== requestIdRef.current) return
        const detection = await runQuadscanDetection(image)
        if (requestId !== requestIdRef.current) return
        const corners =
          detection.corners ?? createFallbackDocumentCorners(image.width, image.height)

        let cropped: HTMLCanvasElement | undefined
        let processed: HTMLCanvasElement | undefined
        try {
          cropped = cropToCorners(image, corners)
          processed = adjustImage(cropped, DEFAULT_CONTROLS)
        } catch {
          // If crop failed, page stays in adjust mode
        }

        importedPages.push({
          original: image,
          cropped,
          processed,
          filename: file.name,
          corners,
          autoDetected: detection.corners !== null,
          detectionMessage: detection.corners !== null ? null : detection.message,
          controls: DEFAULT_CONTROLS,
          mode: cropped && processed ? 'preview' : 'adjust',
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
      const corners =
        quadscanResult.corners ??
        createFallbackDocumentCorners(scan.original.width, scan.original.height)

      let cropped: HTMLCanvasElement | undefined
      let processed: HTMLCanvasElement | undefined
      try {
        cropped = cropToCorners(scan.original, corners)
        processed = adjustImage(cropped, scan.controls)
      } catch {
        // keep
      }

      setPages((current) =>
        current.map((page, index) =>
          index === activeIndex
            ? {
                ...page,
                corners,
                autoDetected: detected,
                detectionMessage: detected ? null : quadscanResult.message,
                cropped,
                processed,
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

  function handleControlChange(newControls: ScannerControls) {
    if (!scan) return
    let cropped = scan.cropped
    if (!cropped) {
      try {
        cropped = cropToCorners(scan.original, scan.corners)
      } catch {
        // ignore
      }
    }
    const processed = cropped ? adjustImage(cropped, newControls) : undefined
    setPages((current) =>
      current.map((page, index) =>
        index === activeIndex
          ? {
              ...page,
              controls: newControls,
              cropped,
              processed,
            }
          : page,
      ),
    )
  }

  function handleApplyAllFilters() {
    if (!scan) return
    setPages((current) =>
      current.map((page) => {
        let cropped = page.cropped
        if (!cropped) {
          try {
            cropped = cropToCorners(page.original, page.corners)
          } catch {
            // keep
          }
        }
        const processed = cropped ? adjustImage(cropped, scan.controls) : page.processed
        return {
          ...page,
          controls: { ...scan.controls },
          cropped,
          processed,
        }
      }),
    )
  }

  function handleRotate(mode: 'adjust' | 'preview') {
    if (!scan) return
    if (mode === 'adjust') {
      const rotated = rotateCanvas(scan.original)
      const corners = rotateCornersClockwise(
        scan.corners,
        scan.original.width,
        scan.original.height,
      )
      let cropped: HTMLCanvasElement | undefined
      let processed: HTMLCanvasElement | undefined
      try {
        cropped = cropToCorners(rotated, corners)
        processed = adjustImage(cropped, scan.controls)
      } catch {
        // ignore
      }
      setPages((current) =>
        current.map((page, index) =>
          index === activeIndex
            ? {
                ...page,
                original: rotated,
                corners,
                cropped,
                processed,
              }
            : page,
        ),
      )
    } else {
      const base = scan.cropped ?? cropToCorners(scan.original, scan.corners)
      const rotatedCropped = rotateCanvas(base)
      const processed = adjustImage(rotatedCropped, scan.controls)
      setPages((current) =>
        current.map((page, index) =>
          index === activeIndex
            ? {
                ...page,
                cropped: rotatedCropped,
                processed,
              }
            : page,
        ),
      )
    }
  }

  function handleResetCorners() {
    if (!scan) return
    const fallback = createFallbackDocumentCorners(
      scan.original.width,
      scan.original.height,
    )
    let cropped: HTMLCanvasElement | undefined
    let processed: HTMLCanvasElement | undefined
    try {
      cropped = cropToCorners(scan.original, fallback)
      processed = adjustImage(cropped, scan.controls)
    } catch {
      // ignore
    }
    setPages((current) =>
      current.map((page, index) =>
        index === activeIndex
          ? {
              ...page,
              corners: fallback,
              cropped,
              processed,
            }
          : page,
      ),
    )
  }

  function handleApplyCrop() {
    if (!scan) return
    try {
      const cropped = cropToCorners(scan.original, scan.corners)
      const processed = adjustImage(cropped, scan.controls)
      setPages((current) =>
        current.map((page, index) =>
          index === activeIndex
            ? {
                ...page,
                cropped,
                processed,
                mode: 'preview',
              }
            : page,
        ),
      )
      setError(null)
    } catch (processError) {
      setError(errorMessage(processError))
    }
  }

  async function handleExportPdf() {
    if (pages.length === 0 || exporting) return
    setExporting(true)
    setExportProgress(0)
    setError(null)
    try {
      const finalCanvases: HTMLCanvasElement[] = []
      for (const page of pages) {
        if (page.processed) {
          finalCanvases.push(page.processed)
        } else {
          const cropped = page.cropped ?? cropToCorners(page.original, page.corners)
          const processed = adjustImage(cropped, page.controls)
          finalCanvases.push(processed)
        }
      }
      const bytes = await buildScannedPagesPdf(
        finalCanvases,
        { paper, orientation, marginMm: margin },
        (done, total) => setExportProgress(Math.round((done / total) * 100)),
      )
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
      downloadBlob(blob, `localkit-scan-${paper}-${compactDay(new Date())}.pdf`)
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
    setActiveIndex(Math.min(activeIndex, Math.max(0, nextPages.length - 1)))
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
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
                icon={ScanLine}
                title="Pindai dokumen"
                subtitle="Ambil foto dokumen atau pilih gambar dari galeri"
                hint="Dukung multi-halaman · JPG, PNG, WebP, HEIC (iPhone)"
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
                <h2 className="text-[13px] font-semibold text-white">
                  Pemindai Dokumen Mobile-Style
                </h2>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
                  Luruskan sudut perspektif foto dan bersihkan kertas dengan filter scanner
                  otomatis (Magic Color & Hitam Putih Fotokopi).
                </p>
              </div>
            </div>
            <ol className="space-y-2.5 text-[10.5px] text-ink-400">
              <li>1. Pilih atau jepret satu/beberapa foto dokumen sekaligus.</li>
              <li>2. Dokumen otomatis diluruskan & dibersihkan dari bayangan meja.</li>
              <li>3. Pilih filter: Magic Color, Hitam-Putih, Warna cerah, dll.</li>
              <li>4. Simpan semua halaman menjadi satu PDF siap cetak.</li>
            </ol>
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.055] bg-white/[0.02] px-3 py-2">
              <Lock size={12} className="text-accent/80" />
              <p className="text-[10px] text-ink-500">
                100% diproses di browser Anda. Tidak ada data yang dikirim ke server.
              </p>
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
                    · {pages.filter((page) => page.processed).length} siap PDF
                  </span>
                </p>
                <p className="max-w-[50vw] truncate text-[10px] text-ink-400">
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
                onClick={() => handleRotate(scan.mode)}
                disabled={busy || exporting}
                title="Putar 90 derajat searah jarum jam"
              >
                <RotateCw size={11} />
                Putar 90°
              </button>
              <button
                type="button"
                className="btn-ghost !px-2.5 !py-1.5 !text-[10px]"
                onClick={removeCurrentPage}
                disabled={busy || exporting}
              >
                <Trash2 size={11} />
                Hapus
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

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="panel min-w-0 space-y-4 p-4">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
                <div className="flex min-w-0 items-center gap-2">
                  <ScanLine size={14} className="shrink-0 text-accent" />
                  <h2 className="truncate text-[12px] font-semibold text-white">
                    {scan.mode === 'adjust' ? 'Atur Sudut Dokumen' : 'Hasil Pemindaian'}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  {scan.mode === 'adjust' ? (
                    <button
                      type="button"
                      className="btn-primary !px-3 !py-1 !text-[10.5px]"
                      onClick={handleApplyCrop}
                      disabled={busy || exporting}
                    >
                      <Check size={12} />
                      Selesai & Lihat Hasil
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-ghost !px-2.5 !py-1 !text-[10px]"
                      onClick={() => updateCurrentPage({ mode: 'adjust' })}
                      disabled={exporting}
                    >
                      <Crop size={11} />
                      Atur Sudut (Crop)
                    </button>
                  )}
                </div>
              </header>

              {scan.mode === 'adjust' ? (
                <>
                  <DocumentPreview
                    canvas={scan.original}
                    corners={scan.corners}
                    onCornersChange={(corners) => updateCurrentPage({ corners })}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="btn-ghost !px-2.5 !py-1.5 !text-[10px]"
                        onClick={() => void detectAgain()}
                        disabled={busy || exporting}
                      >
                        <ScanLine
                          size={11}
                          className={busy ? 'animate-pulse' : undefined}
                        />
                        {busy ? 'Mendeteksi…' : 'Deteksi ulang AI'}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost !px-2.5 !py-1.5 !text-[10px]"
                        onClick={handleResetCorners}
                        disabled={busy || exporting}
                        title="Pilih seluruh area foto"
                      >
                        <Maximize2 size={11} />
                        Pilih Seluruh Foto
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn-primary !px-4 !py-1.5 !text-[11px]"
                      onClick={handleApplyCrop}
                      disabled={busy || exporting}
                    >
                      <Check size={13} />
                      Terapkan Sudut
                    </button>
                  </div>
                </>
              ) : scan.processed ? (
                <>
                  <div className="checkerboard grid max-h-[70vh] min-h-48 place-items-center overflow-auto rounded-xl p-3 shadow-inner">
                    <canvas
                      width={scan.processed.width}
                      height={scan.processed.height}
                      className="h-auto max-h-[65vh] w-auto max-w-full rounded shadow-md object-contain"
                      ref={(element) => {
                        if (!element) return
                        element.getContext('2d')?.drawImage(scan.processed!, 0, 0)
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-ink-500">
                    <p className="font-mono">
                      {scan.processed.width} × {scan.processed.height} px
                    </p>
                    <p>
                      Filter aktif:{' '}
                      <span className="font-semibold text-accent">
                        {
                          FILTER_PRESETS.find((f) => f.value === scan.controls.filter)
                            ?.label
                        }
                      </span>
                    </p>
                  </div>

                  {/* Android-style quick filter pill bar directly below preview */}
                  <div className="flex items-center gap-1.5 overflow-x-auto rounded-xl border border-white/[0.06] bg-ink-950/70 p-1.5">
                    {FILTER_PRESETS.map((f) => {
                      const Icon = f.icon
                      const active = scan.controls.filter === f.value
                      return (
                        <button
                          key={f.value}
                          type="button"
                          onClick={() => handleControlChange({ ...scan.controls, filter: f.value })}
                          className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10.5px] font-medium transition ${
                            active
                              ? 'bg-accent text-ink-950 shadow-sm'
                              : 'text-ink-400 hover:bg-white/[0.04] hover:text-ink-200'
                          }`}
                        >
                          <Icon size={12} />
                          {f.label}
                        </button>
                      )
                    })}
                  </div>
                </>
              ) : null}
            </section>

            <aside className="space-y-4">
              <ControlsPanel
                controls={scan.controls}
                onControlChange={handleControlChange}
                onReset={() => handleControlChange(DEFAULT_CONTROLS)}
                onApplyAll={handleApplyAllFilters}
                showApplyAll={pages.length > 1}
              />

              <section className="panel space-y-3 p-3">
                <Dropzone
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
                  icon={FilePlus2}
                  title="Tambah foto dokumen"
                  subtitle="Tambahkan foto halaman berikutnya"
                  multiple
                  compact
                  busy={busy || exporting}
                  onFiles={(files) => void handleFiles(files)}
                />
              </section>

              <section className="panel space-y-3 p-4">
                <h3 className="text-[11px] font-semibold text-white">Pengaturan PDF</h3>
                <div className="space-y-2">
                  <span className="eyebrow">Ukuran kertas</span>
                  <Segmented
                    compact
                    value={paper}
                    onChange={setPaper}
                    options={[
                      { value: 'a4', label: 'A4', hint: '210×297' },
                      { value: 'f4', label: 'F4', hint: '210×330' },
                      { value: 'fit', label: 'Fit', hint: 'Rasio foto' },
                    ]}
                  />
                </div>
                <div className="space-y-2">
                  <span className="eyebrow">Orientasi</span>
                  <Segmented
                    compact
                    value={orientation}
                    onChange={setOrientation}
                    options={[
                      { value: 'portrait', label: 'Portrait', hint: 'Tegak' },
                      { value: 'landscape', label: 'Landscape', hint: 'Mendatar' },
                    ]}
                    className={
                      paper === 'fit' ? 'pointer-events-none opacity-40' : undefined
                    }
                  />
                  {paper === 'fit' ? (
                    <p className="text-[9px] text-ink-500">
                      Fit otomatis mengikuti rasio tiap halaman dokumen.
                    </p>
                  ) : null}
                </div>
                <SliderField
                  label="Margin"
                  value={margin}
                  min={0}
                  max={40}
                  step={1}
                  display={`${margin} mm`}
                  onChange={setMargin}
                  disabled={exporting}
                />
                <p className="text-[10px] leading-relaxed text-ink-400">
                  {pages.length} halaman siap digabung menjadi satu berkas PDF.
                </p>
                <p className="text-[9px] text-ink-500">
                  Format: {paper === 'fit' ? 'Fit' : `${paper.toUpperCase()} · ${orientation === 'portrait' ? 'Portrait' : 'Landscape'}`}
                </p>
                <button
                  type="button"
                  className="btn-primary w-full"
                  onClick={() => void handleExportPdf()}
                  disabled={exporting || pages.length === 0}
                >
                  <Download size={13} />
                  {exporting
                    ? `Membuat PDF… ${exportProgress}%`
                    : `Simpan ${pages.length} Halaman ke PDF`}
                </button>
              </section>

              <div className="rounded-lg border border-white/[0.055] bg-white/[0.02] px-3 py-2.5 text-[10px] leading-relaxed text-ink-500">
                Pemindaian & penggabungan PDF 100% diproses secara lokal di perangkat Anda.
              </div>
            </aside>
          </div>
        </div>
      )}
    </div>
  )
}
