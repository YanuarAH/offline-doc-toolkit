import { clamp, formatBytes } from './format'
import { decodeHeifFile } from './heic'
import {
  FORMAT_NAME,
  isHeifFormat,
  readFileHead,
  readImageSize,
  sniffImageFormat,
  type ImageFormat,
} from './imageFormat'

export type WatermarkMode = 'tiled' | 'single'

export interface WatermarkSettings {
  text: string
  mode: WatermarkMode
  rotation: number
  opacity: number
  fontSize: number
  spacing: number
  color: string
}

export interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}

/** Longest side used for the live preview. Export always re-renders at native size. */
export const PREVIEW_MAX_DIMENSION = 1800

const FONT_STACK = '"Segoe UI", "Inter", system-ui, -apple-system, sans-serif'

/** Ukuran di atas ambang ini biasanya sudah di luar kemampuan decode browser HP. */
const MEGAPIXEL_MEMORY_LIMIT = 48

/** Error decode dengan pesan siap tampil dan format hasil deteksi magic bytes. */
export class ImageDecodeError extends Error {
  format: ImageFormat

  constructor(message: string, format: ImageFormat = 'unknown') {
    super(message)
    this.name = 'ImageDecodeError'
    this.format = format
  }
}

/** toBlob mengembalikan null: biasanya canvas terlalu besar untuk memori HP. */
export class ImageEncodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageEncodeError'
  }
}

function describeFailure(file: File, format: ImageFormat, head: Uint8Array): string {
  const name = FORMAT_NAME[format]
  const size = readImageSize(head)
  const megapixels = size ? (size.width * size.height) / 1_000_000 : 0

  if (size && megapixels >= MEGAPIXEL_MEMORY_LIMIT) {
    return `Foto ${name} ${size.width}×${size.height} (${megapixels.toFixed(0)} MP) terlalu besar untuk memori browser HP ini. Kompres di PC, atau pakai foto dengan resolusi lebih kecil.`
  }

  if (format === 'unknown') {
    return `File "${file.name}" bukan gambar yang dikenali (${formatBytes(file.size)}). Pakai JPG, PNG, WebP, atau HEIC.`
  }

  if (format === 'svg') {
    return 'File SVG belum bisa diproses sebagai foto. Ekspor dulu ke PNG, lalu unggah lagi.'
  }

  return `Format ${name} tidak bisa dibuka browser ini (${formatBytes(file.size)}). Ubah dulu ke JPG/PNG, lalu unggah lagi.`
}

function describeHeifFailure(
  format: ImageFormat,
  error: unknown,
  head: Uint8Array,
): string {
  const reason = error instanceof Error ? error.message : String(error)
  const size = readImageSize(head)
  const dims = size ? ` ${size.width}×${size.height}` : ''
  return `Foto ${FORMAT_NAME[format]}${dims} gagal dibuka. ${reason} Solusi cepat: ekspor ulang fotonya sebagai JPG dari aplikasi Galeri/Photos, lalu unggah lagi.`
}

/**
 * Jalur decode bawaan browser. createImageBitmap dipakai lebih dulu karena
 * menerapkan orientasi EXIF ("from-image") dan decode di luar main thread.
 * Mengembalikan null (bukan throw) supaya pemanggil bisa mencoba dekoder lain.
 */
async function decodeNatively(file: File): Promise<DecodedImage | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          release: () => bitmap.close(),
        }
      }
      bitmap.close()
    } catch {
      // Lanjut ke elemen <img> di bawah.
    }
  }

  const url = URL.createObjectURL(file)
  const image = new Image()
  image.decoding = 'async'

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('decode-failed'))
      image.src = url
    })

    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    if (!width || !height) throw new Error('Dimensi gambar tidak valid.')

    return {
      source: image,
      width,
      height,
      release: () => {
        image.src = ''
        URL.revokeObjectURL(url)
      },
    }
  } catch {
    image.src = ''
    URL.revokeObjectURL(url)
    return null
  }
}

