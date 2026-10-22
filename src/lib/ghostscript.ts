export type PdfQualityPresetId = 'extreme' | 'recommended' | 'less'

export interface PdfQualityPreset {
  id: PdfQualityPresetId
  label: string
  subtitle: string
  dpi: number
  setting: 'screen' | 'ebook' | 'printer'
  description: string
  extraArgs: readonly string[]
}

export const PDF_QUALITY_PRESETS: Record<PdfQualityPresetId, PdfQualityPreset> = {
  extreme: {
    id: 'extreme',
    label: 'Extreme Compression',
    subtitle: 'Kualitas rendah · ukuran terkecil',
    dpi: 72,
    setting: 'screen',
    description:
      'Paling agresif. Resolusi gambar diturunkan ke 72 DPI untuk batas upload yang ketat.',
    extraArgs: [
      '-dColorImageResolution=72',
      '-dGrayImageResolution=72',
      '-dMonoImageResolution=72',
    ],
  },
  recommended: {
    id: 'recommended',
    label: 'Recommended Compression',
    subtitle: 'Kualitas bagus · kompresi optimal',
    dpi: 150,
    setting: 'ebook',
    description:
      'Pilihan aman untuk dokumen sehari-hari. Gambar 150 DPI, teks dan vektor tetap tajam.',
    extraArgs: ['-dColorImageResolution=150', '-dGrayImageResolution=150'],
  },
  less: {
    id: 'less',
    label: 'Less Compression',
    subtitle: 'Kualitas tinggi · siap cetak',
    dpi: 300,
    setting: 'printer',
    description:
      'Prioritaskan kualitas cetak. Memakai preset printer Ghostscript dengan gambar 300 DPI.',
    extraArgs: [],
  },
}

export const PDF_QUALITY_PRESET_LIST: readonly PdfQualityPreset[] = [
  PDF_QUALITY_PRESETS.extreme,
  PDF_QUALITY_PRESETS.recommended,
  PDF_QUALITY_PRESETS.less,
]

/**
 * Argumen Ghostscript standar. Flag resolusi tambahan ditempatkan tepat setelah
 * -dPDFSETTINGS agar override resolusi bawaan preset berlaku.
 */
export function buildGhostscriptArgs(preset: PdfQualityPreset): string[] {
  return [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.4',
    `-dPDFSETTINGS=/${preset.setting}`,
    ...preset.extraArgs,
    '-dEmbedAllFonts=true',
    '-dSubsetFonts=true',
    '-dDetectDuplicateImages=true',
    '-dCompressFonts=true',
    '-dNOPAUSE',
    '-dQUIET',
    '-dBATCH',
    '-sOutputFile=output.pdf',
    'input.pdf',
  ]
}

export interface GhostscriptCompressionResult {
  bytes: Uint8Array
  /** Ukuran output mentah Ghostscript sebelum size guard. */
  ghostscriptBytes: number
  keptOriginal: boolean
  preset: PdfQualityPresetId
  exitCode: number
  durationMs: number
}

interface GhostscriptFS {
  chdir(path: string): void
  writeFile(path: string, data: Uint8Array): void
  readFile(path: string): Uint8Array
  unlink(path: string): void
  readdir(path: string): string[]
}

interface GhostscriptModule {
  FS: GhostscriptFS
  callMain(args: string[]): number
}

interface GhostscriptFactoryOptions {
  locateFile?: (path: string) => string
  print?: (text: string) => void
  printErr?: (text: string) => void
  noInitialRun?: boolean
}

type GhostscriptFactory = (
  options?: GhostscriptFactoryOptions,
) => Promise<GhostscriptModule>

declare global {
  interface Window {
    Module?: GhostscriptFactory
  }
}

