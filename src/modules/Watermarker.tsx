import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Download,
  FileImage,
  LayoutGrid,
  Loader2,
  Lock,
  Palette,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Type,
  Upload,
  WifiOff,
} from 'lucide-react'
import { Dropzone } from '../components/Dropzone'
import { ImageSourcePicker } from '../components/ImageSourcePicker'
import { Segmented, SliderField } from '../components/Controls'
import {
  PREVIEW_MAX_DIMENSION,
  createWatermarkCanvas,
  decodeImageFile,
  renderWatermarkToCanvas,
  type DecodedImage,
  type WatermarkSettings,
} from '../lib/image'
import { canvasToBlob } from '../lib/image'
import { partitionImageFiles } from '../lib/imageFormat'
import {
  cn,
  compactDay,
  downloadBlob,
  errorMessage,
  formatBytes,
  formatDateID,
  sanitizeBaseName,
} from '../lib/format'

type ExportFormat = 'png' | 'jpeg'

interface LoadedDoc {
  decoded: DecodedImage
  name: string
  size: number
}

const COLOR_PRESETS = [
  { value: '#ef4444', label: 'Merah' },
  { value: '#f8fafc', label: 'Putih' },
  { value: '#0f172a', label: 'Hitam' },
  { value: '#3b82f6', label: 'Biru' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#10b981', label: 'Emerald' },
]

function defaultSettings(): WatermarkSettings {
  return {
    text: `SALINAN · ${formatDateID(new Date())}`,
    mode: 'tiled',
    rotation: -30,
    opacity: 0.34,
    fontSize: 3.5,
    spacing: 3,
    color: '#ef4444',
  }
}

export function Watermarker() {
  const [doc, setDoc] = useState<LoadedDoc | null>(null)
  const [settings, setSettings] = useState<WatermarkSettings>(defaultSettings)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportInfo, setExportInfo] = useState<string | null>(null)
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null)

  const docRef = useRef<LoadedDoc | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const loadRequestRef = useRef(0)

  useEffect(() => {
    return () => {
      loadRequestRef.current += 1
      docRef.current?.decoded.release()
      docRef.current = null
    }
  }, [])

  // Live preview: re-render on every parameter change, throttled to one paint
  // per animation frame. Preview is capped at 1800px; export is native size.
  useEffect(() => {
    if (!doc) return

    const frame = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        const size = renderWatermarkToCanvas(
          canvas,
          doc.decoded,
          settings,
          PREVIEW_MAX_DIMENSION,
        )
        setPreviewSize(size)
      } catch (renderError) {
        setError(errorMessage(renderError))
      }
    })

    return () => cancelAnimationFrame(frame)
  }, [doc, settings])

  async function handleIncomingFile(file: File) {
    const { images } = await partitionImageFiles([file])
    if (images.length === 0) {
      setError('File harus berupa gambar (JPG, PNG, WebP, HEIC, atau AVIF).')
      return
    }

    const requestId = loadRequestRef.current + 1
    loadRequestRef.current = requestId
    setLoading(true)
    setError(null)
    setExportInfo(null)

    try {
      const decoded = await decodeImageFile(file)
      if (requestId !== loadRequestRef.current) {
        decoded.release()
        return
      }

      const previous = docRef.current
      if (previous) previous.decoded.release()

      const next: LoadedDoc = { decoded, name: file.name, size: file.size }
      docRef.current = next
      setDoc(next)
    } catch (loadError) {
      if (requestId === loadRequestRef.current) {
        setError(errorMessage(loadError))
      }
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false)
    }
  }

  function updateSetting<K extends keyof WatermarkSettings>(
    key: K,
    value: WatermarkSettings[K],
  ) {
    setSettings((previous) => ({ ...previous, [key]: value }))
  }

  function resetSettings() {
    setSettings(defaultSettings())
    setExportInfo(null)
    setError(null)
  }

  function removeDocument() {
    loadRequestRef.current += 1
    const current = docRef.current
    if (current) current.decoded.release()
    docRef.current = null
    setDoc(null)
    setPreviewSize(null)
    setExportInfo(null)
    setError(null)
    setLoading(false)
  }

  function applyPreset(label: string, withDate = true) {
    const text = withDate ? `${label} · ${formatDateID(new Date())}` : label
    updateSetting('text', text.slice(0, 80))
  }

  async function handleDownload() {
    if (!doc) return
    const text = settings.text.trim()
    if (!text) {
      setError('Teks watermark tidak boleh kosong.')
      return
    }

    setExporting(true)
    setError(null)
    setExportInfo(null)

    try {
      const canvas = createWatermarkCanvas(doc.decoded, { ...settings, text })

      try {
        const mime = exportFormat === 'png' ? 'image/png' : 'image/jpeg'
        const blob = await canvasToBlob(canvas, mime, exportFormat === 'jpeg' ? 0.94 : undefined)
        const extension = exportFormat === 'png' ? 'png' : 'jpg'
        const filename = `${sanitizeBaseName(doc.name)}-watermark-${compactDay(new Date())}.${extension}`
        downloadBlob(blob, filename)
        setExportInfo(
          `${filename} · ${formatBytes(blob.size)} · ${canvas.width}×${canvas.height} px`,
        )
      } finally {
        // Release the native-resolution bitmap backing store immediately.
        canvas.width = 0
        canvas.height = 0
      }
    } catch (exportError) {
      setError(errorMessage(exportError))
    } finally {
      setExporting(false)
    }
  }

  const hasText = settings.text.trim().length > 0

  if (!doc) {
    return (
      <div className="animate-fade-up space-y-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="panel bg-noise relative overflow-hidden p-2">
            <div className="pointer-events-none absolute inset-0 grid-lines opacity-30" />
            <div className="relative">
              <Dropzone
                onFiles={(files) => {
                  if (files[0]) void handleIncomingFile(files[0])
                }}
                title="Tarik foto KTP atau dokumen ke sini"
                subtitle="Atau upload foto atau ambil langsung dari kamera"
                hint="JPG, PNG, WebP, HEIC, AVIF · diproses lokal, tanpa upload"
                busy={loading}
              />
              {error ? (
                <div className="absolute inset-x-3 bottom-3 flex items-start gap-2 rounded-lg border border-danger/25 bg-[#2b1017]/95 px-3 py-2 text-[11px] text-danger">
                  <AlertTriangle size={13} className="mt-px shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}
            </div>
          </div>

          <aside className="panel flex flex-col gap-5 p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/[0.08] text-accent">
                <ShieldCheck size={17} strokeWidth={1.9} />
              </span>
              <div>
                <h2 className="text-[13px] font-semibold text-white">Privasi by design</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
                  Dokumen sensitif seperti KTP tidak boleh menyentuh server pihak ketiga. Di
                  sini semuanya berjalan di memori browser Anda.
                </p>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-ink-950 p-2.5">
              <div className="relative aspect-[1.6/1] overflow-hidden rounded-lg bg-[#e9eef5]">
                <div className="flex items-start justify-between px-3 pt-2.5">
                  <div>
                    <div className="h-1.5 w-16 rounded bg-[#0f766e]/70" />
                    <div className="mt-1 h-1 w-24 rounded bg-slate-400/40" />
                  </div>
                  <div className="size-6 rounded bg-slate-300/80" />
                </div>
                <div className="mt-2 flex gap-2 px-3">
                  <div className="h-11 w-9 rounded-sm bg-slate-400/55" />
                  <div className="flex-1 space-y-1.5 pt-1.5">
                    {[72, 54, 84, 42].map((width) => (
                      <div
                        key={width}
                        className="h-1 rounded bg-slate-400/35"
                        style={{ width: `${width}%` }}
                      />
                    ))}
                  </div>
                </div>
                <div className="pointer-events-none absolute inset-0 flex -rotate-[24deg] scale-125 flex-wrap items-center justify-center gap-x-5 gap-y-2.5">
                  {Array.from({ length: 12 }).map((_, index) => (
                    <span
                      key={index}
                      className="text-[8px] font-bold tracking-[0.18em] text-red-500/40"
                    >
                      SALINAN
                    </span>
                  ))}
                </div>
              </div>
              <p className="pt-2 text-center font-mono text-[8.5px] tracking-wide text-ink-500">
                contoh hasil · tiled watermark
              </p>
            </div>

            <ul className="space-y-2.5">
              {[
                'Canvas rendering langsung di perangkat',
                'EXIF orientation foto ponsel ditangani otomatis',
                'Output PNG/JPG pada resolusi asli gambar',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-[11px] text-ink-300">
                  <Check size={12} className="mt-0.5 shrink-0 text-accent" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-auto flex items-center gap-2 rounded-lg border border-white/[0.055] bg-white/[0.02] px-3 py-2">
              <WifiOff size={12} className="text-ink-500" />
              <p className="text-[10px] text-ink-500">
                Bisa dipakai offline setelah halaman dimuat pertama kali.
              </p>
            </div>
          </aside>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              icon: Lock,
              title: 'Zero upload',
              text: 'Tidak ada request jaringan saat memproses gambar.',
            },
            {
              icon: Sparkles,
              title: 'Preview WYSIWYG',
              text: 'Yang terlihat di canvas identik dengan hasil unduhan.',
            },
            {
              icon: FileImage,
              title: 'Resolusi utuh',
              text: 'Watermark di-render ulang di resolusi asli saat diunduh.',
            },
          ].map((feature) => (
            <div key={feature.title} className="panel-soft flex gap-3 p-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/[0.06] bg-white/[0.025] text-accent/80">
                <feature.icon size={14} />
              </span>
              <div>
                <p className="text-[11.5px] font-semibold text-ink-100">{feature.title}</p>
                <p className="mt-1 text-[10.5px] leading-relaxed text-ink-500">{feature.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-up grid gap-5 min-[1200px]:grid-cols-[minmax(0,1fr)_404px]">
      <div className="min-w-0 space-y-5">
        <section className="panel overflow-hidden">
          <header className="flex items-center justify-between gap-3 border-b border-white/[0.055] px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                <FileImage size={14} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[12.5px] font-medium text-ink-100">{doc.name}</p>
                <p className="font-mono text-[10px] text-ink-500">
                  {doc.decoded.width} × {doc.decoded.height} px · {formatBytes(doc.size)}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                className="btn-primary !px-2.5 !py-2 !text-[11px]"
                onClick={() => void handleDownload()}
                disabled={exporting || !hasText}
                aria-label={`Unduh ${exportFormat === 'png' ? 'PNG' : 'JPG'} resolusi asli`}
                title={`Unduh ${exportFormat === 'png' ? 'PNG' : 'JPG'} resolusi asli`}
              >
                {exporting ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Download size={12} />
                )}
                <span className="hidden sm:inline">
                  Unduh {exportFormat === 'png' ? 'PNG' : 'JPG'}
                </span>
              </button>
              <ImageSourcePicker
                disabled={loading}
                onFiles={(files) => {
                  const file = files[0]
                  if (file) void handleIncomingFile(file)
                }}
              >
                {(openPicker) => (
                  <button
                    type="button"
                    className="btn-ghost !px-2.5 !py-2 !text-[11px]"
                    onClick={openPicker}
                    disabled={loading}
                  >
                    <Upload size={12} />
                    Ganti
                  </button>
                )}
              </ImageSourcePicker>
              <button
                type="button"
                className="icon-btn hover:!border-danger/40 hover:!text-danger"
                onClick={removeDocument}
                title="Hapus dokumen"
                aria-label="Hapus dokumen"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </header>

          <div className="checkerboard relative flex min-h-[340px] items-center justify-center p-3 sm:p-6">
            <canvas
              ref={canvasRef}
              className={cn(
                'max-h-[60vh] w-auto max-w-full rounded-lg bg-white/5 shadow-[0_24px_80px_-24px_rgba(0,0,0,.95)] ring-1 ring-white/10 transition-opacity',
                loading && 'opacity-40',
              )}
            />
            {loading ? (
              <div className="absolute inset-0 grid place-items-center bg-ink-950/40">
                <Loader2 size={22} className="animate-spin text-accent" />
              </div>
            ) : null}
            {error ? (
              <div className="absolute inset-x-3 bottom-3 flex items-start gap-2 rounded-lg border border-danger/25 bg-[#2b1017]/95 px-3 py-2 text-[11px] text-danger">
                <AlertTriangle size={13} className="mt-px shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.055] px-4 py-2.5 text-[10.5px] text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="live-dot size-1.5 rounded-full bg-accent" />
              Live preview
              {previewSize ? (
                <span className="font-mono text-ink-400">
                  {previewSize.width}×{previewSize.height}px
                </span>
              ) : null}
            </span>
            <span className="font-mono">
              Export: {doc.decoded.width}×{doc.decoded.height}px (asli)
            </span>
          </div>
        </section>
      </div>

      <section className="panel h-fit overflow-hidden">
        <header className="flex shrink-0 items-center justify-between border-b border-white/[0.055] px-4 py-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={14} className="text-accent" />
            <h2 className="text-[12.5px] font-semibold text-white">Kontrol Watermark</h2>
          </div>
          <button type="button" className="btn-quiet !text-[10.5px]" onClick={resetSettings}>
            <RotateCcw size={11} />
            Reset
          </button>
        </header>

        <div className="space-y-5 p-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="watermark-text" className="field-label">
                <span className="inline-flex items-center gap-1.5">
                  <Type size={12} className="text-ink-500" />
                  Teks watermark
                </span>
              </label>
              <span className="font-mono text-[9.5px] text-ink-500">
                {settings.text.length}/80
              </span>
            </div>
            <input
              id="watermark-text"
              className="input"
              value={settings.text}
              maxLength={80}
              spellCheck={false}
              placeholder="SALINAN · 22 Oktober 2026"
              onChange={(event) => updateSetting('text', event.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="chip" onClick={() => applyPreset('SALINAN')}>
                SALINAN
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => applyPreset('HANYA UNTUK VERIFIKASI', false)}
              >
                Hanya untuk verifikasi
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => updateSetting('text', formatDateID(new Date()))}
              >
                <CalendarDays size={10} />
                Tanggal hari ini
              </button>
            </div>
          </div>

          <div className="divider" />

          <Segmented
            value={settings.mode}
            onChange={(mode) => updateSetting('mode', mode)}
            options={[
              { value: 'tiled', label: 'Tiled', hint: 'Memenuhi gambar', icon: LayoutGrid },
              { value: 'single', label: 'Single Stamp', hint: 'Satu teks', icon: Square },
            ]}
          />

          <SliderField
            label="Sudut rotasi"
            value={settings.rotation}
            min={-90}
            max={90}
            step={1}
            display={`${settings.rotation}°`}
            onChange={(value) => updateSetting('rotation', Math.round(value))}
          />

          <SliderField
            label="Opacity"
            value={settings.opacity}
            min={0.1}
            max={1}
            step={0.01}
            display={`${Math.round(settings.opacity * 100)}%`}
            onChange={(value) => updateSetting('opacity', value)}
          />

          <SliderField
            label="Ukuran font"
            value={settings.fontSize}
            min={1.5}
            max={12}
            step={0.5}
            display={`${settings.fontSize.toFixed(1)}%`}
            hint="dari lebar gambar"
            onChange={(value) => updateSetting('fontSize', value)}
          />

          <SliderField
            label="Jarak spasi"
            value={settings.spacing}
            min={0}
            max={15}
            step={0.5}
            display={`${settings.spacing.toFixed(1)}%`}
            hint="antar teks"
            onChange={(value) => updateSetting('spacing', value)}
            disabled={settings.mode === 'single'}
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="field-label inline-flex items-center gap-1.5">
                <Palette size={12} className="text-ink-500" />
                Warna teks
              </span>
              <span className="font-mono text-[9.5px] tracking-wide text-ink-400 uppercase">
                {settings.color}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {COLOR_PRESETS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  className="swatch"
                  style={{ backgroundColor: color.value }}
                  data-active={settings.color.toLowerCase() === color.value}
                  aria-label={`Warna ${color.label}`}
                  aria-pressed={settings.color.toLowerCase() === color.value}
                  onClick={() => updateSetting('color', color.value)}
                />
              ))}
              <label className="ml-0.5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-white/15 px-2 py-1.5 text-[10px] text-ink-400 transition hover:border-accent/40 hover:text-accent">
                <input
                  type="color"
                  className="size-4 cursor-pointer rounded bg-transparent"
                  value={settings.color}
                  onChange={(event) => updateSetting('color', event.target.value)}
                  aria-label="Warna kustom"
                />
                Custom
              </label>
            </div>
          </div>
        </div>

        <div className="shrink-0 space-y-2.5 border-t border-white/[0.06] bg-ink-900/95 p-4">
          <div className="flex items-center justify-between">
            <span className="field-label">Format unduhan</span>
            <span className="font-mono text-[9px] tracking-wide text-ink-500">RESOLUSI ASLI</span>
          </div>
          <Segmented
            compact
            value={exportFormat}
            onChange={setExportFormat}
            options={[
              { value: 'png', label: 'PNG', hint: 'Lossless' },
              { value: 'jpeg', label: 'JPG', hint: 'Lebih kecil' },
            ]}
          />
          <button
            type="button"
            className="btn-primary w-full !py-3"
            onClick={() => void handleDownload()}
            disabled={exporting || !hasText}
          >
            {exporting ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Menyiapkan file…
              </>
            ) : (
              <>
                <Download size={15} />
                Unduh {exportFormat === 'png' ? 'PNG' : 'JPG'} resolusi asli
              </>
            )}
          </button>
          {exportInfo ? (
            <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-accent/90">
              <Check size={12} className="mt-px shrink-0" />
              <span className="break-all">{exportInfo}</span>
            </p>
          ) : (
            <p className="text-center text-[10px] text-ink-500">
              File dibuat langsung di browser. Tidak ada yang diunggah.
            </p>
          )}
          {!hasText ? (
            <p className="text-center text-[10px] text-warn/90">
              Isi teks watermark untuk mengaktifkan unduhan.
            </p>
          ) : null}
        </div>
      </section>

    </div>
  )
}
