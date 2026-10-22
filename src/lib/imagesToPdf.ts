import { PDFDocument } from 'pdf-lib'
import { canvasToBlob, decodeImageFile } from './image'

export type PdfPaperSize = 'a4' | 'f4' | 'fit'
export type PdfOrientation = 'portrait' | 'landscape'

export interface ImagePdfOptions {
  paper: PdfPaperSize
  orientation: PdfOrientation
  marginMm: number
}

const MM_TO_PT = 72 / 25.4
const PAPER_SIZES: Record<'a4' | 'f4', [number, number]> = {
  a4: [210 * MM_TO_PT, 297 * MM_TO_PT],
  f4: [210 * MM_TO_PT, 330 * MM_TO_PT],
}

const MAX_IMAGE_SIDE = 2400
const JPEG_QUALITY = 0.92
/** "Fit to image" lays the image out at 200 DPI so pages stay printable. */
const FIT_PIXEL_TO_PT = 72 / 200
const FIT_MIN_LONG_SIDE = 240
const FIT_MAX_LONG_SIDE = 1200

export async function buildImagesPdf(
  files: File[],
  options: ImagePdfOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  if (files.length === 0) throw new Error('Tambahkan minimal satu gambar.')

  const pdf = await PDFDocument.create()
  const marginPt = Math.max(0, options.marginMm) * MM_TO_PT

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    let decoded: Awaited<ReturnType<typeof decodeImageFile>> | null = null

    try {
      decoded = await decodeImageFile(file)

      // Normalise orientation through a canvas and cap the long side so huge
      // phone photos do not turn into a 40 MB PDF.
      const downscale = Math.min(1, MAX_IMAGE_SIDE / Math.max(decoded.width, decoded.height))
      const pixelWidth = Math.max(1, Math.round(decoded.width * downscale))
      const pixelHeight = Math.max(1, Math.round(decoded.height * downscale))

      const canvas = document.createElement('canvas')
      canvas.width = pixelWidth
      canvas.height = pixelHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas 2D tidak tersedia di browser ini.')

      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, pixelWidth, pixelHeight)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(decoded.source, 0, 0, pixelWidth, pixelHeight)

      const blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY)
      canvas.width = 0
      canvas.height = 0

      const embedded = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()))

      let pageWidth: number
      let pageHeight: number
      let drawWidth: number
      let drawHeight: number
      let drawX: number
      let drawY: number

      if (options.paper === 'fit') {
        let contentWidth = pixelWidth * FIT_PIXEL_TO_PT
        let contentHeight = pixelHeight * FIT_PIXEL_TO_PT
        const longest = Math.max(contentWidth, contentHeight)

        if (longest > FIT_MAX_LONG_SIDE) {
          const factor = FIT_MAX_LONG_SIDE / longest
          contentWidth *= factor
          contentHeight *= factor
        } else if (longest < FIT_MIN_LONG_SIDE) {
          const factor = FIT_MIN_LONG_SIDE / longest
          contentWidth *= factor
          contentHeight *= factor
        }

        const fitMargin = Math.min(marginPt, Math.min(contentWidth, contentHeight) * 0.2)
        pageWidth = contentWidth + fitMargin * 2
        pageHeight = contentHeight + fitMargin * 2
        drawWidth = contentWidth
        drawHeight = contentHeight
        drawX = fitMargin
        drawY = fitMargin
      } else {
        const [shortSide, longSide] = PAPER_SIZES[options.paper]
        pageWidth = options.orientation === 'landscape' ? longSide : shortSide
        pageHeight = options.orientation === 'landscape' ? shortSide : longSide

        const safeMargin = Math.min(marginPt, Math.min(pageWidth, pageHeight) * 0.25)
        const availableWidth = Math.max(1, pageWidth - safeMargin * 2)
        const availableHeight = Math.max(1, pageHeight - safeMargin * 2)
        const scale = Math.min(availableWidth / pixelWidth, availableHeight / pixelHeight)

        drawWidth = pixelWidth * scale
        drawHeight = pixelHeight * scale
        drawX = (pageWidth - drawWidth) / 2
        drawY = (pageHeight - drawHeight) / 2
      }

      const page = pdf.addPage([pageWidth, pageHeight])
      page.drawImage(embedded, {
        x: drawX,
        y: drawY,
        width: drawWidth,
        height: drawHeight,
      })
    } finally {
      decoded?.release()
      onProgress?.(index + 1, files.length)
    }
  }

  if (pdf.getPageCount() === 0) throw new Error('Tidak ada gambar yang bisa diubah menjadi PDF.')

  pdf.setTitle('LocalKit — Images to PDF')
  pdf.setSubject('Dibuat secara lokal dengan LocalKit')
  pdf.setCreator('LocalKit (client-side)')
  pdf.setProducer('LocalKit · pdf-lib')

  return await pdf.save()
}
