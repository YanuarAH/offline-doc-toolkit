import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { openPdfDocument, destroyPdfDocument } from './pdfjs'

export interface PdfTextItem {
  str: string
  transform: number[]
  height: number
  width?: number
  fontName?: string
}

export interface PdfWordBlock {
  text: string
  kind: 'heading' | 'paragraph' | 'list'
  page: number
  x?: number
  y?: number
  indent?: number
  fontSize?: number
  bold?: boolean
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

  const heights = usable
    .map((item) => item.height || 0)
    .filter((height) => height > 0)
    .sort((a, b) => a - b)
  const bodyHeight =
    heights.length > 0 ? heights[Math.floor(heights.length * 0.5)] : 12
  const blocks: PdfWordBlock[] = []
  let previousLineY: number | null = null
  let previousLineHeight = 0
  let currentParagraph: PdfWordBlock | null = null

  for (const line of lines) {
    line.sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0))
    let text = ''
    let previousRight = 0
    const left = line[0]?.transform[4] ?? 0
    const lineY = line[0]?.transform[5] ?? 0
    const maxLineHeight = Math.max(...line.map((item) => item.height || 0))
    const fontSize = Math.max(
      ...line.map((item) => {
        const a = item.transform[0] || 0
        const d = item.transform[3] || 0
        return item.height || Math.sqrt(a * a + d * d)
      }),
    )
    const bold = line.some((item) =>
      /(bold|black|semibold|demibold)/i.test(item.fontName || ''),
    )

    for (const item of line) {
      const value = cleanText(item.str)
      if (!value) continue
      const x = item.transform[4] ?? 0
      const gap = previousRight > 0 ? x - previousRight : 0
      const estimatedWidth =
        (item.width ?? 0) > 0
          ? item.width ?? 0
          : value.length * Math.max(item.height || 1, 1) * 0.48
      if (
        text &&
        gap >= -((item.height || 1) * 0.35) &&
        !/[([{'-]$/.test(text) &&
        !/^[,.;!?%)\]}]/.test(value)
      ) {
        text += ' '
      }
      text += value
      previousRight = x + estimatedWidth
    }

    text = cleanText(text)
    if (!text) continue

    const startsBullet = /^[•●▪◦]\s*/.test(text)
    const startsNumber = /^\s*(?:[-•*]|\d{1,3}[.)])\s+/.test(text)
    const isHeading =
      fontSize > bodyHeight * 1.18 &&
      text.length < 180 &&
      (bold || fontSize > bodyHeight * 1.35)
    const kind =
      startsBullet || startsNumber
        ? 'list'
        : isHeading
          ? 'heading'
          : 'paragraph'
    const clean = text
      .replace(/^[•●▪◦]\s*/, '')
      .replace(/^[-*]\s+/, '')
      .replace(/^\d{1,3}[.)]\s+/, '')
      .trim()

    const lineGap =
      previousLineY === null
        ? 0
        : Math.abs(previousLineY - lineY)
    const shouldContinueParagraph =
      kind === 'paragraph' &&
      currentParagraph !== null &&
      currentParagraph.kind === 'paragraph' &&
      lineGap > 0 &&
      lineGap < Math.max(previousLineHeight, maxLineHeight) * 1.85 &&
      Math.abs((currentParagraph.indent ?? 0) - left) < 3 &&
      text.length > 0

    if (shouldContinueParagraph && currentParagraph) {
      currentParagraph.text = `${currentParagraph.text} ${clean}`
    } else {
      const indent = left >= 24 ? Math.round(left / 7) : 0
      const block: PdfWordBlock = {
        text: clean,
        kind,
        page: pageNumber,
        x: left,
        y: lineY,
        indent,
        fontSize: Math.round(fontSize * 10) / 10,
        bold,
      }
      blocks.push(block)
      currentParagraph = kind === 'paragraph' ? block : null
    }

    previousLineY = lineY
    previousLineHeight = maxLineHeight
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
            fontName: 'fontName' in item ? String(item.fontName) : undefined,
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
          children: [
            new TextRun({
              text: block.text,
              bold: true,
              size: Math.round((block.fontSize || 14) * 2),
            }),
          ],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 120 },
        }),
      )
    } else if (block.kind === 'list') {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: block.text,
              bold: block.bold,
              size: block.fontSize ? Math.round(block.fontSize * 2) : undefined,
            }),
          ],
          bullet: { level: 0 },
          spacing: { after: 80 },
        }),
      )
    } else {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: block.text,
              bold: block.bold,
              size: block.fontSize ? Math.round(block.fontSize * 2) : undefined,
            }),
          ],
          indent: block.indent
            ? { left: Math.max(0, block.indent) * 20 }
            : undefined,
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
