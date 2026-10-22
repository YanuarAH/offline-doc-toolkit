import { clamp } from './format'
import { canvasToBlob, type DecodedImage } from './image'

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

  let scale = 1
  let passes = 0
  let lastAttempt: CompressResult | null = null

  for (let attempt = 0; attempt < MAX_DIMENSION_ATTEMPTS; attempt += 1) {
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = drawToCanvas(
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

    if (Math.min(width, height) <= MIN_SIDE) break
    scale *= DIMENSION_STEP
  }

  if (!lastAttempt) throw new Error('Gambar tidak dapat dikompres.')
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
