import { PDFDocument, degrees } from 'pdf-lib'
import type { PDFDocumentProxy } from './pdfjs'
import { clamp } from './format'

export interface SignaturePlacement {
  pageIndex: number
  /** All values are percentages relative to the displayed page. */
  xPct: number
  yPct: number
  widthPct: number
  heightPct: number
}

export interface StampSignatureOptions {
  pdfBytes: Uint8Array
  pdfjsDocument: PDFDocumentProxy
  signatureBytes: Uint8Array
  signatureType: 'png' | 'jpeg'
  placement: SignaturePlacement
}

/**
 * Stamp a signature image with visual-placement percentages.
 *
 * The center point is converted from the displayed page (what pdf.js renders,
 * including /Rotate) into PDF user space using pdf.js's own viewport. The image
 * is then counter-rotated by the page rotation so it appears upright on screen.
 */
export async function stampSignaturePdf(options: StampSignatureOptions): Promise<Uint8Array> {
  const { placement } = options
  const pdf = await PDFDocument.load(options.pdfBytes)

  const pages = pdf.getPages()
  const page = pages[placement.pageIndex]
  if (!page) throw new Error('Halaman yang dipilih tidak ditemukan di PDF.')

  const image =
    options.signatureType === 'png'
      ? await pdf.embedPng(options.signatureBytes)
      : await pdf.embedJpg(options.signatureBytes)

  const pdfjsPage = await options.pdfjsDocument.getPage(placement.pageIndex + 1)
  const viewport = pdfjsPage.getViewport({ scale: 1 })

  const widthPct = clamp(placement.widthPct, 0.5, 100)
  const heightPct = clamp(placement.heightPct, 0.5, 100)
  const xPct = clamp(placement.xPct, 0, Math.max(0, 100 - widthPct))
  const yPct = clamp(placement.yPct, 0, Math.max(0, 100 - heightPct))

  // Displayed page size in points (already accounts for page rotation).
  const drawWidth = (widthPct / 100) * viewport.width
  const drawHeight = (heightPct / 100) * viewport.height

  const centerXDisplay = ((xPct + widthPct / 2) / 100) * viewport.width
  const centerYDisplay = ((yPct + heightPct / 2) / 100) * viewport.height
  const [centerX, centerY] = viewport.convertToPdfPoint(
    centerXDisplay,
    centerYDisplay,
  ) as [number, number]

  const pageRotation = ((Math.round(pdfjsPage.rotate / 90) * 90) % 360 + 360) % 360
  const imageRotation = (360 - pageRotation) % 360

  let x = centerX - drawWidth / 2
  let y = centerY - drawHeight / 2

  // pdf-lib rotates drawImage around its (x, y) origin, so offset the origin
  // according to the rotation to keep the image centred on the intended spot.
  if (imageRotation === 90) {
    x = centerX + drawHeight / 2
    y = centerY - drawWidth / 2
  } else if (imageRotation === 180) {
    x = centerX + drawWidth / 2
    y = centerY + drawHeight / 2
  } else if (imageRotation === 270) {
    x = centerX - drawHeight / 2
    y = centerY + drawWidth / 2
  }

  page.drawImage(image, {
    x,
    y,
    width: drawWidth,
    height: drawHeight,
    rotate: degrees(imageRotation),
  })

  pdf.setTitle('LocalKit — Signed PDF')
  pdf.setSubject('Ditandatangani secara lokal dengan LocalKit')
  pdf.setCreator('LocalKit (client-side)')
  pdf.setProducer('LocalKit · pdf-lib')

  return await pdf.save()
}
