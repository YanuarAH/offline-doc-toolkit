import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

// Worker is bundled locally by Vite (no CDN). Workbox precaches the .mjs file so
// PDF rendering keeps working with the network completely offline.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export { pdfjsLib }
export type { PDFDocumentProxy, PDFPageProxy }

const loadingTasks = new WeakMap<PDFDocumentProxy, ReturnType<typeof pdfjsLib.getDocument>>()

export async function openPdfDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js transfers the buffers it receives to the worker, which detaches them.
  // Always hand it a copy so the caller's original bytes remain usable by pdf-lib.
  const task = pdfjsLib.getDocument({
    data: bytes.slice(),
    // All PDF.js assets are served from our own origin and precached by Workbox:
    // standard fonts for non-embedded text, CMaps for CJK, wasm for image codecs.
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    iccUrl: '/pdfjs/iccs/',
  })
  const document = await task.promise
  loadingTasks.set(document, task)
  return document
}

export interface PdfRenderOptions {
  maxWidth?: number
  maxHeight?: number
  /** Absolute page rotation in degrees (page rotation + user rotation). */
  rotation?: number
  scale?: number
}

export async function renderPdfPage(
  page: PDFPageProxy,
  options: PdfRenderOptions = {},
): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1, rotation: options.rotation })

  let scale = options.scale ?? 1
  if (options.maxWidth || options.maxHeight) {
    const widthScale = options.maxWidth ? options.maxWidth / base.width : Number.POSITIVE_INFINITY
    const heightScale = options.maxHeight
      ? options.maxHeight / base.height
      : Number.POSITIVE_INFINITY
    scale = Math.min(widthScale, heightScale)
  }

  scale = Math.max(0.05, Math.min(scale, 4))
  const viewport = page.getViewport({ scale, rotation: options.rotation })

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(viewport.width))
  canvas.height = Math.max(1, Math.ceil(viewport.height))

  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D tidak tersedia di browser ini.')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  // "print" intent makes pdf.js render through microtasks instead of
  // requestAnimationFrame. Display-intent rendering can stall indefinitely in
  // background/occluded tabs (including headless browsers), which would leave
  // thumbnails and signature previews blank.
  await page.render({ canvas, viewport, background: '#ffffff', intent: 'print' }).promise
  return canvas
}

export async function renderPageThumbnail(
  page: PDFPageProxy,
  rotation: number,
  maxSize = 380,
): Promise<string> {
  const canvas = await renderPdfPage(page, {
    maxWidth: maxSize,
    maxHeight: maxSize,
    rotation,
  })
  return canvas.toDataURL('image/jpeg', 0.72)
}

export async function destroyPdfDocument(document: PDFDocumentProxy | null | undefined) {
  if (!document) return
  const task = loadingTasks.get(document)
  loadingTasks.delete(document)
  try {
    if (task) await task.destroy()
  } catch {
    // Already destroyed / worker gone — nothing to clean up.
  }
}