/**
 * Decode file gambar apa pun menjadi sumber yang bisa digambar ke canvas.
 *
 * Urutan: decoder bawaan browser → libheif wasm untuk HEIC/HEIF/AVIF yang tidak
 * didukung browser HP. Error yang dilempar sudah berisi penyebab dan saran.
 */
export async function decodeImageFile(file: File): Promise<DecodedImage> {
  const head = await readFileHead(file, 4096).catch(() => new Uint8Array())
  const format = await sniffImageFormat(file, head)

  const native = await decodeNatively(file)
  if (native) return native

  if (isHeifFormat(format)) {
    try {
      const heif = await decodeHeifFile(file)
      return {
        source: heif.canvas,
        width: heif.width,
        height: heif.height,
        release: () => {
          heif.canvas.width = 0
          heif.canvas.height = 0
        },
      }
    } catch (error) {
      throw new ImageDecodeError(describeHeifFailure(format, error, head), format)
    }
  }

  throw new ImageDecodeError(describeFailure(file, format, head), format)
}

export function paintWatermark(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  settings: WatermarkSettings,
): void {
  const text = settings.text.trim()
  if (!text) return

  const fontSize = clamp((settings.fontSize / 100) * width, 8, width * 0.5)
  const angle = (settings.rotation * Math.PI) / 180

  context.save()
  context.globalAlpha = clamp(settings.opacity, 0.01, 1)
  context.fillStyle = settings.color
  context.font = `700 ${fontSize}px ${FONT_STACK}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'

  if (settings.mode === 'single') {
    context.translate(width / 2, height / 2)
    context.rotate(angle)

    const measured = context.measureText(text).width
    const maxWidth = width * 0.9
    if (measured > maxWidth) {
      const fittedSize = Math.max(8, fontSize * (maxWidth / measured))
      context.font = `700 ${fittedSize}px ${FONT_STACK}`
    }

    context.fillText(text, 0, 0)
    context.restore()
    return
  }

  const spacingPx = (settings.spacing / 100) * width
  const measured = Math.max(1, context.measureText(text).width)
  const stepX = measured + spacingPx
  const stepY = fontSize * 1.9 + spacingPx * 0.6

  // Rotate around the center, then cover the entire rotated bounding box with
  // a staggered grid of text so no corner of the document is left unmarked.
  const radius = Math.hypot(width, height) / 2
  const columns = Math.ceil(radius / stepX) + 1
  const rows = Math.ceil(radius / stepY) + 1

  context.translate(width / 2, height / 2)
  context.rotate(angle)

  for (let row = -rows; row <= rows; row += 1) {
    const stagger = Math.abs(row % 2) === 1 ? stepX / 2 : 0
    for (let column = -columns; column <= columns; column += 1) {
      context.fillText(text, column * stepX + stagger, row * stepY)
    }
  }

  context.restore()
}

/**
 * Render straight into an existing canvas (used by the live preview so a huge
 * image is not reallocated on every slider tick).
 */
export function renderWatermarkToCanvas(
  canvas: HTMLCanvasElement,
  image: DecodedImage,
  settings: WatermarkSettings,
  maxDimension?: number,
): { width: number; height: number } {
  const scale =
    maxDimension && maxDimension > 0
      ? Math.min(1, maxDimension / Math.max(image.width, image.height))
      : 1

  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }

  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D tidak tersedia di browser ini.')

  context.clearRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image.source, 0, 0, width, height)
  paintWatermark(context, width, height, settings)

  return { width, height }
}

export function createWatermarkCanvas(
  image: DecodedImage,
  settings: WatermarkSettings,
  maxDimension?: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  renderWatermarkToCanvas(canvas, image, settings, maxDimension)
  return canvas
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const fail = (reason: unknown) =>
      reject(
        new ImageEncodeError(
          reason instanceof Error
            ? `Browser gagal meng-encode gambar ini: ${reason.message}`
            : 'Browser gagal meng-encode gambar ini (kemungkinan memori HP penuh). Coba gambar dengan dimensi lebih kecil.',
        ),
      )

    try {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else fail(null)
        },
        mimeType,
        quality,
      )
    } catch (error) {
      fail(error)
    }
  })
}
