import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  ImagePlus,
  Loader2,
  Lock,
  PenTool,
  RotateCcw,
  ShieldCheck,
  Signature,
  Trash2,
  Upload,
} from 'lucide-react'
import { Dropzone } from '../components/Dropzone'
import { ImageSourcePicker } from '../components/ImageSourcePicker'
import { SignaturePad, type AppliedSignature } from '../components/SignaturePad'
import { SliderField } from '../components/Controls'
import {
  destroyPdfDocument,
  openPdfDocument,
  renderPdfPage,
  type PDFDocumentProxy,
} from '../lib/pdfjs'
import { stampSignaturePdf } from '../lib/signPdf'
import { canvasToBlob, decodeImageFile } from '../lib/image'
import {
  clamp,
  cn,
  compactDay,
  downloadBlob,
  errorMessage,
  formatBytes,
  sanitizeBaseName,
} from '../lib/format'

interface LoadedPdf {
  name: string
  size: number
  bytes: Uint8Array
  document: PDFDocumentProxy
  pageCount: number
}

interface SignatureFile {
  name: string
  size: number
  bytes: Uint8Array
  url: string
  type: 'png' | 'jpeg'
  width: number
  height: number
}

interface Placement {
  x: number
  y: number
  w: number
  h: number
}

const MAX_SIGNATURE_SIDE = 1600
const DEFAULT_PLACEMENT: Placement = { x: 35, y: 62, w: 30, h: 12 }

function clampPlacement(placement: Placement): Placement {
  const w = clamp(placement.w, 3, 100)
  const h = clamp(placement.h, 2, 100)
  return {
    w,
    h,
    x: clamp(placement.x, 0, Math.max(0, 100 - w)),
    y: clamp(placement.y, 0, Math.max(0, 100 - h)),
  }
}

function heightForWidth(
  widthPct: number,
  page: { width: number; height: number } | null,
  signature: { width: number; height: number } | null,
): number {
  if (!page || !signature || signature.width <= 0) return 12
  return clamp(
    widthPct * (page.width / page.height) * (signature.height / signature.width),
    2,
    95,
  )
}

function widthForHeight(
  heightPct: number,
  page: { width: number; height: number } | null,
  signature: { width: number; height: number } | null,
): number {
  if (!page || !signature || signature.height <= 0) return 30
  return clamp(
    heightPct * (page.height / page.width) * (signature.width / signature.height),
    3,
    100,
  )
}

