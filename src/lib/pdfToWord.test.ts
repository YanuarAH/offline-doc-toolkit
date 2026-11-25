import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  applyLayoutRegions,
  buildDocumentIR,
  createWordBlob,
  createWordBlobFromIR,
  groupPdfTextItems,
  processPdfPageTextItems,
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

describe('applyLayoutRegions', () => {
  it('filters repeating headers and promotes title sections', () => {
    const blocks: PdfWordBlock[] = [
      { text: 'BAB I', kind: 'paragraph', page: 1, y: 950 },
      { text: 'Isi dokumen', kind: 'paragraph', page: 1, y: 800 },
      { text: 'Lampiran', kind: 'paragraph', page: 1, y: 50 },
    ]

    applyLayoutRegions(
      blocks,
      [
        { label: 'Title', score: 0.99, x: 100, y: 20, width: 400, height: 80 },
        { label: 'Text', score: 0.99, x: 100, y: 200, width: 400, height: 500 },
        { label: 'Page-header', score: 0.99, x: 100, y: 900, width: 400, height: 80 },
      ],
      600,
      1000,
    )

    expect(blocks.map((block) => block.text)).not.toContain('Lampiran')
    expect(blocks.find((block) => block.text === 'BAB I')?.kind).toBe('heading')
  })
})

describe('document IR', () => {
  it('keeps analyzed blocks grouped by page with stable identifiers', () => {
    const ir = buildDocumentIR(
      [
        { text: 'Judul', kind: 'heading', page: 1 },
        { text: 'Isi', kind: 'paragraph', page: 1 },
        { text: 'Halaman dua', kind: 'paragraph', page: 2 },
      ],
      'Contoh',
    )

    expect(ir.pages.map((page) => page.number)).toEqual([1, 2])
    expect(ir.pages[0].blocks[0]).toMatchObject({
      id: 'block-1-1',
      kind: 'heading',
      text: 'Judul',
    })
    expect(ir.blocks).toHaveLength(3)
  })

  it('applies layout classification before DOCX generation', async () => {
    const ir = buildDocumentIR(
      [{ text: 'Bagian', kind: 'paragraph', page: 1, x: 100, y: 100 }],
      'Contoh',
      new Map([
        [1, [{ label: 'Section-header', score: 0.99, x: 0, y: 0, width: 400, height: 200 }]],
      ]),
    )

    expect(ir.blocks[0].kind).toBe('heading')
    const blob = await createWordBlobFromIR(ir)
    expect(blob.size).toBeGreaterThan(100)
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
    const pageMetaByPage = new Map<number, ReturnType<typeof processPdfPageTextItems>['meta']>()

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const styles = (content.styles ?? {}) as Record<string, { fontFamily?: string } | undefined>
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
          fontFamily: textItem.fontName ? styles[textItem.fontName]?.fontFamily : undefined,
        }]
      })
      const processed = processPdfPageTextItems(items, pageNumber, viewport.width, viewport.height)
      blocks.push(...processed.blocks)
      pageMetaByPage.set(pageNumber, processed.meta)
    }

    const ir = buildDocumentIR(blocks, 'BAB I (Firdaus, 2025)', new Map(), pageMetaByPage)
    const blob = await createWordBlobFromIR(ir)
    const buffer = Buffer.from(await blob.arrayBuffer())
    fs.writeFileSync(outputPath, buffer)
    await loadingTask.destroy()

    expect(ir.blocks.some((b) => b.text.includes('BAB I') && b.text.includes('PENDAHULUAN'))).toBe(true)
    expect(ir.blocks.some((b) => b.text.includes('Rumusan Masalah'))).toBe(true)
    expect(ir.blocks.some((b) => b.text.includes('Manfaat Penelitian'))).toBe(true)
    expect(ir.blocks.length).toBeGreaterThan(15)
    expect(buffer.byteLength).toBeGreaterThan(1000)
  })

  it('decodes CID+29 shifted text and merges wrapped list items', () => {
    const blocks = groupPdfTextItems(
      [
        { str: '\u0000\u0014\u0000\u0011\u0000\u0015', transform: [1, 0, 0, 1, 85, 630], height: 12, fontName: 'g_d0_f8' },
        { str: '5\u0000X\u0000P\u0000X\u0000V\u0000D\u0000Q\u0000\u0003\u00000\u0000D\u0000V\u0000D\u0000O\u0000D\u0000K', transform: [1, 0, 0, 1, 106, 630], height: 12, fontName: 'g_d0_f8' },
        { str: '1.', transform: [1, 0, 0, 1, 85, 609], height: 12, fontName: 'g_d0_f2' },
        { str: 'Bagaimana cara', transform: [1, 0, 0, 1, 99, 609], height: 12, fontName: 'g_d0_f2' },
        { str: 'mengembangkan model ini?', transform: [1, 0, 0, 1, 99, 588], height: 12, fontName: 'g_d0_f2' },
      ],
      1,
    )

    expect(blocks[0]?.kind).toBe('heading')
    expect(blocks[0]?.text).toBe('1.2 Rumusan Masalah')
    expect(blocks[1]?.kind).toBe('list')
    expect(blocks[1]?.listStyle).toBe('decimal')
    expect(blocks[1]?.text).toBe('Bagaimana cara mengembangkan model ini?')
  })

  it('preserves per-span bold/italic and creates DOCX tables and images', async () => {
    const blocks = groupPdfTextItems(
      [
        { str: 'Tebal', transform: [1, 0, 0, 1, 50, 700], height: 12, fontName: 'Times-Bold' },
        { str: 'biasa', transform: [1, 0, 0, 1, 95, 700], height: 12, fontName: 'Times-Roman' },
      ],
      1,
    )
    expect(blocks[0]?.spans?.some((span) => span.text === 'Tebal' && span.bold)).toBe(true)
    expect(blocks[0]?.spans?.some((span) => span.text === 'biasa' && !span.bold)).toBe(true)

    const ir = buildDocumentIR(
      [
        ...blocks,
        {
          text: 'Kolom A | Kolom B',
          kind: 'table',
          page: 1,
          rows: [
            [{ text: 'Kolom A', bold: true }, { text: 'Kolom B', bold: true }],
            [{ text: 'Isi 1' }, { text: 'Isi 2' }],
          ],
          colWidthsPt: [200, 200],
        },
        {
          text: '[Picture]',
          kind: 'image',
          page: 1,
          image: {
            data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
            width: 120,
            height: 80,
          },
        },
      ],
      'Uji Lengkap',
    )

    const blob = await createWordBlobFromIR(ir)
    expect(blob.size).toBeGreaterThan(500)
  })
})
