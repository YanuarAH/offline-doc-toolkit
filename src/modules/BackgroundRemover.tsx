import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  ImageOff,
  ImagePlus,
  Loader2,
  Lock,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react'
import { Dropzone } from '../components/Dropzone'
import { Segmented } from '../components/Controls'
import {
  ACCEPTED_LABEL,
  ACCEPT_ATTRIBUTE,
  FIRST_LOAD_MB,
  MAX_FILE_BYTES,
  MODEL_INFO,
  MODEL_MB,
  RUNTIME_MB,
  checkSupport,
  inspectImage,
  isModelCached,
  removeBackground,
  type InspectedImage,
  type RemovalProgress,
  type RemovalResult,
} from '../lib/backgroundRemoval'
import { cn, downloadBlob, formatBytes, sanitizeBaseName } from '../lib/format'

type ViewMode = 'before' | 'after'
type Backdrop = 'transparent' | 'white' | 'blue'

const BACKDROP_STYLE: Record<Backdrop, string | undefined> = {
  transparent: undefined,
  white: '#f8fafc',
  blue: '#2563eb',
}

interface ProgressView {
  label: string
  hint: string
  percent: number | null
}

function describeProgress(progress: RemovalProgress | null): ProgressView {
  if (!progress) {
    return {
      label: 'Removing background…',
      hint: 'Waktu proses bergantung pada perangkat dan ukuran gambar.',
      percent: null,
    }
  }

  if (progress.stage === 'preparing') {
    return {
      label: progress.phase === 'runtime' ? 'Menyiapkan runtime AI…' : 'Mengunduh model AI…',
      hint:
        progress.phase === 'runtime'
          ? `Runtime ONNX Runtime (±${RUNTIME_MB} MB) cukup diunduh sekali, lalu tersimpan di perangkat ini.`
          : `Bobot ${MODEL_INFO.name} (±${MODEL_MB} MB) diunduh sekali saja dan di-cache untuk pemakaian offline.`,
      percent: progress.percent,
    }
  }

  if (progress.stage === 'encoding') {
    return {
      label: 'Menyimpan PNG transparan…',
      hint: 'Channel alpha dipertahankan agar latar benar-benar transparan.',
      percent: null,
    }
  }

  return {
    label: 'Removing background…',
    hint: 'Waktu proses bergantung pada perangkat dan ukuran gambar. Jangan tutup tab ini.',
    percent: null,
  }
}

