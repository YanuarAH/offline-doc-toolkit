import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Cpu,
  CheckCircle2,
  Download,
  FileOutput,
  Info,
  Loader2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Dropzone } from '../components/Dropzone'
import {
  compactDay,
  cn,
  downloadBlob,
  errorMessage,
  formatBytes,
  sanitizeBaseName,
} from '../lib/format'
import {
  createWordBlobFromIR,
  extractPdfDocumentIR,
} from '../lib/pdfToWord'

interface LoadedPdf {
  name: string
  size: number
  bytes: Uint8Array
}

type Phase = 'idle' | 'extracting' | 'done' | 'error'

function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false
  return new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-')
}

export function PdfToWord() {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [progressLabel, setProgressLabel] = useState('Mengekstrak teks')
  const [useLayoutModel, setUseLayoutModel] = useState(true)
  const [result, setResult] = useState<{ blob: Blob; filename: string; blocks: number } | null>(null)
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

  const busy = phase === 'extracting'

  function clearResult() {
    jobRef.current += 1
    setResult(null)
    setError(null)
    setPhase('idle')
  }

  async function handlePdfFile(file: File) {
    if (!file.type.includes('pdf') && !/\.pdf$/i.test(file.name)) {
      setError('File harus berupa PDF.')
      setPhase('error')
      return
    }
    clearResult()
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (!bytes.length) throw new Error('File PDF kosong.')
      if (!looksLikePdf(bytes)) throw new Error('File tidak terlihat sebagai PDF yang valid.')
      if (!mountedRef.current) return
      setPdf({ name: file.name, size: file.size, bytes })
    } catch (loadError) {
      if (mountedRef.current) {
        setError(errorMessage(loadError))
        setPhase('error')
      }
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

  async function convert() {
    if (!pdf || busy) return
    const job = jobRef.current + 1
    jobRef.current = job
    setResult(null)
    setError(null)
    setPhase('extracting')
    setProgress({ current: 0, total: 0 })

    try {
      const title = sanitizeBaseName(pdf.name)
      const documentIR = await extractPdfDocumentIR(
        pdf.bytes,
        (current, total, label) => {
          if (mountedRef.current && job === jobRef.current) {
            setProgress({ current, total })
            if (label) setProgressLabel(label)
          }
        },
        useLayoutModel,
        title,
      )
      if (!mountedRef.current || job !== jobRef.current) return
      if (documentIR.blocks.length === 0) throw new Error('Tidak ada teks yang dapat diekstrak. PDF mungkin hanya berisi gambar.')

      const blob = await createWordBlobFromIR(documentIR)
      if (!mountedRef.current || job !== jobRef.current) return
      setResult({
        blob,
        filename: `${title}-${compactDay(new Date())}.docx`,
        blocks: documentIR.blocks.length,
      })
      setPhase('done')
    } catch (convertError) {
      if (!mountedRef.current || job !== jobRef.current) return
      setError(errorMessage(convertError))
      setPhase('error')
    }
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

      <div className={cn(
        pdf
          ? 'grid gap-5 min-[1200px]:grid-cols-[minmax(0,1fr)_380px]'
          : 'grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]',
      )}>
      <section className={cn('panel', pdf ? 'p-0' : 'relative overflow-hidden bg-noise p-2')}>
        {!pdf ? (
          <>
            <div className="pointer-events-none absolute inset-0 grid-lines opacity-30" />
            <div className="relative">
              <Dropzone
                onFiles={(files) => void handlePdfFile(files[0])}
                title="Jatuhkan PDF di sini"
                subtitle="atau pilih file dari perangkat Anda"
                hint="PDF · maksimal 40 MB"
                accept=".pdf,application/pdf"
                icon={FileOutput}
                busy={busy}
              />
            </div>
          </>
        ) : (
          <div className="min-w-0 space-y-4 p-4">
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-accent/20 bg-accent/[0.07] text-accent">
                <FileOutput size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold text-ink-100">{pdf.name}</p>
                <p className="mt-0.5 font-mono text-[9.5px] text-ink-500">
                  {formatBytes(pdf.size)}
                </p>
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
            </div>

            <label className="mb-4 flex items-start gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.018] p-3 text-[11px] text-ink-300">
              <input
                type="checkbox"
                checked={useLayoutModel}
                disabled={busy}
                onChange={(event) => setUseLayoutModel(event.target.checked)}
                className="mt-0.5 accent-accent"
              />
              <span>
                <span className="block font-semibold text-ink-100">Gunakan PDF.js + DocLayout-YOLO AI</span>
                <span className="mt-0.5 block text-[9.5px] leading-relaxed text-ink-500">
                  Model DocLayout-YOLO (DocStructBench) memetakan judul, paragraf, tabel, gambar, rumus, header, dan footer secara presisi.
                </span>
              </span>
            </label>

            {phase === 'extracting' ? (
              <div className="rounded-xl border border-accent/15 bg-accent/[0.035] p-4">
                <div className="flex items-center gap-3">
                  <Loader2 size={16} className="animate-spin text-accent" />
                  <div>
                    <p className="text-[12px] font-semibold text-ink-100">Mengekstrak teks PDF…</p>
                    <p className="mt-0.5 text-[10.5px] text-ink-500">
                      {progress.total > 0
                        ? `${progressLabel} · halaman ${progress.current} dari ${progress.total}`
                        : progressLabel}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {result ? (
              <div className="mt-4 rounded-xl border border-accent/20 bg-accent/[0.055] p-4">
                <div className="flex items-center gap-2 text-accent">
                  <CheckCircle2 size={16} />
                  <p className="text-[12px] font-semibold">Word siap diunduh</p>
                </div>
                <p className="mt-1.5 text-[10.5px] text-ink-500">
                  {result.blocks} blok teks berhasil dikonversi.
                </p>
                <button
                  type="button"
                  className="btn-primary mt-3 w-full"
                  onClick={() => downloadBlob(result.blob, result.filename)}
                >
                  <Download size={14} />
                  Unduh .docx
                </button>
              </div>
            ) : (
              <button type="button" className="btn-primary mt-4 w-full" onClick={() => void convert()} disabled={busy}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <FileOutput size={14} />}
                {busy ? 'Mengonversi…' : 'Konversi ke Word'}
              </button>
            )}
          </div>
        )}
      </section>

      <aside className={cn('panel h-fit', pdf ? 'p-4' : 'space-y-4 p-5')}>
        {!pdf ? (
          <>
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/[0.08] text-accent">
                <Cpu size={17} strokeWidth={1.9} />
              </span>
              <div>
                <h2 className="text-[13px] font-semibold text-white">PDF.js + DocLayout-YOLO</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
                  PDF.js mengekstrak teks & font; DocLayout-YOLO merekonstruksi struktur, tabel, dan gambar.
                </p>
              </div>
            </div>
            {[
              ['Judul & caption', 'Title / Caption'],
              ['Tabel & gambar', 'Table / Picture'],
              ['Elemen berulang', 'Header / Footer'],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.055] bg-white/[0.02] px-3 py-2"
              >
                <p className="truncate text-[10.5px] font-medium text-ink-200">{label}</p>
                <span className="shrink-0 rounded border border-white/[0.07] bg-ink-950/60 px-1.5 py-0.5 font-mono text-[8.5px] text-ink-400">
                  {value}
                </span>
              </div>
            ))}
            <div className="flex items-start gap-2 rounded-lg border border-accent/15 bg-accent/[0.035] px-3 py-2.5">
              <Info size={12} className="mt-0.5 shrink-0 text-accent" />
              <p className="text-[10px] leading-relaxed text-ink-400">
                PDF.js, DocLayout-YOLO, dan hasil DOCX diproses lokal (WebGPU/WASM) untuk pemakaian offline.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.055] bg-white/[0.02] px-3 py-2">
              <ShieldCheck size={12} className="text-accent/80" />
              <p className="text-[10px] text-ink-500">File tidak pernah dikirim ke server.</p>
            </div>
          </>
        ) : (
          <>
            <p className="eyebrow">Catatan konversi</p>
            <ul className="mt-3 space-y-2 text-[10.5px] leading-relaxed text-ink-400">
              <li>• PDF harus memiliki teks yang dapat diseleksi.</li>
              <li>• Tabel kompleks dapat membutuhkan penyesuaian manual.</li>
              <li>• Gambar, font khusus, dan layout presisi mungkin berbeda.</li>
            </ul>
          </>
        )}
      </aside>
    </div>
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