const baseUrl = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`
const scriptUrl = `${baseUrl}wasm/gs.js`
const wasmBaseUrl = `${baseUrl}wasm/`

let enginePromise: Promise<GhostscriptModule> | null = null
let scriptPromise: Promise<void> | null = null
let engineReady = false
let engineLog: string[] = []

export function isGhostscriptReady(): boolean {
  return engineReady
}

export function getGhostscriptLog(): string[] {
  return [...engineLog]
}

function recordLog(prefix: 'out' | 'err', text: string) {
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    engineLog.push(`[${prefix}] ${trimmed}`)
    if (engineLog.length > 200) engineLog.shift()
  }
}

function loadScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Ghostscript WASM hanya dapat dimuat di browser.'))
  }
  if (typeof window.Module === 'function') return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<void>((resolve, reject) => {
    document
      .querySelectorAll<HTMLScriptElement>('script[data-localkit-ghostscript]')
      .forEach((element) => element.remove())

    const script = document.createElement('script')
    script.src = scriptUrl
    script.async = true
    script.dataset.localkitGhostscript = 'true'
    script.onload = () => {
      if (typeof window.Module !== 'function') {
        reject(
          new Error(
            'gs.js dimuat tetapi mesin Ghostscript tidak tersedia. Periksa aset /wasm/gs.js.',
          ),
        )
        return
      }
      resolve()
    }
    script.onerror = () => {
      reject(
        new Error(
          `Gagal memuat mesin Ghostscript dari ${scriptUrl}. Pastikan /wasm/gs.js dan /wasm/gs.wasm tersedia.`,
        ),
      )
    }
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    scriptPromise = null
    throw error
  })

  return scriptPromise
}

function loadEngine(): Promise<GhostscriptModule> {
  return loadScript()
    .then(() => {
      const factory = window.Module
      if (typeof factory !== 'function') {
        throw new Error('Mesin Ghostscript WASM tidak ditemukan di halaman.')
      }
      return factory({
        noInitialRun: true,
        locateFile: (path) => {
          const fileName = path.split('/').pop() || path
          return `${wasmBaseUrl}${fileName}`
        },
        print: (text) => recordLog('out', text),
        printErr: (text) => recordLog('err', text),
      })
    })
    .then((engine) => {
      if (!engine?.FS || typeof engine.callMain !== 'function') {
        throw new Error('Mesin Ghostscript WASM tidak siap (FS/callMain tidak tersedia).')
      }
      engineReady = true
      return engine
    })
}

export function loadGhostscript(): Promise<GhostscriptModule> {
  if (!enginePromise) {
    enginePromise = loadEngine().catch((error: unknown) => {
      enginePromise = null
      engineReady = false
      throw error
    })
  }
  return enginePromise
}

function checkAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new DOMException('Kompresi PDF dibatalkan.', 'AbortError')
  }
}

function isPdfHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  )
}

function failureMessage(error: unknown): string {
  const logs = engineLog.slice(-8).join(' ')
  const message = error instanceof Error ? error.message : String(error)
  return `Ghostscript gagal memproses PDF. ${logs || message}`.trim()
}

/**
 * Jalankan Ghostscript pdfwrite di MEMFS. Seluruh proses lokal; tidak ada file
 * yang dikirim keluar browser. Jika output >= input, file asli dikembalikan
 * karena PDF tersebut sudah optimal.
 */
export async function compressPdfWithGhostscript(
  input: Uint8Array,
  presetId: PdfQualityPresetId,
  options: { signal?: AbortSignal; onEngineReady?: () => void } = {},
): Promise<GhostscriptCompressionResult> {
  if (!input.length) throw new Error('File PDF kosong.')
  checkAborted(options.signal)

  const preset = PDF_QUALITY_PRESETS[presetId]
  if (!preset) throw new Error('Tingkat kompresi tidak dikenal.')

  const startedAt = performance.now()
  engineLog = []
  const engine = await loadGhostscript()
  options.onEngineReady?.()
  checkAborted(options.signal)

  const fs = engine.FS
  const inputPath = '/input.pdf'
  const outputPath = '/output.pdf'
  let exitCode = 0

  try {
    try {
      fs.chdir('/')
    } catch {
      // MEMFS default cwd is already "/".
    }
    try {
      fs.unlink(inputPath)
    } catch {
      // No stale input from a previous run.
    }
    try {
      fs.unlink(outputPath)
    } catch {
      // No stale output from a previous run.
    }

    fs.writeFile(inputPath, new Uint8Array(input))

    try {
      exitCode = engine.callMain(buildGhostscriptArgs(preset))
    } catch (error) {
      throw new Error(failureMessage(error))
    }

    checkAborted(options.signal)
    if (exitCode !== 0) {
      throw new Error(
        `Ghostscript keluar dengan kode ${exitCode}. ${engineLog.slice(-6).join(' ')}`.trim(),
      )
    }

    let ghostscriptOutput: Uint8Array
    try {
      ghostscriptOutput = new Uint8Array(fs.readFile(outputPath))
    } catch {
      throw new Error(
        'Ghostscript tidak menghasilkan output.pdf. PDF mungkin rusak atau terenkripsi.',
      )
    }

    if (!ghostscriptOutput.length || !isPdfHeader(ghostscriptOutput)) {
      throw new Error('Output Ghostscript bukan PDF yang valid.')
    }

    const keptOriginal = ghostscriptOutput.length >= input.length

    return {
      bytes: keptOriginal ? new Uint8Array(input) : ghostscriptOutput,
      ghostscriptBytes: ghostscriptOutput.length,
      keptOriginal,
      preset: presetId,
      exitCode,
      durationMs: Math.round(performance.now() - startedAt),
    }
  } finally {
    for (const path of [inputPath, outputPath]) {
      try {
        fs.unlink(path)
      } catch {
        // File may not exist if Ghostscript failed early.
      }
    }
  }
}
