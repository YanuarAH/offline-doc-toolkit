import { describe, expect, it } from 'vitest'
import { createWordBlob, groupPdfTextItems, type PdfTextItem } from './pdfToWord'

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
})