export function SignatureStamper() {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null)
  const [signature, setSignature] = useState<SignatureFile | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null)
  const [pageRotation, setPageRotation] = useState(0)
  const [placement, setPlacement] = useState<Placement>(DEFAULT_PLACEMENT)
  const [aspectLocked, setAspectLocked] = useState(true)
  const [rendering, setRendering] = useState(false)
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [loadingSignature, setLoadingSignature] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [exportInfo, setExportInfo] = useState<string | null>(null)

  const pdfInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pageWrapRef = useRef<HTMLDivElement>(null)
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null)
  const signatureUrlRef = useRef<string | null>(null)
  const signatureRef = useRef<SignatureFile | null>(null)
  const aspectLockedRef = useRef(aspectLocked)
  const mountedRef = useRef(true)
  const moveRef = useRef<{
    startX: number
    startY: number
    rect: DOMRect
    placement: Placement
  } | null>(null)
  const resizeRef = useRef<{
    startX: number
    startY: number
    rect: DOMRect
    placement: Placement
  } | null>(null)

  useEffect(() => {
    signatureRef.current = signature
  }, [signature])

  useEffect(() => {
    aspectLockedRef.current = aspectLocked
  }, [aspectLocked])

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      void destroyPdfDocument(pdfDocRef.current)
      pdfDocRef.current = null
      if (signatureUrlRef.current) {
        URL.revokeObjectURL(signatureUrlRef.current)
        signatureUrlRef.current = null
      }
    }
  }, [])

  // Render the selected page (with its native rotation) whenever it changes.
  useEffect(() => {
    if (!pdf) return

    let cancelled = false

    void (async () => {
      setRendering(true)
      setNotice(null)

      try {
        const page = await pdf.document.getPage(pageIndex + 1)
        if (cancelled) return

        const baseViewport = page.getViewport({ scale: 1 })
        const nextPageSize = { width: baseViewport.width, height: baseViewport.height }

        setPageSize(nextPageSize)
        setPageRotation(((page.rotate % 360) + 360) % 360)
        setPlacement((previous) => {
          const activeSignature = signatureRef.current
          if (!activeSignature) return clampPlacement(previous)
          const nextHeight = aspectLockedRef.current
            ? heightForWidth(previous.w, nextPageSize, activeSignature)
            : previous.h
          return clampPlacement({ ...previous, h: nextHeight })
        })

        const canvas = await renderPdfPage(page, { maxWidth: 1000, maxHeight: 1250 })
        if (cancelled) return

        const target = canvasRef.current
        if (!target) return

        target.width = canvas.width
        target.height = canvas.height
        const context = target.getContext('2d')
        if (context) {
          context.clearRect(0, 0, target.width, target.height)
          context.drawImage(canvas, 0, 0)
        }
        canvas.width = 0
        canvas.height = 0
      } catch (renderError) {
        if (!cancelled) setNotice(errorMessage(renderError))
      } finally {
        if (!cancelled) setRendering(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [pdf, pageIndex])

  async function handlePdfFile(file: File) {
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      setNotice('File harus berupa PDF.')
      return
    }

    setLoadingPdf(true)
    setNotice(null)
    setExportInfo(null)

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const document = await openPdfDocument(bytes)
      if (!mountedRef.current) {
        await destroyPdfDocument(document)
        return
      }

      const previousDocument = pdfDocRef.current
      pdfDocRef.current = document
      setPdf({
        name: file.name,
        size: file.size,
        bytes,
        document,
        pageCount: document.numPages,
      })
      setPageIndex(0)
      setPageSize(null)
      void destroyPdfDocument(previousDocument)
    } catch (loadError) {
      if (mountedRef.current) setNotice(errorMessage(loadError))
    } finally {
      if (mountedRef.current) setLoadingPdf(false)
    }
  }

  function removePdf() {
    const document = pdfDocRef.current
    pdfDocRef.current = null
    void destroyPdfDocument(document)
    setPdf(null)
    setPageIndex(0)
    setPageSize(null)
    setExportInfo(null)
    const canvas = canvasRef.current
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }

  async function handleSignatureFile(file: File) {
    const isPng = file.type === 'image/png' || /\.png$/i.test(file.name)
    const isJpeg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)
    if (!isPng && !isJpeg) {
      setNotice('Tanda tangan harus berupa PNG transparan atau JPG.')
      return
    }

    setLoadingSignature(true)
    setNotice(null)
    setExportInfo(null)

    try {
      const decoded = await decodeImageFile(file)
      try {
        const downscale = Math.min(
          1,
          MAX_SIGNATURE_SIDE / Math.max(decoded.width, decoded.height),
        )
        const width = Math.max(1, Math.round(decoded.width * downscale))
        const height = Math.max(1, Math.round(decoded.height * downscale))

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas 2D tidak tersedia di browser ini.')

        context.clearRect(0, 0, width, height)
        if (!isPng) {
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, width, height)
        }
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        context.drawImage(decoded.source, 0, 0, width, height)

        const type: 'png' | 'jpeg' = isPng ? 'png' : 'jpeg'
        const blob = await canvasToBlob(
          canvas,
          type === 'png' ? 'image/png' : 'image/jpeg',
          0.95,
        )
        canvas.width = 0
        canvas.height = 0

        if (!mountedRef.current) return

        const bytes = new Uint8Array(await blob.arrayBuffer())
        const url = URL.createObjectURL(blob)

        if (signatureUrlRef.current) URL.revokeObjectURL(signatureUrlRef.current)
        signatureUrlRef.current = url

        const nextSignature: SignatureFile = {
          name: file.name,
          size: blob.size,
          bytes,
          url,
          type,
          width,
          height,
        }

        setSignature(nextSignature)
        setPlacement((previous) => {
          const nextWidth = clamp(previous.w, 8, 80)
          const nextHeight = aspectLockedRef.current
            ? heightForWidth(nextWidth, pageSize, nextSignature)
            : previous.h
          return clampPlacement({
            ...previous,
            w: nextWidth,
            h: nextHeight,
          })
        })
      } finally {
        decoded.release()
      }
    } catch (signatureError) {
      if (mountedRef.current) setNotice(errorMessage(signatureError))
    } finally {
      if (mountedRef.current) setLoadingSignature(false)
    }
  }

  function removeSignature() {
    if (signatureUrlRef.current) {
      URL.revokeObjectURL(signatureUrlRef.current)
      signatureUrlRef.current = null
    }
    setSignature(null)
    setExportInfo(null)
  }

  async function applyPadSignature(payload: AppliedSignature) {
    setLoadingSignature(true)
    setNotice(null)
    setExportInfo(null)

    try {
      const response = await fetch(payload.dataUrl)
      const blob = await response.blob()
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const url = URL.createObjectURL(blob)

      if (signatureUrlRef.current) URL.revokeObjectURL(signatureUrlRef.current)
      signatureUrlRef.current = url

      const nextSignature: SignatureFile = {
        name: payload.name,
        size: blob.size,
        bytes,
        url,
        type: 'png',
        width: payload.width,
        height: payload.height,
      }

      setSignature(nextSignature)
      setPlacement((previous) => {
        const nextWidth = clamp(previous.w, 8, 80)
        const nextHeight = aspectLockedRef.current
          ? heightForWidth(nextWidth, pageSize, nextSignature)
          : previous.h
        return clampPlacement({
          ...previous,
          w: nextWidth,
          h: nextHeight,
        })
      })
    } catch (padError) {
      if (mountedRef.current) setNotice(errorMessage(padError))
    } finally {
      if (mountedRef.current) setLoadingSignature(false)
    }
  }

  function resetPlacement() {
    if (!signature || !pageSize) {
      setPlacement(DEFAULT_PLACEMENT)
      return
    }
    const width = 30
    setPlacement(
      clampPlacement({
        x: 35,
        y: 62,
        w: width,
        h: heightForWidth(width, pageSize, signature),
      }),
    )
  }

  function updateWidth(value: number) {
    setPlacement((previous) => {
      const width = clamp(value, 3, 100 - previous.x)
      const height = aspectLocked
        ? heightForWidth(width, pageSize, signature)
        : previous.h
      return clampPlacement({ ...previous, w: width, h: height })
    })
  }

  function updateHeight(value: number) {
    setPlacement((previous) => {
      const height = clamp(value, 2, 100 - previous.y)
      const width = aspectLocked
        ? widthForHeight(height, pageSize, signature)
        : previous.w
      return clampPlacement({ ...previous, h: height, w: width })
    })
  }

  function toggleAspectLock() {
    const next = !aspectLocked
    setAspectLocked(next)
    if (next && signature) {
      setPlacement((current) =>
        clampPlacement({
          ...current,
          h: heightForWidth(current.w, pageSize, signature),
        }),
      )
    }
  }

  function handleMovePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!signature) return
    const rect = pageWrapRef.current?.getBoundingClientRect()
    if (!rect) return

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    moveRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      rect,
      placement: { ...placement },
    }
  }

  function handleMovePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = moveRef.current
    if (!drag) return
    const dx = ((event.clientX - drag.startX) / drag.rect.width) * 100
    const dy = ((event.clientY - drag.startY) / drag.rect.height) * 100

    setPlacement(
      clampPlacement({
        ...drag.placement,
        x: drag.placement.x + dx,
        y: drag.placement.y + dy,
      }),
    )
  }

  function handleMovePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    moveRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function handleResizePointerDown(event: ReactPointerEvent<HTMLSpanElement>) {
    event.preventDefault()
    event.stopPropagation()
    const rect = pageWrapRef.current?.getBoundingClientRect()
    if (!rect) return

    event.currentTarget.setPointerCapture(event.pointerId)
    resizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      rect,
      placement: { ...placement },
    }
  }

  function handleResizePointerMove(event: ReactPointerEvent<HTMLSpanElement>) {
    const drag = resizeRef.current
    if (!drag || !signature) return

    const dx = ((event.clientX - drag.startX) / drag.rect.width) * 100
    const dy = ((event.clientY - drag.startY) / drag.rect.height) * 100

    let width = clamp(drag.placement.w + dx, 3, 100 - drag.placement.x)
    let height = aspectLocked
      ? heightForWidth(width, pageSize, signature)
      : clamp(drag.placement.h + dy, 2, 100 - drag.placement.y)

    if (height > 100 - drag.placement.y && aspectLocked) {
      height = 100 - drag.placement.y
      width = clamp(widthForHeight(height, pageSize, signature), 3, 100 - drag.placement.x)
    }

    setPlacement(
      clampPlacement({ ...drag.placement, w: width, h: height }),
    )
  }

  function handleResizePointerUp(event: ReactPointerEvent<HTMLSpanElement>) {
    resizeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  async function handleStamperExport() {
    if (!pdf || !signature || exporting) return

    setExporting(true)
    setNotice(null)
    setExportInfo(null)

    try {
      const bytes = await stampSignaturePdf({
        pdfBytes: pdf.bytes,
        pdfjsDocument: pdf.document,
        signatureBytes: signature.bytes,
        signatureType: signature.type,
        placement: {
          pageIndex,
          xPct: placement.x,
          yPct: placement.y,
          widthPct: placement.w,
          heightPct: placement.h,
        },
      })

      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
      const filename = `${sanitizeBaseName(pdf.name)}-signed-${compactDay(new Date())}.pdf`
      downloadBlob(blob, filename)
      setExportInfo(
        `${filename} · halaman ${pageIndex + 1} · ${formatBytes(blob.size)}`,
      )
    } catch (stampError) {
      if (mountedRef.current) setNotice(errorMessage(stampError))
    } finally {
      if (mountedRef.current) setExporting(false)
    }
  }

  const busy = loadingPdf || loadingSignature || exporting

  if (!pdf) {
    return (
      <div className="animate-fade-up space-y-5">
        {notice ? (
          <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[11px] text-danger">
            <AlertTriangle size={13} className="mt-px shrink-0" />
            <span>{notice}</span>
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="panel bg-noise relative overflow-hidden p-2">
            <div className="pointer-events-none absolute inset-0 grid-lines opacity-30" />
            <div className="relative">
              <Dropzone
                accept="application/pdf,.pdf"
                icon={PenTool}
                onFiles={(files) => {
                  const file = files[0]
                  if (file) void handlePdfFile(file)
                }}
                title="Tarik PDF yang akan ditandatangani"
                subtitle="Pilih halaman, lalu tempatkan tanda tangan secara visual"
                hint="PDF · diproses lokal dengan pdf.js + pdf-lib"
                busy={loadingPdf}
              />
            </div>
          </div>

          <aside className="panel space-y-4 p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/[0.08] text-accent">
                <Signature size={17} strokeWidth={1.9} />
              </span>
              <div>
                <h2 className="text-[13px] font-semibold text-white">Signature Stamper</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
                  Coret tanda tangan langsung dengan mouse atau jari, atau upload
                  PNG transparan. Atur posisi dan ukurannya, lalu unduh PDF final.
                </p>
              </div>
            </div>

            <ol className="space-y-3">
              {[
                ['01', 'Upload PDF', 'Semua halaman dirender lokal di canvas.'],
                ['02', 'Coret / upload & atur', 'Gambar langsung atau upload PNG; geser dan atur ukuran.'],
                ['03', 'Unduh PDF', 'pdf-lib menanamkan gambar tanda tangan ke halaman.'],
              ].map(([step, title, text]) => (
                <li key={step} className="flex gap-3">
                  <span className="mt-0.5 font-mono text-[9.5px] text-accent/70">{step}</span>
                  <div>
                    <p className="text-[11px] font-medium text-ink-200">{title}</p>
                    <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-500">{text}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="flex items-center gap-2 rounded-lg border border-white/[0.055] bg-white/[0.02] px-3 py-2">
              <Lock size={12} className="text-accent/80" />
              <p className="text-[10px] text-ink-500">
                Dokumen dan tanda tangan tidak pernah diunggah.
              </p>
            </div>
          </aside>
        </div>

        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void handlePdfFile(file)
          }}
        />
      </div>
    )
  }

  return (
    <div className="animate-fade-up grid gap-5 min-[1200px]:grid-cols-[minmax(0,1fr)_378px]">
      <div className="min-w-0 space-y-4">
        <section className="panel overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.055] px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                <FileText size={14} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium text-ink-100">{pdf.name}</p>
                <p className="font-mono text-[9.5px] text-ink-500">
                  {pdf.pageCount} halaman · {formatBytes(pdf.size)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="btn-ghost !px-2.5 !py-1.5 !text-[10.5px]"
                onClick={() => pdfInputRef.current?.click()}
                disabled={busy}
              >
                <Upload size={11} />
                Ganti
              </button>
              <button
                type="button"
                className="icon-btn hover:!border-danger/40 hover:!text-danger"
                onClick={removePdf}
                disabled={busy}
                aria-label="Hapus PDF"
                title="Hapus PDF"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </header>

          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05] bg-ink-950/30 px-4 py-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="icon-btn size-7"
                onClick={() => setPageIndex((value) => Math.max(0, value - 1))}
                disabled={pageIndex === 0 || busy}
                aria-label="Halaman sebelumnya"
              >
                <ChevronLeft size={13} />
              </button>
              <select
                value={pageIndex}
                onChange={(event) => setPageIndex(Number(event.target.value))}
                disabled={busy}
                aria-label="Pilih halaman"
                className="rounded-lg border border-white/[0.08] bg-ink-950 px-2 py-1.5 font-mono text-[10.5px] text-ink-200 outline-none focus:border-accent/40"
              >
                {Array.from({ length: pdf.pageCount }, (_, index) => (
                  <option key={index} value={index}>
                    Halaman {index + 1}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn size-7"
                onClick={() =>
                  setPageIndex((value) => Math.min(pdf.pageCount - 1, value + 1))
                }
                disabled={pageIndex >= pdf.pageCount - 1 || busy}
                aria-label="Halaman berikutnya"
              >
                <ChevronRight size={13} />
              </button>
            </div>

            <div className="flex items-center gap-3 font-mono text-[9px] text-ink-500">
              <span>
                {pageIndex + 1} / {pdf.pageCount}
              </span>
              {pageRotation !== 0 ? <span>rotasi {pageRotation}°</span> : null}
              <span className="hidden sm:inline">preview pdf.js</span>
            </div>
          </div>

          <div className="checkerboard flex min-h-[340px] items-center justify-center p-3 sm:p-5">
            <div
              ref={pageWrapRef}
              className="relative inline-block max-w-full leading-none"
            >
              <canvas
                ref={canvasRef}
                className="block h-auto max-h-[58vh] w-auto max-w-full rounded-md bg-white shadow-[0_24px_80px_-24px_rgba(0,0,0,.95)] ring-1 ring-white/10"
              />

              {signature && pageSize ? (
                <div
                  role="group"
                  aria-label="Posisi tanda tangan"
                  onPointerDown={handleMovePointerDown}
                  onPointerMove={handleMovePointerMove}
                  onPointerUp={handleMovePointerUp}
                  onPointerCancel={handleMovePointerUp}
                  className="absolute cursor-move touch-none rounded-sm border border-dashed border-accent/80 bg-accent/[0.06] shadow-[0_0_0_1px_rgba(6,7,10,.5)]"
                  style={{
                    left: `${placement.x}%`,
                    top: `${placement.y}%`,
                    width: `${placement.w}%`,
                    height: `${placement.h}%`,
                  }}
                >
                  <img
                    src={signature.url}
                    alt="Tanda tangan"
                    className="pointer-events-none h-full w-full object-fill select-none"
                    draggable={false}
                  />
                  <span className="pointer-events-none absolute -top-4 left-0 rounded-sm bg-accent px-1 py-0.5 font-mono text-[8px] font-semibold text-ink-950">
                    TTD
                  </span>
                  <span
                    onPointerDown={handleResizePointerDown}
                    onPointerMove={handleResizePointerMove}
                    onPointerUp={handleResizePointerUp}
                    onPointerCancel={handleResizePointerUp}
                    role="presentation"
                    className="absolute -right-1.5 -bottom-1.5 size-3.5 cursor-nwse-resize rounded-sm border border-ink-950 bg-accent shadow-[0_0_0_1px_rgba(94,234,212,.5)]"
                  />
                </div>
              ) : null}

              {rendering ? (
                <div className="absolute inset-0 grid place-items-center rounded-md bg-ink-950/45">
                  <Loader2 size={20} className="animate-spin text-accent" />
                </div>
              ) : null}

              {!signature && !rendering ? (
                <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-lg border border-white/[0.12] bg-ink-950/85 px-3 py-2 text-center text-[10px] text-ink-300 backdrop-blur">
                  Upload tanda tangan untuk mulai menempatkannya di halaman ini.
                </div>
              ) : null}
            </div>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.055] px-4 py-2.5 text-[9.5px] text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck size={10} className="text-accent/60" />
              PDF asli tidak diunggah; lapisan tanda tangan ditambahkan di browser.
            </span>
            <span className="font-mono">PAGE {pageIndex + 1}</span>
          </footer>
        </section>

        {notice ? (
          <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[11px] text-danger">
            <AlertTriangle size={13} className="mt-px shrink-0" />
            <span>{notice}</span>
          </div>
        ) : null}
      </div>

      <aside className="min-w-0 space-y-4">
        <section className="panel overflow-hidden">
          <header className="flex items-center justify-between border-b border-white/[0.055] px-4 py-3">
            <div className="flex items-center gap-2">
              <Signature size={14} className="text-accent" />
              <h2 className="text-[12.5px] font-semibold text-white">Tanda tangan</h2>
            </div>
            {signature ? (
              <button
                type="button"
                className="btn-quiet !text-[10px] hover:!text-danger"
                onClick={removeSignature}
                disabled={busy}
              >
                <Trash2 size={11} />
                Hapus
              </button>
            ) : null}
          </header>

          <div className="space-y-4 p-4">
            {!signature ? (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="eyebrow">Coret langsung</p>
                    <span className="font-mono text-[8.5px] tracking-wide text-ink-500 uppercase">
                      Mouse / sentuh
                    </span>
                  </div>
                  <SignaturePad
                    disabled={busy || rendering}
                    onApply={(payload) => void applyPadSignature(payload)}
                  />
                </div>

                <div className="flex items-center gap-2 text-[9px] tracking-wide text-ink-600 uppercase">
                  <span className="h-px flex-1 bg-white/[0.06]" />
                  atau upload gambar
                  <span className="h-px flex-1 bg-white/[0.06]" />
                </div>

                <Dropzone
                  compact
                  accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                  icon={ImagePlus}
                  onFiles={(files) => {
                    const file = files[0]
                    if (file) void handleSignatureFile(file)
                  }}
                  title="Upload tanda tangan"
                  subtitle="PNG transparan lebih disarankan"
                  hint="PNG / JPG"
                  busy={loadingSignature}
                />
                <p className="text-[9.5px] leading-relaxed text-ink-500">
                  Gunakan PNG dengan latar transparan agar tanda tangan menyatu
                  dengan dokumen.
                </p>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-white/[0.07] bg-ink-950 p-2">
                  <div className="checkerboard flex h-20 items-center justify-center rounded-lg p-2">
                    <img
                      src={signature.url}
                      alt={signature.name}
                      className="max-h-full max-w-full object-contain"
                      draggable={false}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 px-1 pt-2">
                    <div className="min-w-0">
                      <p className="truncate text-[10px] text-ink-300">{signature.name}</p>
                      <p className="font-mono text-[8.5px] text-ink-500">
                        {signature.width}×{signature.height} · {formatBytes(signature.size)}
                      </p>
                    </div>
                    <ImageSourcePicker
                      accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                      disabled={busy}
                      onFiles={(files) => {
                        const file = files[0]
                        if (file) void handleSignatureFile(file)
                      }}
                    >
                      {(openPicker) => (
                        <button
                          type="button"
                          className="btn-ghost !px-2 !py-1 !text-[9.5px]"
                          onClick={openPicker}
                          disabled={busy}
                        >
                          Ganti
                        </button>
                      )}
                    </ImageSourcePicker>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] text-ink-400">Jaga rasio tanda tangan</p>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={aspectLocked}
                    onClick={toggleAspectLock}
                    className={cn(
                      'relative h-5 w-9 rounded-full border transition',
                      aspectLocked
                        ? 'border-accent/40 bg-accent/20'
                        : 'border-white/[0.1] bg-white/[0.04]',
                    )}
                    title="Kunci rasio lebar dan tinggi"
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 size-3.5 rounded-full transition-all',
                        aspectLocked ? 'left-[18px] bg-accent' : 'left-0.5 bg-ink-400',
                      )}
                    />
                  </button>
                </div>

                <SliderField
                  label="Posisi X"
                  value={Math.round(placement.x)}
                  min={0}
                  max={Math.max(0, Math.round(100 - placement.w))}
                  step={1}
                  display={`${Math.round(placement.x)}%`}
                  onChange={(value) =>
                    setPlacement((previous) =>
                      clampPlacement({ ...previous, x: value }),
                    )
                  }
                  disabled={busy}
                />
                <SliderField
                  label="Posisi Y"
                  value={Math.round(placement.y)}
                  min={0}
                  max={Math.max(0, Math.round(100 - placement.h))}
                  step={1}
                  display={`${Math.round(placement.y)}%`}
                  onChange={(value) =>
                    setPlacement((previous) =>
                      clampPlacement({ ...previous, y: value }),
                    )
                  }
                  disabled={busy}
                />
                <SliderField
                  label="Lebar"
                  value={Math.round(placement.w)}
                  min={3}
                  max={Math.max(3, Math.round(100 - placement.x))}
                  step={1}
                  display={`${Math.round(placement.w)}%`}
                  onChange={updateWidth}
                  disabled={busy}
                />
                <SliderField
                  label="Tinggi"
                  value={Math.round(placement.h)}
                  min={2}
                  max={Math.max(2, Math.round(100 - placement.y))}
                  step={1}
                  display={`${Math.round(placement.h)}%`}
                  onChange={updateHeight}
                  disabled={busy}
                />

                <button
                  type="button"
                  className="btn-quiet w-full !text-[10px]"
                  onClick={resetPlacement}
                  disabled={busy}
                >
                  <RotateCcw size={11} />
                  Reset posisi
                </button>
              </>
            )}
          </div>
        </section>

        <section className="panel space-y-3 p-4">
          <button
            type="button"
            className="btn-primary w-full !py-3"
            onClick={() => void handleStamperExport()}
            disabled={!signature || busy || rendering}
          >
            {exporting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Menempelkan tanda tangan…
              </>
            ) : (
              <>
                <Download size={14} />
                Download PDF Bertanda Tangan
              </>
            )}
          </button>

          {signature && pageSize ? (
            <p className="text-center font-mono text-[9px] text-ink-500">
              X {Math.round(placement.x)} · Y {Math.round(placement.y)} · W{' '}
              {Math.round(placement.w)} · H {Math.round(placement.h)} (%)
            </p>
          ) : null}

          {exportInfo ? (
            <p className="flex items-start gap-1.5 text-[10px] leading-relaxed break-all text-accent/90">
              <CheckCircle2 size={11} className="mt-px shrink-0" />
              {exportInfo}
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-[9.5px] leading-relaxed text-ink-500">
              <Lock size={10} className="mt-0.5 shrink-0 text-accent/60" />
              Tanda tangan ditanam langsung ke halaman terpilih. PDF lain tidak
              berubah.
            </p>
          )}
        </section>

        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void handlePdfFile(file)
          }}
        />
      </aside>
    </div>
  )
}
