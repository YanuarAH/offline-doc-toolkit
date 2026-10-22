import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Cpu,
  Download,
  FileArchive,
  FileText,
  Gauge,
  Info,
  Loader2,
  Lock,
  Printer,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react'
import { Dropzone } from '../components/Dropzone'
import {
  PDF_QUALITY_PRESET_LIST,
  PDF_QUALITY_PRESETS,
  compressPdfWithGhostscript,
  isGhostscriptReady,
  loadGhostscript,
  type GhostscriptCompressionResult,
  type PdfQualityPreset,
  type PdfQualityPresetId,
} from '../lib/ghostscript'
import {
  cn,
  compactDay,
  downloadBlob,
  errorMessage,
  formatBytes,
  sanitizeBaseName,
  savingsPercent,
} from '../lib/format'

interface LoadedPdf {
  name: string
  size: number
  bytes: Uint8Array
}

interface CompressionResultView {
  blob: Blob
  filename: string
  originalBytes: number
  outputBytes: number
  ghostscriptBytes: number
  keptOriginal: boolean
  preset: PdfQualityPreset
  durationMs: number
}

type Phase = 'idle' | 'loading-engine' | 'compressing' | 'done' | 'error'

function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false
  const head = new TextDecoder().decode(bytes.subarray(0, 1024))
  return head.includes('%PDF-')
}

