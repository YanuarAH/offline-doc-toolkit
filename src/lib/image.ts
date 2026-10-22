import { clamp } from './format'

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

/** iPhone menyimpan foto sebagai HEIC; Chrome/Firefox tidak punya decoder HEVC. */
function isHeifFile(file: File): boolean {
  return /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
}

/**
 * Decode a user file into a drawable source. Prefers createImageBitmap because
 * it applies EXIF orientation ("from-image") and decodes off the main thread.
 * Falls back to an <img> element when the browser refuses the file.
 */
export async function decodeImageFile(file: File): Promise<DecodedImage> {
  const heif = isHeifFile(file)

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
      // Fall through to the <img> path below.
    }
  }

  const url = URL.createObjectURL(file)
  const image = new Image()
  image.decoding = 'async'

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () =>
        reject(
          new Error(
            heif
              ? 'Foto HEIC/HEIF tidak didukung browser ini. Pilih JPG/PNG, atau buka di Safari iPhone terbaru.'
              : 'Format gambar ini tidak didukung browser Anda.',
          ),
        )
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
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
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
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else
          reject(
            new Error(
              'Browser gagal meng-encode gambar ini. Coba format JPEG/PNG atau gambar dengan dimensi lebih kecil.',
            ),
          )
      },
      mimeType,
      quality,
    )
  })
}
