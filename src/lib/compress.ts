import { clamp } from './format'
import { canvasToBlob, ImageEncodeError, type DecodedImage } from './image'

export type OutputFormat = 'webp' | 'jpeg' | 'png'

export const FORMAT_MIME: Record<OutputFormat, string> = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

export const FORMAT_EXT: Record<OutputFormat, string> = {
  webp: 'webp',
  jpeg: 'jpg',
  png: 'png',
}

export const FORMAT_LABEL: Record<OutputFormat, string> = {
  webp: 'WebP',
  jpeg: 'JPEG',
  png: 'PNG',
}

export interface CompressOptions {
  format: OutputFormat
  /** null = fixed quality mode (no target size). */
  targetBytes: number | null
  quality?: number
}

export interface CompressResult {
  blob: Blob
  width: number
  height: number
  /** 1 for PNG (lossless quality is not configurable). */
  quality: number
  /** 1 = original dimensions. */
  scale: number
  /** Number of encode passes used, useful for debugging/telemetry in the UI. */
  passes: number
  reachedTarget: boolean
}

export const MIN_QUALITY = 0.1
export const MAX_QUALITY = 0.95
export const BINARY_SEARCH_STEPS = 7
export const DIMENSION_STEP = 0.85
const MAX_DIMENSION_ATTEMPTS = 24
const MIN_SIDE = 32

// Batas luas canvas per kelas perangkat. Tanpa batas ini foto 48–108 MP dari
// kamera HP menghasilkan canvas kosong di iOS (±16,7 juta piksel) atau toBlob
// null di Android low-end (memori habis saat meng-encode).
const CANVAS_LIMITS = {
  constrained: { pixels: 16_000_000, side: 4096 },
  desktop: { pixels: 48_000_000, side: 8192 },
} as const

const MAX_ENCODE_RETRIES = 8

/** HP/tablet dianggap terbatas: Safari iOS, Android, atau RAM perangkat ≤ 4 GB. */
function isConstrainedDevice(): boolean {
  if (typeof navigator === 'undefined') return false

  const userAgent = navigator.userAgent
  const isIOS =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (isIOS) return true
  if (/Android|Mobile|Windows Phone|IEMobile/i.test(userAgent)) return true

  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  return typeof memory === 'number' && memory > 0 && memory <= 4
}

export function initialCanvasScale(width: number, height: number): number {
  const limits = isConstrainedDevice() ? CANVAS_LIMITS.constrained : CANVAS_LIMITS.desktop
  const areaScale = Math.sqrt(limits.pixels / Math.max(1, width * height))
  const sideScale = limits.side / Math.max(width, height)
  return Math.min(1, areaScale, sideScale)
}


function drawToCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
  backgroundColor: string | null,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D tidak tersedia di browser ini.')

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  // JPEG/WebP have no alpha channel: bake a white background instead of the
  // black that would otherwise appear where the source was transparent.
  if (backgroundColor) {
    context.fillStyle = backgroundColor
    context.fillRect(0, 0, width, height)
  }

  context.drawImage(source, 0, 0, width, height)
  return canvas
}

