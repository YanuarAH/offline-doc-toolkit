import { useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileArchive,
  Gauge,
  Images,
  Loader2,
  Lock,
  Plus,
  Settings2,
  ShieldCheck,
  Target,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { Dropzone } from '../components/Dropzone'
import { Segmented, SliderField } from '../components/Controls'
import {
  FORMAT_EXT,
  FORMAT_LABEL,
  compressImage,
  isWebpSupported,
  type CompressResult,
  type OutputFormat,
} from '../lib/compress'
import { decodeImageFile } from '../lib/image'
import { partitionImageFiles } from '../lib/imageFormat'
import {
  cn,
  compactDay,
  downloadBlob,
  errorMessage,
  formatBytes,
  sanitizeBaseName,
  savingsPercent,
} from '../lib/format'

type SizeMode = 'target' | 'quality'
type ItemStatus = 'ready' | 'processing' | 'done' | 'error'

interface BatchItem {
  id: string
  file: File
  srcUrl: string
  status: ItemStatus
  error?: string
  result?: CompressResult
  outUrl?: string
  outName?: string
}

interface Notice {
  tone: 'success' | 'error'
  text: string
}

function uniqueFilename(desired: string, used: Set<string>): string {
  if (!used.has(desired.toLowerCase())) {
    used.add(desired.toLowerCase())
    return desired
  }

  const dot = desired.lastIndexOf('.')
  const base = dot >= 0 ? desired.slice(0, dot) : desired
  const extension = dot >= 0 ? desired.slice(dot) : ''

  let index = 2
  let candidate = `${base}-${index}${extension}`
  while (used.has(candidate.toLowerCase())) {
    index += 1
    candidate = `${base}-${index}${extension}`
  }

  used.add(candidate.toLowerCase())
  return candidate
}

export function BatchCompressor() {
  const [items, setItems] = useState<BatchItem[]>([])
  const [format, setFormat] = useState<OutputFormat>('jpeg')
  const [mode, setMode] = useState<SizeMode>('target')
  const [targetKb, setTargetKb] = useState('200')
  const [quality, setQuality] = useState(0.82)
  const [busy, setBusy] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [zipProgress, setZipProgress] = useState(0)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [notice, setNotice] = useState<Notice | null>(null)
  const [webpSupported, setWebpSupported] = useState<boolean | null>(null)

  const addInputRef = useRef<HTMLInputElement>(null)
  const urlsRef = useRef<Set<string>>(new Set())
  const outUrlByItemRef = useRef<Map<string, string>>(new Map())
  const mountedRef = useRef(true)
  const formatTouchedRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    void isWebpSupported().then((supported) => {
      if (cancelled) return
      setWebpSupported(supported)
      // Jangan menimpa pilihan eksplisit user. Mulai dari JPEG yang universal,
      // lalu naik ke WebP hanya jika browser mendukung dan user belum memilih.
      if (supported && !formatTouchedRef.current) setFormat('webp')
      if (!supported) setFormat((current) => (current === 'webp' ? 'jpeg' : current))
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Revoke every blob URL when the module unmounts so no image data lingers.
  useEffect(() => {
    mountedRef.current = true
    const urls = urlsRef.current
    const outUrls = outUrlByItemRef.current

    return () => {
      mountedRef.current = false
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
      outUrls.clear()
    }
  }, [])

  const totals = useMemo(() => {
    let before = 0
    let after = 0
    let done = 0
    let metTarget = 0

    for (const item of items) {
      if (!item.result) continue
      done += 1
      before += item.file.size
      after += item.result.blob.size
      if (item.result.reachedTarget) metTarget += 1
    }

    return {
      done,
      before,
      after,
      metTarget,
      saved: before > 0 ? savingsPercent(before, after) : 0,
    }
  }, [items])

  const estimatedTargetBytes = useMemo(() => {
    const parsed = Number.parseFloat(targetKb.replace(',', '.'))
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 1024) : null
  }, [targetKb])

  function revokeUrl(url: string | undefined) {
    if (!url) return
    URL.revokeObjectURL(url)
    urlsRef.current.delete(url)
  }

  async function addFiles(files: File[]) {
    if (busy) return
    const { images, rejected } = await partitionImageFiles(files)

    if (images.length === 0) {
      setNotice({
        tone: 'error',
        text: 'Pilih file gambar (JPG, PNG, WebP, HEIC, atau AVIF).',
      })
      return
    }

    const additions: BatchItem[] = images.map((file, index) => {
      const srcUrl = URL.createObjectURL(file)
      urlsRef.current.add(srcUrl)
      return {
        id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        srcUrl,
        status: 'ready',
      }
    })

    setItems((previous) => [...previous, ...additions])
    setNotice(null)

    if (rejected.length > 0) {
      setNotice({
        tone: 'error',
        text: `${rejected.length} file diabaikan karena bukan gambar.`,
      })
    }
  }

  function removeItem(id: string) {
    if (busy) return
    const item = items.find((candidate) => candidate.id === id)
    if (!item) return

    revokeUrl(item.srcUrl)
    revokeUrl(item.outUrl)
    outUrlByItemRef.current.delete(id)
    setItems((previous) => previous.filter((candidate) => candidate.id !== id))
  }

  function clearAll() {
    if (busy) return
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    urlsRef.current.clear()
    outUrlByItemRef.current.clear()
    setItems([])
    setNotice(null)
    setProgress({ done: 0, total: 0 })
  }

  function updateItem(id: string, patch: Partial<BatchItem>) {
    setItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )
  }

  function changeFormat(next: OutputFormat) {
    formatTouchedRef.current = true
    setFormat(next)
  }

  async function compressAll() {
    if (busy || items.length === 0) return

    if (format === 'webp' && webpSupported !== true) {
      setNotice({
        tone: 'error',
        text: 'Browser ini belum mendukung encode WebP. Pilih JPEG atau PNG.',
      })
      return
    }

    let targetBytes: number | null = null
    if (mode === 'target') {
      if (estimatedTargetBytes === null || estimatedTargetBytes < 1024) {
        setNotice({ tone: 'error', text: 'Target ukuran minimal 1 KB dan harus berupa angka.' })
        return
      }
      targetBytes = estimatedTargetBytes
    }

    const snapshot = items.slice()
    let failures = 0
    let firstFailure: string | null = null

    setBusy(true)
    setNotice(null)
    setProgress({ done: 0, total: snapshot.length })

    for (let index = 0; index < snapshot.length; index += 1) {
      if (!mountedRef.current) break

      const item = snapshot[index]
      updateItem(item.id, { status: 'processing', error: undefined })

      try {
        const decoded = await decodeImageFile(item.file)
        if (!mountedRef.current) {
          decoded.release()
          break
        }

        let result: CompressResult

        try {
          result = await compressImage(decoded, {
            format,
            targetBytes,
            quality,
          })
        } finally {
          decoded.release()
        }

        if (!mountedRef.current) break

        const previousUrl = outUrlByItemRef.current.get(item.id)
        if (previousUrl) revokeUrl(previousUrl)

        const outUrl = URL.createObjectURL(result.blob)
        if (!mountedRef.current) {
          URL.revokeObjectURL(outUrl)
          break
        }

        urlsRef.current.add(outUrl)
        outUrlByItemRef.current.set(item.id, outUrl)

        updateItem(item.id, {
          status: 'done',
          error: undefined,
          result,
          outUrl,
          outName: `${sanitizeBaseName(item.file.name)}-compressed.${FORMAT_EXT[format]}`,
        })
      } catch (compressionError) {
        failures += 1
        const message = errorMessage(compressionError)
        if (firstFailure === null) firstFailure = message
        if (mountedRef.current) {
          updateItem(item.id, {
            status: 'error',
            error: message,
          })
        }
      }

      if (mountedRef.current) {
        setProgress({ done: index + 1, total: snapshot.length })
      }
    }

    if (!mountedRef.current) return
    setBusy(false)

    if (failures > 0) {
      const detail = firstFailure
      setNotice({
        tone: 'error',
        text:
          failures === 1 && detail
            ? `1 gambar gagal dikompres. ${detail}`
            : `${failures} gambar gagal dikompres. Contoh penyebab: ${detail ?? 'format tidak didukung.'}`,
      })
    }
  }

  function downloadItem(item: BatchItem) {
    if (!item.result) return
    downloadBlob(item.result.blob, item.outName ?? `${sanitizeBaseName(item.file.name)}.webp`)
  }

  async function downloadZip() {
    if (zipping || busy) return

    const doneItems = items.filter((item) => item.result && item.outUrl)
    if (doneItems.length === 0) {
      setNotice({ tone: 'error', text: 'Belum ada gambar yang selesai dikompres.' })
      return
    }

    setZipping(true)
    setZipProgress(0)
    setNotice(null)

    try {
      const zip = new JSZip()
      const usedNames = new Set<string>()

      for (const item of doneItems) {
        if (!item.result) continue
        const fallbackExtension = item.outName?.split('.').pop() ?? 'webp'
        const desired =
          item.outName ?? `${sanitizeBaseName(item.file.name)}-compressed.${fallbackExtension}`
        zip.file(uniqueFilename(desired, usedNames), item.result.blob)
      }

      const archive = await zip.generateAsync(
        { type: 'blob', compression: 'STORE' },
        (metadata) => setZipProgress(metadata.percent),
      )

      downloadBlob(archive, `localkit-compressed-${compactDay(new Date())}.zip`)
      setNotice({
        tone: 'success',
        text: `ZIP berisi ${doneItems.length} gambar berhasil dibuat (${formatBytes(archive.size)}).`,
      })
    } catch (zipError) {
      setNotice({ tone: 'error', text: errorMessage(zipError) })
    } finally {
      setZipping(false)
      setZipProgress(0)
    }
  }

  const overallPercent =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="animate-fade-up space-y-5">
      <section className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Settings2 size={14} className="text-accent" />
            <h2 className="text-[12.5px] font-semibold text-white">Pengaturan Kompresi</h2>
            {items.length > 0 ? (
              <span className="value-badge">{items.length} file</span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="btn-ghost !py-1.5 !text-[11px]"
              onClick={() => addInputRef.current?.click()}
              disabled={busy}
            >
              <Plus size={12} />
              Tambah gambar
            </button>
            <button
              type="button"
              className="btn-quiet !text-[11px]"
              onClick={clearAll}
              disabled={busy || items.length === 0}
            >
              <Trash2 size={12} />
              Bersihkan
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <span className="eyebrow">Format output</span>
            <Segmented
              value={format}
              onChange={changeFormat}
              options={[
                {
                  value: 'webp',
                  label: 'WebP',
                  hint:
                    webpSupported === null
                      ? 'Memeriksa…'
                      : webpSupported
                        ? 'Paling kecil'
                        : 'Tidak didukung',
                  disabled: webpSupported !== true,
                },
                { value: 'jpeg', label: 'JPEG', hint: 'Universal' },
                { value: 'png', label: 'PNG', hint: 'Lossless' },
              ]}
            />
            <p className="font-mono text-[9px] tracking-wide text-ink-500">
              Output: {FORMAT_LABEL[format]} (.{FORMAT_EXT[format]})
            </p>
            {webpSupported === false ? (
              <p className="text-[9.5px] leading-relaxed text-warn/90">
                Browser ini tidak mendukung encode WebP. Pilih JPEG atau PNG.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <span className="eyebrow">Mode ukuran</span>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'target', label: 'Target KB', hint: 'Auto quality' },
                { value: 'quality', label: 'Kualitas tetap', hint: 'Manual' },
              ]}
            />
          </div>

          <div className="space-y-2">
            {mode === 'target' ? (
              <>
                <span className="eyebrow">Target maksimal</span>
                <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-ink-950/70 px-3 transition focus-within:border-accent/40">
                  <Target size={13} className="shrink-0 text-accent/70" />
                  <input
                    aria-label="Target ukuran maksimal dalam KB"
                    className="w-full min-w-0 bg-transparent py-2.5 font-mono text-[13px] text-white outline-none placeholder:text-ink-500"
                    value={targetKb}
                    inputMode="decimal"
                    placeholder="200"
                    disabled={busy}
                    onChange={(event) => setTargetKb(event.target.value)}
                  />
                  <span className="font-mono text-[9.5px] text-ink-500">KB</span>
                </div>
                <p className="text-[9.5px] text-ink-500">
                  {estimatedTargetBytes
                    ? `≈ ${formatBytes(estimatedTargetBytes)} per gambar`
                    : 'Masukkan angka, mis. 200'}
                </p>
              </>
            ) : (
              <>
                <SliderField
                  label="Kualitas"
                  value={quality}
                  min={0.3}
                  max={0.95}
                  step={0.01}
                  display={`${Math.round(quality * 100)}%`}
                  onChange={setQuality}
                  disabled={busy}
                />
                <p className="text-[9.5px] text-ink-500">
                  {format === 'png'
                    ? 'PNG bersifat lossless — kualitas tidak berpengaruh.'
                    : 'Kualitas tetap, ukuran mengikuti hasil encoder.'}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void compressAll()}
            disabled={busy || zipping || items.length === 0}
          >
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Mengompres…
              </>
            ) : (
              <>
                <Wand2 size={14} />
                Kompres semua {items.length > 0 ? `(${items.length})` : ''}
              </>
            )}
          </button>

          <button
            type="button"
            className="btn-ghost"
            onClick={() => void downloadZip()}
            disabled={zipping || busy || totals.done === 0}
          >
            {zipping ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <FileArchive size={14} />
            )}
            Download All as ZIP
          </button>

          <div className="ml-auto flex items-center gap-1.5 text-[10px] text-ink-500">
            <ShieldCheck size={11} className="text-accent/70" />
            Tanpa upload · proses lokal
          </div>
        </div>

        {busy || zipping ? (
          <div className="mt-4 rounded-lg border border-white/[0.06] bg-ink-950/60 p-3">
            <div className="flex items-center justify-between text-[10px]">
              <span className="flex items-center gap-1.5 text-ink-400">
                <Loader2 size={11} className="animate-spin text-accent" />
                {busy ? 'Mengompres gambar…' : 'Menyusun arsip ZIP…'}
              </span>
              <span className="font-mono text-ink-300">
                {busy ? `${progress.done}/${progress.total}` : `${Math.round(zipProgress)}%`}
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${busy ? overallPercent : zipProgress}%` }}
              />
            </div>
          </div>
        ) : null}

        {notice ? (
          <div
            className={cn(
              'mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px]',
              notice.tone === 'error'
                ? 'border-danger/25 bg-danger/[0.06] text-danger'
                : 'border-accent/20 bg-accent/[0.05] text-accent',
            )}
          >
            {notice.tone === 'error' ? (
              <AlertTriangle size={13} className="mt-px shrink-0" />
            ) : (
              <CheckCircle2 size={13} className="mt-px shrink-0" />
            )}
            <span>{notice.text}</span>
          </div>
        ) : null}
      </section>

      {items.length === 0 ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="panel bg-noise relative overflow-hidden p-2">
            <div className="pointer-events-none absolute inset-0 grid-lines opacity-30" />
            <div className="relative">
              <Dropzone
                multiple
                icon={Images}
                onFiles={addFiles}
                title="Tarik banyak gambar ke sini"
                subtitle="Atau klik untuk memilih beberapa file sekaligus"
                hint="JPG, PNG, WebP, HEIC, AVIF · kompres batch tanpa upload"
              />
            </div>
          </div>

          <aside className="panel space-y-4 p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/[0.08] text-accent">
                <Target size={17} strokeWidth={1.9} />
              </span>
              <div>
                <h2 className="text-[13px] font-semibold text-white">
                  Bagaimana target KB bekerja?
                </h2>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
                  Encoder mencari kualitas tertinggi yang masih muat di bawah batas ukuran
                  yang Anda tentukan.
                </p>
              </div>
            </div>

            <ol className="space-y-3">
              {[
                {
                  step: '01',
                  title: 'Binary search kualitas',
                  text: '7 iterasi antara 0.10–0.95 untuk menemukan kualitas terbaik yang muat.',
                },
                {
                  step: '02',
                  title: 'Turunkan dimensi otomatis',
                  text: 'Jika quality 0.10 masih terlalu besar, resolusi diperkecil 0.85× bertahap.',
                },
                {
                  step: '03',
                  title: 'Unduh satu per satu atau ZIP',
                  text: 'Setiap hasil menyimpan perbandingan before/after dan persentase hemat.',
                },
              ].map((item) => (
                <li key={item.step} className="flex gap-3">
                  <span className="mt-0.5 font-mono text-[9.5px] text-accent/70">{item.step}</span>
                  <div>
                    <p className="text-[11px] font-medium text-ink-200">{item.title}</p>
                    <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-500">
                      {item.text}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="rounded-lg border border-white/[0.055] bg-white/[0.02] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Lock size={11} className="text-accent/70" />
                <p className="text-[10px] font-medium text-ink-300">
                  Gambar tidak pernah meninggalkan perangkat
                </p>
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <div className="space-y-5">
          {totals.done > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="panel p-4">
                <p className="eyebrow">Diproses</p>
                <p className="mt-1.5 font-mono text-[21px] leading-none text-white">
                  {totals.done}
                  <span className="text-[11px] text-ink-500">/{items.length}</span>
                </p>
                <p className="mt-1.5 text-[10px] text-ink-500">gambar selesai</p>
              </div>
              <div className="panel p-4">
                <p className="eyebrow">Total sebelum</p>
                <p className="mt-1.5 font-mono text-[21px] leading-none text-ink-200">
                  {formatBytes(totals.before)}
                </p>
                <p className="mt-1.5 text-[10px] text-ink-500">ukuran file asli</p>
              </div>
              <div className="panel p-4">
                <p className="eyebrow">Total sesudah</p>
                <p className="mt-1.5 font-mono text-[21px] leading-none text-accent">
                  {formatBytes(totals.after)}
                </p>
                <p className="mt-1.5 text-[10px] text-ink-500">
                  {totals.metTarget}/{totals.done} di bawah target
                </p>
              </div>
              <div className="panel relative overflow-hidden p-4">
                <p className="eyebrow">Penghematan</p>
                <p
                  className={cn(
                    'mt-1.5 font-mono text-[21px] leading-none',
                    totals.saved >= 0 ? 'text-accent' : 'text-warn',
                  )}
                >
                  {totals.saved >= 0 ? '' : '+'}
                  {Math.abs(totals.saved).toFixed(1)}%
                </p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-accent/80"
                    style={{ width: `${Math.min(100, Math.max(0, totals.saved))}%` }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          <section className="panel overflow-hidden">
            <header className="flex items-center justify-between gap-3 border-b border-white/[0.055] px-4 py-3">
              <div className="flex items-center gap-2">
                <Images size={14} className="text-accent" />
                <h2 className="text-[12.5px] font-semibold text-white">Antrian gambar</h2>
                <span className="value-badge">{items.length}</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[9.5px] text-ink-500">
                BEFORE
                <ArrowRight size={9} />
                AFTER
              </div>
            </header>

            <ul className="divide-y divide-white/[0.045]">
              {items.map((item) => {
                const saved = item.result
                  ? savingsPercent(item.file.size, item.result.blob.size)
                  : 0

                return (
                  <li
                    key={item.id}
                    className="flex flex-col gap-3 p-3 transition hover:bg-white/[0.012] sm:flex-row sm:items-center"
                  >
                    <div className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-white/[0.08] bg-ink-950">
                      <img
                        src={item.outUrl ?? item.srcUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                      {item.status === 'processing' ? (
                        <div className="absolute inset-0 grid place-items-center bg-ink-950/65">
                          <Loader2 size={15} className="animate-spin text-accent" />
                        </div>
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="max-w-full truncate text-[12px] font-medium text-ink-100">
                          {item.file.name}
                        </p>
                        {item.status === 'ready' ? (
                          <span className="rounded border border-white/[0.07] bg-white/[0.03] px-1.5 py-0.5 text-[8.5px] tracking-wide text-ink-500 uppercase">
                            siap
                          </span>
                        ) : null}
                        {item.status === 'processing' ? (
                          <span className="rounded border border-accent/20 bg-accent/[0.07] px-1.5 py-0.5 text-[8.5px] tracking-wide text-accent uppercase">
                            proses
                          </span>
                        ) : null}
                        {item.status === 'done' && item.result ? (
                          item.result.reachedTarget ? (
                            <span className="inline-flex items-center gap-1 rounded border border-accent/20 bg-accent/[0.06] px-1.5 py-0.5 text-[8.5px] tracking-wide text-accent uppercase">
                              <CheckCircle2 size={8} />
                              target tercapai
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded border border-warn/25 bg-warn/[0.07] px-1.5 py-0.5 text-[8.5px] tracking-wide text-warn uppercase">
                              <AlertTriangle size={8} />
                              di atas target
                            </span>
                          )
                        ) : null}
                        {item.status === 'error' ? (
                          <span className="inline-flex items-center gap-1 rounded border border-danger/25 bg-danger/[0.07] px-1.5 py-0.5 text-[8.5px] tracking-wide text-danger uppercase">
                            <AlertTriangle size={8} />
                            gagal
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-ink-500">
                        <span>{formatBytes(item.file.size)}</span>
                        <ArrowRight size={9} />
                        <span className={cn(item.result ? 'text-ink-200' : 'text-ink-600')}>
                          {item.result ? formatBytes(item.result.blob.size) : '—'}
                        </span>
                        {item.result ? (
                          <>
                            <span
                              className={cn(
                                'rounded px-1 py-0.5 text-[9px]',
                                saved >= 0
                                  ? 'bg-accent/[0.08] text-accent'
                                  : 'bg-warn/[0.08] text-warn',
                              )}
                            >
                              {saved >= 0 ? '−' : '+'}
                              {Math.abs(saved).toFixed(1)}%
                            </span>
                            <span className="text-ink-600">
                              {item.result.width}×{item.result.height}px
                            </span>
                            <span className="text-ink-600">
                              q{item.result.quality.toFixed(2)} · {item.result.passes}× encode
                            </span>
                          </>
                        ) : null}
                      </div>

                      {item.error ? (
                        <p className="mt-1 text-[10px] text-danger">{item.error}</p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
                      <button
                        type="button"
                        className="btn-ghost !px-2.5 !py-1.5 !text-[10.5px]"
                        onClick={() => downloadItem(item)}
                        disabled={!item.result || busy}
                      >
                        <Download size={12} />
                        Unduh
                      </button>
                      <button
                        type="button"
                        className="icon-btn size-7 hover:!border-danger/40 hover:!text-danger"
                        onClick={() => removeItem(item.id)}
                        disabled={busy}
                        aria-label={`Hapus ${item.file.name}`}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>

            <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.055] px-4 py-2.5 text-[10px] text-ink-500">
              <span className="inline-flex items-center gap-1.5">
                <Gauge size={11} className="text-accent/60" />
                {mode === 'target'
                  ? `Target ${targetKb || '—'} KB · ${FORMAT_LABEL[format]}`
                  : `Kualitas ${Math.round(quality * 100)}% · ${FORMAT_LABEL[format]}`}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Lock size={11} className="text-accent/60" />
                File hanya ada di memori browser
              </span>
              {totals.done > 0 && totals.metTarget < totals.done ? (
                <span className="inline-flex items-center gap-1.5 text-warn/90">
                  <AlertTriangle size={11} />
                  {totals.done - totals.metTarget} file belum mencapai target
                </span>
              ) : null}
            </footer>
          </section>
        </div>
      )}

      <input
        ref={addInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length > 0) addFiles(files)
        }}
      />
    </div>
  )
}
