/**
 * Dekoder HEIC/HEIF lokal (libheif → WebAssembly).
 *
 * Chrome/Firefox di Android tidak punya dekoder HEVC, jadi foto dari galeri HP
 * (iPhone .HEIC atau Android yang menyimpan HEIF) gagal dibuka lewat <img>.
 * Berkas wasm ±2 MB ini hanya diunduh saat benar-benar dibutuhkan, lalu
 * disimpan service worker sehingga fitur tetap jalan offline.
 */

const MAX_SIDE = 4096
const DISPLAY_TIMEOUT_MS = 30_000

interface HeifImage {
  get_width(): number
  get_height(): number
  is_primary?(): boolean
  display(target: ImageData, callback: (data: ImageData | null) => void): void
  free?(): void
}

interface HeifDecoder {
  decode(data: Uint8Array): HeifImage[]
}

interface LibHeifApi {
  HeifDecoder: new () => HeifDecoder
}

export interface HeifCanvasResult {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

let libHeifPromise: Promise<LibHeifApi> | null = null

export function loadLibHeif(): Promise<LibHeifApi> {
  if (!libHeifPromise) {
    libHeifPromise = import('libheif-js/libheif-wasm/libheif-bundle.mjs')
      .then((module) => {
        const factory = module.default as unknown as (options?: unknown) => LibHeifApi
        const api = factory()
        if (!api || typeof api.HeifDecoder !== 'function') {
          throw new Error('modul libheif tidak lengkap')
        }
        return api
      })
      .catch((error: unknown) => {
        libHeifPromise = null
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(`Dekoder HEIC gagal dimuat (${reason}).`)
      })
  }

  return libHeifPromise
}

function releaseImage(image: HeifImage | null) {
  try {
    image?.free?.()
  } catch {
    // libheif sudah membersihkan handle-nya sendiri.
  }
}

function pickPrimary(images: HeifImage[]): HeifImage {
  for (const image of images) {
    if (typeof image.is_primary === 'function' && image.is_primary()) return image
  }
  // Tidak ada flag primary (HEIF tanpa 'pitm'): ambil gambar terbesar, karena
  // file HEIC sering juga menyimpan thumbnail kecil di dalamnya.
  let best = images[0]
  for (const image of images) {
    if (image.get_width() * image.get_height() > best.get_width() * best.get_height()) {
      best = image
    }
  }
  return best
}

export async function decodeHeifFile(file: File): Promise<HeifCanvasResult> {
  const api = await loadLibHeif()

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    throw new Error('File HEIC gagal dibaca dari perangkat.')
  }

  const decoder = new api.HeifDecoder()
  let images: HeifImage[] = []
  try {
    images = decoder.decode(bytes)
  } catch {
    images = []
  }

  if (!images || images.length === 0) {
    throw new Error('Isi file HEIC tidak dapat dibaca (mungkin HEIC 10-bit, ProRAW, atau file rusak).')
  }

  const image = pickPrimary(images)
  const width = image.get_width()
  const height = image.get_height()

  if (!width || !height) {
    images.forEach(releaseImage)
    throw new Error('Dimensi gambar HEIC tidak valid.')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    images.forEach(releaseImage)
    throw new Error('Canvas 2D tidak tersedia di browser ini.')
  }

  let imageData: ImageData | null = null
  try {
    imageData = context.createImageData(width, height)
  } catch {
    images.forEach(releaseImage)
    throw new Error(
      `Foto HEIC ${width}×${height} terlalu besar untuk memori browser ini. Coba foto dengan resolusi lebih rendah.`,
    )
  }

  const pixels = imageData
  if (!pixels) {
    images.forEach(releaseImage)
    throw new Error('Memori tidak cukup untuk mendekode foto HEIC ini.')
  }

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timeout = window.setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error('Proses decode HEIC terlalu lama dan dihentikan.'))
      }, DISPLAY_TIMEOUT_MS)

      const finish = (error: Error | null) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        if (error) reject(error)
        else resolve()
      }

      try {
        image.display(pixels, (displayed) => {
          finish(displayed ? null : new Error('Piksel HEIC gagal didekode.'))
        })
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
  } finally {
    images.forEach(releaseImage)
  }

  context.putImageData(pixels, 0, 0)
  imageData = null

  if (Math.max(width, height) <= MAX_SIDE) {
    return { canvas, width, height }
  }

  // Batasi ukuran agar langkah kompresi berikutnya tidak kehabisan memori di HP.
  const scale = MAX_SIDE / Math.max(width, height)
  const scaledWidth = Math.max(1, Math.round(width * scale))
  const scaledHeight = Math.max(1, Math.round(height * scale))

  const scaled = document.createElement('canvas')
  scaled.width = scaledWidth
  scaled.height = scaledHeight

  const scaledContext = scaled.getContext('2d')
  if (!scaledContext) return { canvas, width, height }

  scaledContext.imageSmoothingEnabled = true
  scaledContext.imageSmoothingQuality = 'high'
  scaledContext.drawImage(canvas, 0, 0, scaledWidth, scaledHeight)

  canvas.width = 0
  canvas.height = 0

  return { canvas: scaled, width: scaledWidth, height: scaledHeight }
}
