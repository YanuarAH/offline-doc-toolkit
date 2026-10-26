/**
 * Background Remover — validasi, dukungan browser, dan error yang ramah.
 *
 * Modul ini sengaja ringan (tanpa ONNX Runtime) supaya halaman tetap cepat:
 * pustaka model baru diimpor saat pengguna menekan "Remove Background".
 */
import { formatBytes } from './format'
import { canvasToBlob } from './image'
import { FORMAT_NAME, detectImageFormat, readFileHead, readImageSize } from './imageFormat'
import {
  FIRST_LOAD_MB,
  MODEL_INFO,
  MODEL_MB,
  RUNTIME_MB,
  isModelCached,
} from './backgroundModelInfo'

export { FIRST_LOAD_MB, MODEL_INFO, MODEL_MB, RUNTIME_MB, isModelCached }

export const ACCEPT_ATTRIBUTE = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'
export const ACCEPTED_LABEL = 'JPG · JPEG · PNG · WebP'

export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_PIXELS = 20_000_000

const SUPPORTED_FORMATS = new Set(['jpeg', 'png', 'webp'])

export class BackgroundRemovalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackgroundRemovalError'
  }
}

export interface InspectedImage {
  file: File
  width: number
  height: number
  format: 'jpeg' | 'png' | 'webp'
  formatLabel: string
}

export interface RemovalResult {
  blob: Blob
  width: number
  height: number
  durationMs: number
}

export type RemovalProgress =
  | { stage: 'preparing'; phase: 'runtime' | 'model'; percent: number | null }
  | { stage: 'processing' }
  | { stage: 'encoding' }

/** Pesan untuk browser yang tidak punya kemampuan yang dibutuhkan model. */
export function checkSupport(): string | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 'Fitur ini hanya berjalan di browser.'
  }
  if (typeof WebAssembly === 'undefined') {
    return 'Browser ini tidak mendukung WebAssembly, yang dibutuhkan model AI. Perbarui Chrome, Edge, Firefox, atau Safari terbaru.'
  }
  if (typeof createImageBitmap !== 'function') {
    return 'Browser ini belum mendukung pemrosesan gambar AI (createImageBitmap). Perbarui browser, atau coba di Chrome/Edge desktop.'
  }

  const canvas = document.createElement('canvas')
  if (!canvas.getContext('2d')) {
    return 'Canvas 2D tidak aktif di browser ini, sehingga hasil PNG tidak bisa dibuat.'
  }

  return null
}

async function readSizeWithBitmap(
  file: File,
): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  } catch {
    return null
  }
}

/**
 * Validasi format (magic bytes, bukan ekstensi), ukuran file, jumlah piksel,
 * dan memastikan browser benar-benar bisa membuka gambarnya.
 */
export async function inspectImage(file: File): Promise<InspectedImage> {
  if (file.size === 0) {
    throw new BackgroundRemovalError('File kosong. Pilih gambar lain.')
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new BackgroundRemovalError(
      `Ukuran file ${formatBytes(file.size)} melebihi batas aman ${formatBytes(MAX_FILE_BYTES)}. Kecilkan dulu gambarnya, lalu coba lagi.`,
    )
  }

  const head = await readFileHead(file, 8192).catch(() => new Uint8Array())
  const format = detectImageFormat(head)

  if (!SUPPORTED_FORMATS.has(format)) {
    if (format === 'unknown') {
      throw new BackgroundRemovalError(
        `File "${file.name}" bukan gambar yang dikenali. Gunakan JPG, PNG, atau WebP.`,
      )
    }
    throw new BackgroundRemovalError(
      `Format ${FORMAT_NAME[format]} belum didukung. Gunakan JPG, PNG, atau WebP.`,
    )
  }

  const declared = readImageSize(head)
  if (declared && declared.width * declared.height > MAX_PIXELS) {
    const megapixels = (declared.width * declared.height) / 1_000_000
    throw new BackgroundRemovalError(
      `Gambar ${declared.width}×${declared.height} (${megapixels.toFixed(1)} MP) terlalu besar untuk diproses dengan aman. Perkecil ke sekitar 20 MP atau kurang, lalu coba lagi.`,
    )
  }

  const decoded = await readSizeWithBitmap(file)
  if (!decoded) {
    throw new BackgroundRemovalError(
      'Gambar tidak bisa dibuka browser ini. Coba ekspor ulang sebagai JPG atau PNG, lalu unggah lagi.',
    )
  }

  if (decoded.width * decoded.height > MAX_PIXELS) {
    throw new BackgroundRemovalError(
      `Gambar ${decoded.width}×${decoded.height} terlalu besar untuk diproses dengan aman. Perkecil dulu ke sekitar 20 MP, lalu coba lagi.`,
    )
  }

  return {
    file,
    width: decoded.width,
    height: decoded.height,
    format: format as InspectedImage['format'],
    formatLabel: FORMAT_NAME[format],
  }
}

/**
 * Proses penghapusan background. Model + runtime diimpor malas (lazy) dan
 * dimuat sekali per tab.
 */
export async function removeBackground(
  image: InspectedImage,
  options: {
    onProgress?: (progress: RemovalProgress) => void
  } = {},
): Promise<RemovalResult> {
  const unsupported = checkSupport()
  if (unsupported) throw new BackgroundRemovalError(unsupported)

  const started = performance.now()
  const model = await import('./backgroundModel')

  try {
    const result = await model.removeBackgroundNative(image.file, (progress) => {
      options.onProgress?.(progress)
    })
    options.onProgress?.({ stage: 'encoding' })

    return {
      blob: result.blob,
      width: result.width,
      height: result.height,
      durationMs: performance.now() - started,
    }
  } catch (error) {
    if (error instanceof BackgroundRemovalError) throw error
    if (error instanceof model.ModelUnavailableError) {
      throw new BackgroundRemovalError(
        navigator.onLine
          ? 'Model AI belum tersedia di build ini. Muat ulang halaman; jika masih gagal, build ulang aplikasi.'
          : 'Model AI belum tersimpan di perangkat ini dan tidak bisa diunduh saat offline. Sambungkan internet, muat ulang halaman, lalu coba lagi.',
      )
    }
    throw new BackgroundRemovalError(
      error instanceof Error && error.message
        ? error.message
        : 'Gagal menghapus background. Coba lagi.',
    )
  }
}

/**
 * Menggabungkan warna latar solid di belakang gambar transparan, lalu
 * mengonversinya menjadi Blob (PNG atau JPEG).
 */
export async function applyBackgroundColor(
  transparentBlob: Blob,
  width: number,
  height: number,
  color: string,
  format: 'png' | 'jpeg' = 'png',
  quality = 0.95,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D tidak tersedia di browser ini.')

  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(transparentBlob)
    try {
      ctx.drawImage(bitmap, 0, 0, width, height)
    } finally {
      bitmap.close()
    }
  } else {
    const url = URL.createObjectURL(transparentBlob)
    const img = new Image()
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Gagal merender gambar transparan.'))
        img.src = url
      })
      ctx.drawImage(img, 0, 0, width, height)
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png'
  return await canvasToBlob(canvas, mime, format === 'jpeg' ? quality : undefined)
}
