import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileOutput,
  Loader2,
  Trash2,
} from 'lucide-react'
import { Segmented } from '../components/Controls'
import { Dropzone } from '../components/Dropzone'
import {
  compactDay,
  downloadBlob,
  errorMessage,
  formatBytes,
  sanitizeBaseName,
} from '../lib/format'
import {
  createWordBlob,
  extractPdfForWord,
  type PdfWordBlock,
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
  const [autoOcr, setAutoOcr] = useState(true)
  const [ocrLanguage, setOcrLanguage] = useState<'ind+eng' | 'ind' | 'eng'>('ind+eng')
  const [result, setResult] = useState<{ blob: Blob; filename: string; blocks: number } | null>(null)
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
      const blocks: PdfWordBlock[] = await extractPdfForWord(
        pdf.bytes,
        (current, total, label) => {
          if (mountedRef.current && job === jobRef.current) {
            setProgress({ current, total })
            if (label) setProgressLabel(label)
          }
        },
        ocrLanguage,
        autoOcr,
      )
      if (!mountedRef.current || job !== jobRef.current) return
      if (blocks.length === 0) throw new Error('Tidak ada teks yang dapat diekstrak. PDF mungkin hanya berisi gambar.')

      const title = sanitizeBaseName(pdf.name)
      const blob = await createWordBlob(blocks, title)
      if (!mountedRef.current || job !== jobRef.current) return
      setResult({
        blob,
        filename: `${title}-${compactDay(new Date())}.docx`,
        blocks: blocks.length,
      })
      setPhase('done')
    } catch (convertError) {
      if (!mountedRef.current || job !== jobRef.current) return
      setError(errorMessage(convertError))
      setPhase('error')
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="panel p-4 sm:p-5">
        {!pdf ? (
          <Dropzone
            onFiles={(files) => void handlePdfFile(files[0])}
            title="Jatuhkan PDF di sini"
            subtitle="atau pilih file dari perangkat Anda"
            hint="PDF · maksimal 40 MB"
            accept=".pdf,application/pdf"
            icon={FileOutput}
            busy={busy}
          />
        ) : (
          <div>
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
              <button type="button" className="icon-btn" onClick={removePdf} disabled={busy} aria-label="Hapus PDF">
                <Trash2 size={14} />
              </button>
            </div>

            <div className="mb-4 grid gap-3 rounded-xl border border-white/[0.07] bg-white/[0.018] p-3">
              <label className="flex items-start gap-2.5 text-[11px] text-ink-300">
                <input
                  type="checkbox"
                  checked={autoOcr}
                  disabled={busy}
                  onChange={(event) => setAutoOcr(event.target.checked)}
                  className="mt-0.5 accent-accent"
                />
                <span>
                  <span className="block font-semibold text-ink-100">OCR otomatis</span>
                  <span className="mt-0.5 block text-[9.5px] leading-relaxed text-ink-500">
                    Aktifkan untuk PDF hasil scan atau gambar.
                  </span>
                </span>
              </label>
              {autoOcr ? (
                <>
                  <p className="field-label">Bahasa OCR</p>
                  <Segmented
                    compact
                    value={ocrLanguage}
                    onChange={setOcrLanguage}
                    options={[
                      { value: 'ind+eng', label: 'Indonesia + English' },
                      { value: 'ind', label: 'Indonesia' },
                      { value: 'eng', label: 'English' },
                    ]}
                  />
                </>
              ) : null}
            </div>

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

            {error ? (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/[0.055] p-3 text-[11px] text-danger">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
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
                  className="primary-btn mt-3 w-full"
                  onClick={() => downloadBlob(result.blob, result.filename)}
                >
                  <Download size={14} />
                  Unduh .docx
                </button>
              </div>
            ) : (
              <button type="button" className="primary-btn mt-4 w-full" onClick={() => void convert()} disabled={busy}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <FileOutput size={14} />}
                {busy ? 'Mengonversi…' : 'Konversi ke Word'}
              </button>
            )}
          </div>
        )}
      </section>

      <aside className="panel h-fit p-4">
        <p className="eyebrow">Catatan konversi</p>
        <ul className="mt-3 space-y-2 text-[10.5px] leading-relaxed text-ink-400">
          <li>• Bekerja untuk PDF yang memiliki teks yang dapat diseleksi.</li>
          <li>• Heading dan daftar dideteksi berdasarkan gaya teks.</li>
          <li>• PDF hasil scan hanya dapat diproses jika ada OCR; gambar tanpa teks tidak diekstrak.</li>
          <li>• Layout, tabel kompleks, dan font khusus mungkin tidak persis sama.</li>
        </ul>
      </aside>
    </div>
  )
}