function durationLabel(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} dtk`
}

export function PdfCompressor() {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null)
  const [presetId, setPresetId] = useState<PdfQualityPresetId>('recommended')
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<CompressionResultView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [engineLoaded, setEngineLoaded] = useState(() => isGhostscriptReady())

  const inputRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(true)
  const jobRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      jobRef.current += 1
    }
  }, [])

  const busy = phase === 'loading-engine' || phase === 'compressing'
  const preset = PDF_QUALITY_PRESETS[presetId]
  const savings = result
    ? savingsPercent(result.originalBytes, result.outputBytes)
    : 0

  function clearResult() {
    jobRef.current += 1
    setResult(null)
    setError(null)
    setPhase('idle')
  }

  async function handlePdfFile(file: File) {
    if (!file.type.includes('pdf') && !/\.pdf$/i.test(file.name)) {
      setError('File harus berupa PDF.')
      return
    }

    clearResult()

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (!bytes.length) throw new Error('File PDF kosong.')
      if (!looksLikePdf(bytes)) {
        throw new Error('File tidak terlihat sebagai PDF yang valid.')
      }

      if (!mountedRef.current) return
      setPdf({ name: file.name, size: file.size, bytes })
    } catch (loadError) {
      if (mountedRef.current) setError(errorMessage(loadError))
    }
  }

  function removePdf() {
    if (busy) return
    jobRef.current += 1
    setPdf(null)
    setResult(null)
    setError(null)
    setPhase('idle')
  }

  function choosePreset(next: PdfQualityPresetId) {
    if (busy || next === presetId) return
    setPresetId(next)
    clearResult()
  }

  async function handleCompress() {
    if (!pdf || busy) return

    setResult(null)
    setError(null)
    const job = jobRef.current + 1
    jobRef.current = job
    const selectedPreset = preset

    try {
      if (!isGhostscriptReady()) {
        setPhase('loading-engine')
        await loadGhostscript()
        if (!mountedRef.current || job !== jobRef.current) return
        setEngineLoaded(true)
      }

      setPhase('compressing')
      // Beri satu frame agar status loading sempat dilukis sebelum callMain
      // Ghostscript memblokir main thread.
      await new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), 80)
      })
      if (!mountedRef.current || job !== jobRef.current) return

      const compressed: GhostscriptCompressionResult =
        await compressPdfWithGhostscript(pdf.bytes, selectedPreset.id)
      if (!mountedRef.current || job !== jobRef.current) return

      const blob = new Blob([new Uint8Array(compressed.bytes)], {
        type: 'application/pdf',
      })
      const filename = compressed.keptOriginal
        ? pdf.name
        : `${sanitizeBaseName(pdf.name)}-${compressed.preset}-${compactDay(
            new Date(),
          )}.pdf`

      setResult({
        blob,
        filename,
        originalBytes: pdf.size,
        outputBytes: compressed.bytes.length,
        ghostscriptBytes: compressed.ghostscriptBytes,
        keptOriginal: compressed.keptOriginal,
        preset: selectedPreset,
        durationMs: compressed.durationMs,
      })
      setPhase('done')
      setEngineLoaded(true)
    } catch (compressionError) {
      if (
        compressionError instanceof DOMException &&
        compressionError.name === 'AbortError'
      ) {
        return
      }
      if (mountedRef.current && job === jobRef.current) {
        setError(errorMessage(compressionError))
        setPhase('error')
      }
    }
  }

  function downloadResult() {
    if (!result) return
    downloadBlob(result.blob, result.filename)
  }

  return (
    <div className="animate-fade-up space-y-5">
      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[11px] text-danger">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
          <button
            type="button"
            className="ml-auto shrink-0 text-danger/70 hover:text-danger"
            onClick={() => setError(null)}
            aria-label="Tutup pesan"
          >
            <X size={12} />
          </button>
        </div>
      ) : null}

      {!pdf ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="panel bg-noise relative overflow-hidden p-2">
            <div className="pointer-events-none absolute inset-0 grid-lines opacity-30" />
            <div className="relative">
              <Dropzone
                accept="application/pdf,.pdf"
                icon={FileArchive}
                onFiles={(files) => {
                  const file = files[0]
                  if (file) void handlePdfFile(file)
                }}
                title="Tarik PDF untuk dikompres"
                subtitle="Ghostscript WASM · 3 level kualitas · tanpa upload"
                hint="PDF · Extreme / Recommended / Less · diproses lokal"
                busy={busy}
              />
            </div>
          </div>

          <aside className="panel space-y-4 p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/[0.08] text-accent">
                <Cpu size={17} strokeWidth={1.9} />
              </span>
              <div>
                <h2 className="text-[13px] font-semibold text-white">
                  Ghostscript WASM
                </h2>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
                  Kompresi PDF asli, bukan rasterisasi canvas. Teks dan vektor
                  tetap dipertahankan; hanya gambar yang dioptimasi.
                </p>
              </div>
            </div>

            <div className="grid gap-2">
              {PDF_QUALITY_PRESET_LIST.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.055] bg-white/[0.02] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[10.5px] font-medium text-ink-200">
                      {item.label}
                    </p>
                    <p className="mt-0.5 text-[9.5px] text-ink-500">
                      {item.subtitle}
                    </p>
                  </div>
                  <span className="shrink-0 rounded border border-white/[0.07] bg-ink-950/60 px-1.5 py-0.5 font-mono text-[8.5px] text-ink-400">
                    {item.dpi} DPI
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-accent/15 bg-accent/[0.035] px-3 py-2.5">
              <Cpu size={12} className="mt-0.5 shrink-0 text-accent" />
              <p className="text-[10px] leading-relaxed text-ink-400">
                Mesin ±16 MB dimuat <span className="text-ink-200">on-demand</span>{' '}
                saat tombol kompres ditekan, lalu disimpan di cache PWA untuk
                pemakaian offline.
              </p>
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-white/[0.055] bg-white/[0.02] px-3 py-2">
              <ShieldCheck size={12} className="text-accent/80" />
              <p className="text-[10px] text-ink-500">
                File tidak pernah dikirim ke server.
              </p>
            </div>
          </aside>
        </div>
      ) : (
        <div className="grid gap-5 min-[1200px]:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-4">
            <section className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                  <FileText size={15} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-medium text-ink-100">
                    {pdf.name}
                  </p>
                  <p className="font-mono text-[9.5px] text-ink-500">
                    {formatBytes(pdf.size)} · PDF asli · siap dikompres
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="btn-ghost !px-2.5 !py-1.5 !text-[10.5px]"
                  onClick={() => inputRef.current?.click()}
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
            </section>

            <section className="panel overflow-hidden">
              <header className="flex items-center justify-between border-b border-white/[0.055] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Gauge size={14} className="text-accent" />
                  <h2 className="text-[12.5px] font-semibold text-white">
                    Tingkat kompresi
                  </h2>
                </div>
                <span className="value-badge">3 level</span>
              </header>

              <div className="space-y-4 p-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  {PDF_QUALITY_PRESET_LIST.map((item) => {
                    const Icon =
                      item.id === 'extreme'
                        ? Zap
                        : item.id === 'recommended'
                          ? Sparkles
                          : Printer
                    const active = presetId === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={active}
                        disabled={busy}
                        onClick={() => choosePreset(item.id)}
                        className={cn(
                          'flex h-full flex-col rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50',
                          active
                            ? 'border-accent/40 bg-accent/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,.05)]'
                            : 'border-white/[0.065] bg-white/[0.018] hover:border-white/[0.13] hover:bg-white/[0.03]',
                        )}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span
                            className={cn(
                              'grid size-8 place-items-center rounded-lg border',
                              active
                                ? 'border-accent/25 bg-accent/10 text-accent'
                                : 'border-white/[0.06] bg-white/[0.02] text-ink-400',
                            )}
                          >
                            <Icon size={14} strokeWidth={1.9} />
                          </span>
                          <span
                            className={cn(
                              'rounded border px-1.5 py-0.5 font-mono text-[8.5px]',
                              active
                                ? 'border-accent/20 bg-accent/[0.06] text-accent'
                                : 'border-white/[0.07] bg-ink-950/60 text-ink-500',
                            )}
                          >
                            {item.dpi} DPI
                          </span>
                        </span>

                        <span className="mt-2.5 block">
                          <span
                            className={cn(
                              'block text-[11px] leading-snug font-semibold',
                              active ? 'text-accent' : 'text-ink-200',
                            )}
                          >
                            {item.label}
                          </span>
                          <span className="mt-0.5 block text-[9px] leading-snug text-ink-500">
                            {item.subtitle}
                          </span>
                        </span>

                        <span className="mt-2 block text-[9.5px] leading-relaxed text-ink-500">
                          {item.description}
                        </span>

                        <span className="mt-auto flex items-center gap-1 pt-2.5">
                          {active ? (
                            <>
                              <Check size={10} className="shrink-0 text-accent" />
                              <span className="text-[8.5px] tracking-wide text-accent uppercase">
                                Dipilih
                              </span>
                            </>
                          ) : (
                            <span className="text-[8.5px] tracking-wide text-ink-600 uppercase">
                              Pilih level
                            </span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <div className="flex items-start gap-2 rounded-lg border border-accent/15 bg-accent/[0.035] px-3 py-2.5">
                  <Info size={12} className="mt-0.5 shrink-0 text-accent/80" />
                  <p className="text-[10px] leading-relaxed text-ink-400">
                    Ghostscript mempertahankan teks & vektor. Hanya gambar berlebih
                    yang di-resample sesuai level DPI — teks tetap bisa di-copy.
                  </p>
                </div>

                <button
                  type="button"
                  className="btn-primary w-full !py-3"
                  onClick={() => void handleCompress()}
                  disabled={busy}
                >
                  {phase === 'loading-engine' ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Memuat Mesin Ghostscript WASM...
                    </>
                  ) : phase === 'compressing' ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Mengompres PDF...
                    </>
                  ) : (
                    <>
                      <Cpu size={14} />
                      Kompres PDF
                    </>
                  )}
                </button>

                {busy ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className="space-y-2 rounded-lg border border-accent/15 bg-accent/[0.035] p-3"
                  >
                    <div className="flex items-center justify-between gap-2 text-[10.5px]">
                      <span className="flex items-center gap-1.5 font-medium text-accent">
                        <Loader2 size={11} className="animate-spin" />
                        {phase === 'loading-engine'
                          ? 'Memuat Mesin Ghostscript WASM...'
                          : 'Mengompres PDF...'}
                      </span>
                      <span className="font-mono text-[9px] tracking-wide text-ink-500 uppercase">
                        Ghostscript
                      </span>
                    </div>
                    <p className="text-[9.5px] leading-relaxed text-ink-500">
                      {phase === 'loading-engine'
                        ? 'Menyiapkan mesin ±16 MB. Ini hanya sekali; setelah itu tersimpan untuk offline.'
                        : `${preset.label} · ${preset.dpi} DPI. Proses berjalan sepenuhnya di perangkat ini.`}
                    </p>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full w-1/2 animate-pulse rounded-full bg-accent/70" />
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <aside className="min-w-0 space-y-4">
            <section className="panel overflow-hidden">
              <header className="flex items-center justify-between border-b border-white/[0.055] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Gauge size={14} className="text-accent" />
                  <h2 className="text-[12.5px] font-semibold text-white">
                    Hasil kompresi
                  </h2>
                </div>
                {result ? (
                  result.keptOriginal ? (
                    <span className="inline-flex items-center gap-1 rounded border border-warn/25 bg-warn/[0.07] px-1.5 py-0.5 text-[8.5px] tracking-wide text-warn uppercase">
                      <Info size={8} />
                      sudah optimal
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded border border-accent/20 bg-accent/[0.06] px-1.5 py-0.5 text-[8.5px] tracking-wide text-accent uppercase">
                      <CheckCircle2 size={8} />
                      lebih kecil
                    </span>
                  )
                ) : null}
              </header>

              <div className="space-y-4 p-4">
                {!result ? (
                  <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-white/[0.1] px-4 py-10 text-center">
                    <span className="grid size-10 place-items-center rounded-full border border-white/[0.07] bg-white/[0.02] text-ink-600">
                      <FileArchive size={18} />
                    </span>
                    <div>
                      <p className="text-[11.5px] font-medium text-ink-300">
                        Belum ada hasil
                      </p>
                      <p className="mt-1 text-[10px] leading-relaxed text-ink-500">
                        Pilih level kompresi, lalu tekan Kompres PDF. Perbandingan
                        before/after akan muncul di sini.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="rounded-xl border border-white/[0.055] bg-white/[0.02] p-3">
                        <p className="eyebrow">Before</p>
                        <p className="mt-1.5 font-mono text-[16px] text-ink-200">
                          {formatBytes(result.originalBytes)}
                        </p>
                        <p className="mt-1 text-[9px] text-ink-500">PDF asli</p>
                      </div>
                      <div className="rounded-xl border border-accent/20 bg-accent/[0.05] p-3">
                        <p className="eyebrow text-accent/70">After</p>
                        <p className="mt-1.5 font-mono text-[16px] text-accent">
                          {formatBytes(result.outputBytes)}
                        </p>
                        <p className="mt-1 text-[9px] text-ink-500">
                          {result.keptOriginal
                            ? 'File asli dipertahankan'
                            : `${result.preset.dpi} DPI · hasil Ghostscript`}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-white/[0.055] bg-ink-950/50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-ink-400">
                          Penghematan
                        </span>
                        <span
                          className={cn(
                            'font-mono text-[15px]',
                            result.keptOriginal ? 'text-ink-300' : 'text-accent',
                          )}
                        >
                          {result.keptOriginal
                            ? '0.0%'
                            : `${savings.toFixed(1)}%`}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className="h-full rounded-full bg-accent/80"
                          style={{
                            width: `${Math.min(100, Math.max(0, savings))}%`,
                          }}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[9px] text-ink-500">
                        <span>{result.preset.label}</span>
                        <span className="font-mono">
                          {durationLabel(result.durationMs)}
                        </span>
                      </div>
                    </div>

                    {result.keptOriginal ? (
                      <div className="space-y-1.5 rounded-lg border border-warn/25 bg-warn/[0.06] px-3 py-2.5">
                        <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-warn/95">
                          <Info size={12} className="mt-0.5 shrink-0" />
                          PDF ini sudah berada pada ukuran paling optimal (teks/vektor murni).
                        </p>
                        <p className="pl-[18px] text-[9px] leading-relaxed text-warn/70">
                          Output Ghostscript {formatBytes(result.ghostscriptBytes)},
                          tidak lebih kecil dari file asli.
                        </p>
                      </div>
                    ) : null}

                    <div>
                      <p className="text-[9px] text-ink-500">Nama file</p>
                      <p
                        className="mt-0.5 truncate font-mono text-[9.5px] text-ink-300"
                        title={result.filename}
                      >
                        {result.filename}
                      </p>
                    </div>

                    <button
                      type="button"
                      className="btn-primary w-full !py-3"
                      onClick={downloadResult}
                    >
                      <Download size={14} />
                      {result.keptOriginal
                        ? 'Download PDF asli'
                        : 'Download PDF hasil kompresi'}
                    </button>
                  </>
                )}

                <p className="flex items-start gap-1.5 border-t border-white/[0.055] pt-3 text-[9px] leading-relaxed text-ink-500">
                  <Lock size={9} className="mt-0.5 shrink-0 text-accent/60" />
                  PDF tidak pernah dikirim ke server. Ghostscript berjalan di
                  memori browser dan file sementara dibersihkan setelah proses.
                </p>
              </div>
            </section>

            <section className="panel p-4">
              <div className="flex items-start gap-2">
                <Cpu size={12} className="mt-0.5 shrink-0 text-accent" />
                <div>
                  <p className="flex items-center gap-1.5 text-[10px] font-medium text-ink-300">
                    Mesin Ghostscript
                    <span
                      className={cn(
                        'rounded border px-1 py-px font-mono text-[7.5px] tracking-wide uppercase',
                        engineLoaded
                          ? 'border-accent/20 bg-accent/[0.06] text-accent'
                          : 'border-white/[0.07] bg-white/[0.02] text-ink-500',
                      )}
                    >
                      {engineLoaded ? 'aktif' : 'on-demand'}
                    </span>
                  </p>
                  <p className="mt-1 text-[9.5px] leading-relaxed text-ink-500">
                    {engineLoaded
                      ? 'WASM sudah dimuat di tab ini. Kompres berikutnya tidak perlu mengunduh ulang.'
                      : 'WASM ±16 MB hanya dimuat saat kompres pertama. Setelah itu tersimpan di cache PWA untuk offline.'}
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </div>
      )}

      <input
        ref={inputRef}
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
