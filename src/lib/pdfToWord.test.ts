import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  createWordBlob,
  groupPdfTextItems,
  type PdfTextItem,
  type PdfWordBlock,
} from './pdfToWord'

function item(str: string, x: number, y: number, height = 12): PdfTextItem {
  return {
    str,
    transform: [1, 0, 0, 1, x, y],
    height,
  }
}

describe('groupPdfTextItems', () => {
  it('groups words on the same line into a paragraph', () => {
    const blocks = groupPdfTextItems(
      [
        item('Dokumen', 10, 100),
        item('lokal', 55, 100),
        item('aman.', 90, 100),
      ],
      1,
    )

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      text: 'Dokumen lokal aman.',
      kind: 'paragraph',
      page: 1,
    })
  })

  it('detects headings and numbered lists', () => {
    const blocks = groupPdfTextItems(
      [
        item('Ringkasan', 10, 200, 20),
        item('1.', 10, 160),
        item('Ekspor hasil', 28, 160),
      ],
      2,
    )

    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'list'])
  })

  it('returns no blocks for empty text', () => {
    expect(groupPdfTextItems([item('   ', 10, 100)], 1)).toEqual([])
  })

  it('reads left column before right column', () => {
    const blocks = groupPdfTextItems(
      [
        item('Kolom kanan', 300, 180),
        item('Kolom kiri', 20, 180),
        item('lanjutan kanan', 300, 150),
        item('lanjutan kiri', 20, 150),
      ],
      1,
    )

    expect(blocks.map((block) => block.text)).toEqual([
      'Kolom kiri',
      'lanjutan kiri',
      'Kolom kanan',
      'lanjutan kanan',
    ])
  })
})

describe('createWordBlob', () => {
  it('creates a non-empty DOCX blob', async () => {
    const blob = await createWordBlob(
      [{ text: 'Contoh dokumen', kind: 'paragraph', page: 1 }],
      'Contoh',
    )

    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toContain('application/vnd.openxmlformats-officedocument')
    expect(blob.size).toBeGreaterThan(100)
  })

  it('generates a comparable LocalKit DOCX for the sample PDF', async () => {
    const pdfPath = 'contohpdftoword/BAB I (Firdaus, 2025).pdf'
    const outputPath = 'contohpdftoword/BAB I (Firdaus, 2025)_LocalKit.docx'
    if (!fs.existsSync(pdfPath)) return

    const bytes = new Uint8Array(fs.readFileSync(pdfPath))
    const loadingTask = pdfjs.getDocument({
      data: bytes,
      standardFontDataUrl: 'public/pdfjs/standard_fonts/',
      cMapUrl: 'public/pdfjs/cmaps/',
      cMapPacked: true,
    })
    const pdf = await loadingTask.promise
    const blocks: PdfWordBlock[] = []

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const items = content.items.flatMap((item) => {
        if (!('str' in item) || typeof item.str !== 'string') return []
        const textItem = item as unknown as {
          str: string
          transform: number[]
          height: number
          width: number
          fontName: string
        }
        return [{
          str: textItem.str,
          transform: textItem.transform,
          height: textItem.height,
          width: textItem.width,
          fontName: textItem.fontName,
        }]
      })
      blocks.push(...groupPdfTextItems(items, pageNumber))
    }

    const blob = await createWordBlob(blocks, 'BAB I (Firdaus, 2025)')
    const buffer = Buffer.from(await blob.arrayBuffer())
    fs.writeFileSync(outputPath, buffer)
    await loadingTask.destroy()

    expect(blocks.length).toBeGreaterThan(20)
    expect(buffer.byteLength).toBeGreaterThan(1000)
  })
})