export function encodeCanvas(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob> {
  return canvasToBlob(canvas, mimeType, quality)
}

/**
 * Compress an image to a target byte size.
 *
 * Strategy:
 *  1. Keep original dimensions and binary-search the quality (7 iterations,
 *     0.10 → 0.95) for the highest quality that fits under the target.
 *  2. If quality 0.10 still exceeds the target, multiply dimensions by 0.85
 *     and repeat, until the blob fits (or the image becomes unusably small).
 *
 * PNG is lossless, so quality has no effect there: only dimension stepping can
 * bring the file down. The result reports `reachedTarget` so the UI can warn.
 */
export async function compressImage(
  image: DecodedImage,
  options: CompressOptions,
): Promise<CompressResult> {
  const mime = FORMAT_MIME[options.format]
  const target =
    options.targetBytes !== null && options.targetBytes > 0 ? options.targetBytes : null

  let scale = initialCanvasScale(image.width, image.height)
  let passes = 0
  let lastAttempt: CompressResult | null = null
  let encodeFailures = 0

  for (let attempt = 0; attempt < MAX_DIMENSION_ATTEMPTS; attempt += 1) {
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))

    let canvas: HTMLCanvasElement | null = null

    try {
      canvas = drawToCanvas(
        image.source,
        width,
        height,
        options.format === 'png' ? null : '#ffffff',
      )

      if (target === null) {
        const quality = clamp(options.quality ?? 0.82, MIN_QUALITY, 1)
        const blob = await encodeCanvas(canvas, mime, quality)
        return {
          blob,
          width,
          height,
          quality,
          scale,
          passes: passes + 1,
          reachedTarget: true,
        }
      }

      if (options.format === 'png') {
        const blob = await encodeCanvas(canvas, mime)
        passes += 1
        lastAttempt = {
          blob,
          width,
          height,
          quality: 1,
          scale,
          passes,
          reachedTarget: blob.size <= target,
        }
        if (lastAttempt.reachedTarget) return lastAttempt
      } else {
        let low = MIN_QUALITY
        let high = MAX_QUALITY
        let bestBlob: Blob | null = null
        let bestQuality = MIN_QUALITY

        for (let step = 0; step < BINARY_SEARCH_STEPS; step += 1) {
          const quality = (low + high) / 2
          const blob = await encodeCanvas(canvas, mime, quality)
          passes += 1

          if (blob.size <= target) {
            bestBlob = blob
            bestQuality = quality
            low = quality
          } else {
            high = quality
          }
        }

        if (bestBlob) {
          return {
            blob: bestBlob,
            width,
            height,
            quality: bestQuality,
            scale,
            passes,
            reachedTarget: true,
          }
        }

        // Explicit floor check at exactly 0.10 before giving up on this size.
        const floorBlob = await encodeCanvas(canvas, mime, MIN_QUALITY)
        passes += 1
        lastAttempt = {
          blob: floorBlob,
          width,
          height,
          quality: MIN_QUALITY,
          scale,
          passes,
          reachedTarget: floorBlob.size <= target,
        }
        if (lastAttempt.reachedTarget) return lastAttempt
      }
    } catch (error) {
      if (!(error instanceof ImageEncodeError)) throw error
      // Canvas sebesar ini tidak muat di memori perangkat saat di-encode.
      // Perkecil dimensinya lalu coba lagi sebelum menyerah.
      encodeFailures += 1
      if (encodeFailures > MAX_ENCODE_RETRIES) {
        throw new ImageEncodeError(
          'Browser HP kehabisan memori saat meng-encode foto ini. Coba foto dengan resolusi lebih kecil, atau kompres di PC.',
        )
      }
    } finally {
      if (canvas) {
        // iOS menahan memori canvas sampai dimensinya di-reset. Ini penting saat
        // memproses banyak foto secara berurutan di HP.
        canvas.width = 0
        canvas.height = 0
      }
    }

    if (Math.min(width, height) <= MIN_SIDE) break
    scale *= DIMENSION_STEP
  }

  if (!lastAttempt) {
    if (encodeFailures > 0) {
      throw new ImageEncodeError(
        'Browser gagal meng-encode foto ini karena memori tidak cukup. Coba foto dengan resolusi lebih kecil.',
      )
    }
    throw new Error('Gambar tidak dapat dikompres.')
  }
  return { ...lastAttempt, reachedTarget: false }
}

let webpSupport: boolean | undefined

export async function isWebpSupported(): Promise<boolean> {
  if (webpSupport !== undefined) return webpSupport
  if (typeof document === 'undefined') return false

  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const blob = await canvasToBlob(canvas, 'image/webp', 0.8)
    webpSupport = blob.type === 'image/webp'
  } catch {
    webpSupport = false
  }

  return webpSupport
}