export function BackgroundRemover() {
  const [image, setImage] = useState<InspectedImage | null>(null)
  const [srcUrl, setSrcUrl] = useState<string | null>(null)
  const [result, setResult] = useState<RemovalResult | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [progress, setProgress] = useState<RemovalProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('after')
  const [backdrop, setBackdrop] = useState<Backdrop>('transparent')
  const [unsupported] = useState<string | null>(() => checkSupport())
  const [modelCached, setModelCached] = useState<boolean | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  const urlsRef = useRef<Set<string>>(new Set())
  const srcUrlRef = useRef<string | null>(null)
  const resultUrlRef = useRef<string | null>(null)

  useEffect(() => {
    mountedRef.current = true

    let cancelled = false
    void isModelCached().then((cached) => {
      if (!cancelled && mountedRef.current) setModelCached(cached)
    })

    const urls = urlsRef.current
    return () => {
      cancelled = true
      mountedRef.current = false
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
      srcUrlRef.current = null
      resultUrlRef.current = null
    }
  }, [])

  function trackUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob)
    urlsRef.current.add(url)
    return url
  }

  function revoke(url: string | null) {
    if (!url) return
    URL.revokeObjectURL(url)
    urlsRef.current.delete(url)
  }

  function clearResult() {
    revoke(resultUrlRef.current)
    resultUrlRef.current = null
    setResultUrl(null)
    setResult(null)
    setView('after')
    setProgress(null)
  }

  function clearAll() {
    clearResult()
    revoke(srcUrlRef.current)
    srcUrlRef.current = null
    setSrcUrl(null)
    setImage(null)
    setError(null)
  }

  function openPicker() {
    if (busyRef.current) return
    inputRef.current?.click()
  }

  async function pickFile(file: File) {
    if (busyRef.current) return
    setError(null)
    clearResult()

    try {
      const inspected = await inspectImage(file)
      if (!mountedRef.current) return

      revoke(srcUrlRef.current)
      const url = trackUrl(file)
      srcUrlRef.current = url

      setSrcUrl(url)
      setImage(inspected)
      setView('before')
    } catch (inspectError) {
      if (!mountedRef.current) return
      revoke(srcUrlRef.current)
      srcUrlRef.current = null
      setSrcUrl(null)
      setImage(null)
      setError(
        inspectError instanceof Error && inspectError.message
          ? inspectError.message
          : 'Gambar tidak bisa dibaca. Coba file lain.',
      )
    }
  }

  async function removeBackgroundNow() {
    if (!image || busyRef.current) return

    busyRef.current = true
    setBusy(true)
    setError(null)
    setProgress({ stage: 'preparing', phase: 'runtime', percent: null })

    try {
      const output = await removeBackground(image, {
        onProgress: (next) => {
          if (mountedRef.current) setProgress(next)
        },
      })
      if (!mountedRef.current) return

      const url = trackUrl(output.blob)
      revoke(resultUrlRef.current)
      resultUrlRef.current = url

      setResult(output)
      setResultUrl(url)
      setView('after')
      setBackdrop('transparent')
      setModelCached(true)
    } catch (removalError) {
      if (!mountedRef.current) return
      setError(
        removalError instanceof Error && removalError.message
          ? removalError.message
          : 'Gagal menghapus background. Coba lagi.',
      )
    } finally {
      busyRef.current = false
      if (mountedRef.current) {
        setBusy(false)
        setProgress(null)
      }
    }
  }

  function download() {
    if (!result || !image) return
    downloadBlob(result.blob, `${sanitizeBaseName(image.file.name)}-no-bg.png`)
  }

  const progressView = describeProgress(progress)

  if (unsupported) {
    return (
      <div className="animate-fade-up">
        <section className="panel mx-auto max-w-xl space-y-4 p-6 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-warn/25 bg-warn/[0.07] text-warn">
            <ImageOff size={22} strokeWidth={1.8} />
          </span>
          <div className="space-y-1.5">
            <h2 className="text-[14px] font-semibold text-white">Browser belum didukung</h2>
            <p className="text-[11.5px] leading-relaxed text-ink-400">{unsupported}</p>
          </div>
          <p className="font-mono text-[9.5px] text-ink-500">
            Butuh WebAssembly + createImageBitmap + Canvas 2D
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className="animate-fade-up space-y-5">
      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/[0.06] px-3.5 py-2.5 text-[11.5px] text-danger">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            className="shrink-0 text-danger/70 transition hover:text-danger"
            onClick={() => setError(null)}
            aria-label="Tutup pesan"
          >
            <X size={13} />
          </button>
        </div>
      ) : null}

      {!image ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="panel bg-noise relative overflow-hidden p-2">
            <div className="pointer-events-none absolute inset-0 grid-lines opacity-30" />
            <div className="relative">
              <Dropzone
                icon={ScanLine}
                actionLabel="Browse Image"
                accept={ACCEPT_ATTRIBUTE}
                onFiles={(files) => {
                  const file = files[0]
                  if (file) void pickFile(file)
                }}
                title="Drop an image to remove its background"
                subtitle="Atau klik untuk memilih satu foto — subjek utama akan dipisahkan otomatis oleh model AI."
                hint={`${ACCEPTED_LABEL} · maksimal ${formatBytes(MAX_FILE_BYTES)} · diproses 100% di perangkat ini`}
                busy={busy}
              />
              <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-3">
                <span className="inline-flex items-center gap-1.5 font-mono text-[9.5px] text-ink-500">
                  <Lock size={9} className="text-accent/60" />
                  0 byte diunggah · PNG transparan
                </span>
                {modelCached === false ? (
                  <span className="inline-flex items-center gap-1.5 font-mono text-[9.5px] text-warn/80">
                    <HardDrive size={9} />
                    model ±{FIRST_LOAD_MB} MB diunduh saat pertama dipakai
                  </span>
                ) : modelCached ? (
                  <span className="inline-flex items-center gap-1.5 font-mono text-[9.5px] text-accent/80">
                    <CheckCircle2 size={9} />
                    model {MODEL_INFO.name} siap offline
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <aside className="panel space-y-4 p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/[0.08] text-accent">
                <Sparkles size={17} strokeWidth={1.9} />
              </span>
              <div>
                <h2 className="text-[13px] font-semibold text-white">AI di dalam browser</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
                  Satu model {MODEL_INFO.name} mencari objek paling menonjol di foto —
                  orang, produk, makanan, atau hewan — lalu memisahkannya dari latar.
                  Kualitas tepi lebih rapi, tetapi prosesnya lebih berat daripada model
                  320×320.
                </p>
              </div>
            </div>

            <ol className="space-y-3">
              {[
                {
                  icon: Cpu,
                  title: 'Berjalan lokal (WASM)',
                  text: 'Inferensi memakai ONNX Runtime Web di tab ini. Tidak ada API, API key, atau server.',
                },
                {
                  icon: HardDrive,
                  title: `Unduhan pertama ±${FIRST_LOAD_MB} MB`,
                  text: `Runtime ±${RUNTIME_MB} MB + bobot ±${MODEL_MB} MB disimpan browser, lalu dipakai ulang tanpa internet.`,
                },
                {
                  icon: Download,
                  title: 'Hasil PNG transparan',
                  text: 'Channel alpha asli dipertahankan, siap dipakai untuk desain atau katalog.',
                },
              ].map((item) => {
                const Icon = item.icon
                return (
                  <li key={item.title} className="flex gap-3">
                    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border border-white/[0.06] bg-white/[0.02] text-accent/80">
                      <Icon size={12} />
                    </span>
                    <div>
                      <p className="text-[11px] font-medium text-ink-200">{item.title}</p>
                      <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-500">
                        {item.text}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ol>

            <div className="rounded-lg border border-white/[0.055] bg-white/[0.02] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <ShieldCheck size={11} className="text-accent/70" />
                <p className="text-[10px] font-medium text-ink-300">
                  Gambar tidak pernah meninggalkan perangkat
                </p>
              </div>
              <p className="mt-1.5 font-mono text-[9px] text-ink-500">
                {MODEL_INFO.name} · {MODEL_INFO.license} · ONNX Runtime Web (MIT)
              </p>
            </div>
          </aside>
        </div>
      ) : result && resultUrl ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <section className="panel overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.055] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <CheckCircle2 size={14} className="shrink-0 text-accent" />
                <h2 className="truncate text-[12.5px] font-semibold text-white">
                  Background removed
                </h2>
                <span className="value-badge shrink-0">{formatBytes(result.blob.size)}</span>
              </div>
              <Segmented
                compact
                value={view}
                onChange={setView}
                options={[
                  { value: 'before', label: 'Before' },
                  { value: 'after', label: 'After' },
                ]}
                className="w-[168px] shrink-0"
              />
            </header>

            <div
              className={cn(
                'relative grid min-h-[280px] place-items-center p-3 sm:p-4',
                view === 'after' && backdrop === 'transparent' && 'checkerboard',
              )}
              style={{
                backgroundColor: view === 'after' ? BACKDROP_STYLE[backdrop] : undefined,
              }}
            >
              <img
                src={view === 'after' ? resultUrl : srcUrl ?? undefined}
                alt={
                  view === 'after'
                    ? `${image.file.name} tanpa latar belakang`
                    : image.file.name
                }
                className="max-h-[520px] w-auto max-w-full rounded-lg object-contain shadow-[0_18px_50px_-30px_rgba(0,0,0,0.9)]"
              />
              <span className="pointer-events-none absolute top-3 left-3 rounded-md border border-white/15 bg-ink-950/70 px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-ink-300 uppercase backdrop-blur">
                {view === 'after' ? 'After · transparent' : 'Before · original'}
              </span>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.055] px-4 py-3">
              {view === 'after' ? (
                <div className="flex items-center gap-2">
                  <span className="eyebrow">Preview</span>
                  <Segmented
                    compact
                    value={backdrop}
                    onChange={setBackdrop}
                    options={[
                      { value: 'transparent', label: 'Transparan' },
                      { value: 'white', label: 'Putih' },
                      { value: 'blue', label: 'Biru' },
                    ]}
                    className="w-[230px]"
                  />
                </div>
              ) : (
                <span className="text-[10px] text-ink-500">
                  Gambar asli — pilih <span className="text-ink-300">After</span> untuk
                  melihat hasil transparan.
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 text-[10px] text-ink-500">
                <Lock size={10} className="text-accent/60" />
                Warna preview tidak ikut tersimpan di PNG
              </span>
            </footer>
          </section>

          <aside className="panel space-y-4 p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/[0.08] text-accent">
                <Download size={17} strokeWidth={1.9} />
              </span>
              <div>
                <h2 className="text-[13px] font-semibold text-white">Siap diunduh</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
                  PNG dengan latar transparan, resolusi penuh {result.width}×{result.height}px.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="stat">
                <p className="text-[9.5px] tracking-wide text-ink-500 uppercase">Asli</p>
                <p className="mt-1 truncate font-mono text-[12px] text-ink-200">
                  {formatBytes(image.file.size)}
                </p>
              </div>
              <div className="stat">
                <p className="text-[9.5px] tracking-wide text-ink-500 uppercase">PNG</p>
                <p className="mt-1 truncate font-mono text-[12px] text-accent">
                  {formatBytes(result.blob.size)}
                </p>
              </div>
              <div className="stat col-span-2">
                <p className="text-[9.5px] tracking-wide text-ink-500 uppercase">File</p>
                <p className="mt-1 truncate text-[11px] text-ink-200">{image.file.name}</p>
                <p className="mt-0.5 font-mono text-[9.5px] text-ink-500">
                  {image.formatLabel} → PNG · {(result.durationMs / 1000).toFixed(1)}s
                </p>
              </div>
            </div>

            <button type="button" className="btn-primary w-full" onClick={download}>
              <Download size={14} />
              Download PNG
            </button>

            <div className="space-y-2">
              <button
                type="button"
                className="btn-ghost w-full"
                onClick={clearAll}
                disabled={busy}
              >
                <ScanLine size={14} />
                Remove Another Background
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="btn-ghost !px-3 !py-2 !text-[11.5px]"
                  onClick={openPicker}
                  disabled={busy}
                >
                  <ImagePlus size={13} />
                  Change Image
                </button>
                <button
                  type="button"
                  className="btn-ghost !px-3 !py-2 !text-[11.5px]"
                  onClick={clearAll}
                  disabled={busy}
                >
                  <RotateCcw size={13} />
                  Reset
                </button>
              </div>
            </div>

            <p className="border-t border-white/[0.055] pt-3 font-mono text-[9px] leading-relaxed text-ink-500">
              {MODEL_INFO.name} · {MODEL_INFO.license} · diproses lokal, tanpa upload
            </p>
          </aside>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <section className="panel overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.055] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <ImagePlus size={14} className="shrink-0 text-accent" />
                <h2 className="truncate text-[12.5px] font-semibold text-white">
                  {image.file.name}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="value-badge">{image.formatLabel}</span>
                <span className="pill !py-0.5">
                  {image.width}×{image.height}
                </span>
              </div>
            </header>

            <div className="checkerboard relative grid min-h-[280px] place-items-center p-3 sm:p-4">
              <img
                src={srcUrl ?? undefined}
                alt={image.file.name}
                className="max-h-[520px] w-auto max-w-full rounded-lg object-contain shadow-[0_18px_50px_-30px_rgba(0,0,0,0.9)]"
              />

              {busy ? (
                <div className="absolute inset-0 grid place-items-center bg-ink-950/75 px-4 backdrop-blur-[2px]">
                  <div className="w-full max-w-[360px] rounded-2xl border border-white/[0.09] bg-ink-900/95 p-4 text-center shadow-2xl">
                    <Loader2 size={20} className="mx-auto animate-spin text-accent" />
                    <p className="mt-3 text-[12.5px] font-semibold text-white">
                      {progressView.label}
                    </p>
                    <p className="mt-1 text-[10px] leading-relaxed text-ink-400">
                      {progressView.hint}
                    </p>

                    {progressView.percent !== null ? (
                      <div className="mt-3">
                        <div className="h-1 overflow-hidden rounded-full bg-white/[0.08]">
                          <div
                            className="h-full rounded-full bg-accent transition-[width] duration-300"
                            style={{ width: `${progressView.percent}%` }}
                          />
                        </div>
                        <p className="mt-1.5 font-mono text-[9px] text-ink-500">
                          {progressView.percent}%
                        </p>
                      </div>
                    ) : (
                      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.08]">
                        <div className="h-full w-1/3 animate-[soft-pulse_1.6s_ease-in-out_infinite] rounded-full bg-accent/70" />
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.055] px-4 py-3 text-[10px] text-ink-500">
              <span className="font-mono">
                {formatBytes(image.file.size)} · {image.width}×{image.height}px
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Lock size={10} className="text-accent/60" />
                File tetap di perangkat ini
              </span>
            </footer>
          </section>

          <aside className="panel space-y-4 p-5">
            <div>
              <span className="eyebrow">Langkah berikutnya</span>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
                Objek paling menonjol akan dipisahkan, latar dihapus, dan hasilnya bisa
                diunduh sebagai PNG transparan.
              </p>
            </div>

            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => void removeBackgroundNow()}
              disabled={busy}
            >
              {busy ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Removing background…
                </>
              ) : (
                <>
                  <Wand2 size={14} />
                  Remove Background
                </>
              )}
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="btn-ghost !px-3 !py-2 !text-[11.5px]"
                onClick={openPicker}
                disabled={busy}
              >
                <ImagePlus size={13} />
                Change Image
              </button>
              <button
                type="button"
                className="btn-ghost !px-3 !py-2 !text-[11.5px]"
                onClick={clearAll}
                disabled={busy}
              >
                <RotateCcw size={13} />
                Reset
              </button>
            </div>

            <div className="rounded-lg border border-white/[0.055] bg-white/[0.02] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <HardDrive size={11} className="text-accent/70" />
                <p className="text-[10px] font-medium text-ink-300">
                  {modelCached
                    ? `Model ${MODEL_INFO.name} sudah tersimpan offline`
                    : `Unduhan model ±${FIRST_LOAD_MB} MB`}
                </p>
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
                {modelCached
                  ? 'Pemrosesan berikutnya tidak memerlukan internet.'
                  : 'Terjadi sekali saat tombol ditekan, lalu di-cache untuk pemakaian offline.'}
              </p>
            </div>

            <p className="border-t border-white/[0.055] pt-3 text-[10px] leading-relaxed text-ink-500">
              Tips: satu subjek yang jelas memberi hasil paling rapi. Model 512×512 ini
              butuh ±10–15 detik per gambar di desktop (lebih lama di ponsel).
            </p>
          </aside>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void pickFile(file)
        }}
      />
    </div>
  )
}
