import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { openPdfDocument, destroyPdfDocument } from './pdfjs'

export interface PdfTextItem {
  str: string
  transform: number[]
  height: number
  width?: number
}

export interface PdfWordBlock {
  text: string
  kind: 'heading' | 'paragraph' | 'list'
  page: number
}

function cleanText(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim()
}

export function groupPdfTextItems(
  items: PdfTextItem[],
  pageNumber: number,
): PdfWordBlock[] {
  const usable = items.filter((item) => cleanText(item.str))
  if (usable.length === 0) return []

  usable.sort((a, b) => {
    const ay = a.transform[5] ?? 0
    const by = b.transform[5] ?? 0
    if (Math.abs(ay - by) > 1) return by - ay
    return (a.transform[4] ?? 0) - (b.transform[4] ?? 0)
  })

  const lines: PdfTextItem[][] = []
  for (const item of usable) {
    const y = item.transform[5] ?? 0
    const height = Math.max(item.height || 1, 1)
    const current = lines[lines.length - 1]
    if (!current) {
      lines.push([item])
      continue
    }
    const currentY = current[0].transform[5] ?? 0
    if (Math.abs(currentY - y) <= Math.max(height, current[0].height || 1) * 0.55) {
      current.push(item)
    } else {
      lines.push([item])
    }
  }

  const averageHeight =
    usable.reduce((sum, item) => sum + (item.height || 0), 0) / usable.length
  const blocks: PdfWordBlock[] = []

  for (const line of lines) {
    line.sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0))
    let text = ''
    let previousRight = 0

    for (const item of line) {
      const value = cleanText(item.str)
      if (!value) continue
      const x = item.transform[4] ?? 0
      const gap = previousRight > 0 ? x - previousRight : 0
      if (
        text &&
        gap >= -((item.height || 1) * 0.35) &&
        !/[([{'-]$/.test(text) &&
        !/^[,.;!?%)\]}]/.test(value)
      ) {
        text += ' '
      }
      text += value
      previousRight = x + (item.width ?? value.length * (item.height || 1) * 0.52)
    }

    text = cleanText(text)
    if (!text) continue

    const maxLineHeight = Math.max(...line.map((item) => item.height || 0))
    const startsBullet = /^[•●▪◦]\s*/.test(text)
    const startsNumber = /^\d{1,3}[.)]\s+/.test(text)
    const kind =
      startsBullet || startsNumber
        ? 'list'
        : maxLineHeight > averageHeight * 1.25 && text.length < 180
          ? 'heading'
          : 'paragraph'

    blocks.push({ text: text.replace(/^[•●▪◦]\s*/, '').trim(), kind, page: pageNumber })
  }

  return blocks
}

export async function extractPdfForWord(
  bytes: Uint8Array,
  onProgress?: (current: number, total: number) => void,
): Promise<PdfWordBlock[]> {
  const document = await openPdfDocument(bytes)
  const blocks: PdfWordBlock[] = []

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      onProgress?.(pageNumber, document.numPages)
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const items = content.items
        .flatMap((item) => {
          if (!('str' in item) || typeof item.str !== 'string') return []
          const textItem = item as unknown as {
            str: string
            transform: number[]
            height: number
            width: number
          }
          return [{
            str: textItem.str,
            transform: textItem.transform.map((value) => Number(value)),
            height: textItem.height,
            width: textItem.width,
          }]
        })
      blocks.push(...groupPdfTextItems(items, pageNumber))
    }
  } finally {
    await destroyPdfDocument(document)
  }

  return blocks
}

export async function createWordBlob(
  blocks: PdfWordBlock[],
  title: string,
): Promise<Blob> {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 34 })],
      spacing: { after: 300 },
    }),
  ]

  let previousPage = 0
  for (const block of blocks) {
    if (previousPage > 0 && block.page !== previousPage) {
      paragraphs.push(new Paragraph({ text: '', pageBreakBefore: true }))
    }
    previousPage = block.page

    if (block.kind === 'heading') {
      paragraphs.push(
        new Paragraph({
          text: block.text,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 120 },
        }),
      )
    } else if (block.kind === 'list') {
      paragraphs.push(
        new Paragraph({
          text: block.text,
          bullet: { level: 0 },
          spacing: { after: 80 },
        }),
      )
    } else {
      paragraphs.push(
        new Paragraph({
          text: block.text,
          spacing: { after: 120, line: 276 },
        }),
      )
    }
  }

  const doc = new Document({
    creator: 'LocalKit',
    title,
    description: 'Dikonversi secara lokal dari PDF dengan LocalKit.',
    sections: [{ children: paragraphs }],
  })

  return Packer.toBlob(doc)
}
