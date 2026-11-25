import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
  type INumberingOptions,
  type ISectionOptions,
} from 'docx'
import {
  destroyPdfDocument,
  openPdfDocument,
  renderPdfPage,
} from './pdfjs'
import {
  detectDocumentLayout,
  type LayoutProgress,
  type LayoutRegion,
} from './documentLayoutModel'

export interface PdfTextItem {
  str: string
  transform: number[]
  height: number
  width?: number
  fontName?: string
  fontFamily?: string
}

export interface PdfWordSpan {
  text: string
  bold?: boolean
  italic?: boolean
  fontSize?: number
  fontFamily?: string
}

export interface PdfTableCell {
  text: string
  spans?: PdfWordSpan[]
  alignment?: 'left' | 'center' | 'right' | 'justified'
  bold?: boolean
}

export interface PdfWordImage {
  data: Uint8Array
  width: number
  height: number
}

export interface PdfWordBlock {
  text: string
  kind: 'heading' | 'paragraph' | 'list' | 'table' | 'image' | 'caption' | 'footnote'
  page: number
  x?: number
  y?: number
  width?: number
  height?: number
  indent?: number
  leftIndentPt?: number
  firstLineIndentPt?: number
  hangingIndentPt?: number
  spaceBeforePt?: number
  spaceAfterPt?: number
  lineSpacing?: number
  fontSize?: number
  fontFamily?: string
  bold?: boolean
  italic?: boolean
  spans?: PdfWordSpan[]
  lineTexts?: string[]
  alignment?: 'left' | 'center' | 'right' | 'justified'
  listStyle?: 'bullet' | 'decimal'
  listGroupId?: string
  headingLevel?: 1 | 2
  pageBreakBefore?: boolean
  rows?: PdfTableCell[][]
  colWidthsPt?: number[]
  image?: PdfWordImage
}

export interface DocumentSpanIR extends PdfWordSpan {}

export interface DocumentBlockIR extends PdfWordBlock {
  id: string
  spans?: DocumentSpanIR[]
}

export interface PageMarginsPt {
  top: number
  right: number
  bottom: number
  left: number
}

export interface PageNumberPlacement {
  position: 'header' | 'footer'
  alignment: 'left' | 'center' | 'right'
}

export interface DocumentPageIR {
  number: number
  width?: number
  height?: number
  margins?: PageMarginsPt
  pageNumberPlacement?: PageNumberPlacement
  endsEarly?: boolean
  blocks: DocumentBlockIR[]
  layoutRegions: LayoutRegion[]
}

export interface DocumentIR {
  title: string
  defaultFontFamily?: string
  defaultFontSizePt?: number
  pages: DocumentPageIR[]
  blocks: DocumentBlockIR[]
}

const DEFAULT_PAGE_WIDTH_PT = 595.28 // A4
const DEFAULT_PAGE_HEIGHT_PT = 841.89
const DEFAULT_MARGINS_PT: PageMarginsPt = {
  top: 72,
  right: 72,
  bottom: 72,
  left: 72,
}

function hasControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) < 32) return true
  }
  return false
}

/**
 * Decode TrueType Identity-H Glyph IDs (+29 offset) yang sering muncul saat PDF
 * tidak menyertakan /ToUnicode CMap yang lengkap (mis. karakter NUL dan kontrol < 32).
 */
function decodeCidShiftedText(raw: string): string {
  if (!hasControlChars(raw)) return raw

  const stripped = raw.replaceAll('\0', '')
  if (!stripped) return ''

  // Uji apakah shift +29 menghasilkan ASCII yang terbaca
  let shifted = ''
  let printableCount = 0
  let letterOrDigitCount = 0
  for (let i = 0; i < stripped.length; i += 1) {
    const code = stripped.charCodeAt(i)
    const next = code + 29
    if (next >= 32 && next <= 126) {
      shifted += String.fromCharCode(next)
      printableCount += 1
      if (/[A-Za-z0-9]/.test(String.fromCharCode(next))) letterOrDigitCount += 1
    } else {
      shifted += stripped[i]
    }
  }

  if (printableCount === stripped.length && letterOrDigitCount > 0) {
    return shifted
  }
  return stripped
}

function cleanText(text: string): string {
  return decodeCidShiftedText(text)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function indentUnits(left: number): number {
  return left >= 24 ? Math.round(left / 7) : 0
}

function isPdfArtifact(text: string): boolean {
  const clean = cleanText(text)
  return (
    /^library\.uns\.ac\.id$/i.test(clean) ||
    /^digilib\.uns\.ac\.id$/i.test(clean) ||
    /^chapter\s+\d+$/i.test(clean)
  )
}

function isBoldFont(fontName?: string, fontFamily?: string): boolean {
  const combined = `${fontName || ''} ${fontFamily || ''}`
  return /(bold|black|heavy|semibold|demibold|(^|[^a-z])f4([^a-z]|$)|(^|[^a-z])f8([^a-z]|$))/i.test(
    combined,
  )
}

function isItalicFont(fontName?: string, fontFamily?: string): boolean {
  const combined = `${fontName || ''} ${fontFamily || ''}`
  return /(italic|oblique|slant|(^|[^a-z])f7([^a-z]|$))/i.test(combined)
}

function resolveDocxFontFamily(pdfFontFamily?: string): string | undefined {
  if (!pdfFontFamily) return undefined
  const lower = pdfFontFamily.toLowerCase()
  if (lower === 'serif' || lower.includes('times')) return 'Times New Roman'
  if (lower === 'sans-serif' || lower.includes('arial') || lower.includes('helvetica')) {
    return 'Arial'
  }
  if (lower === 'monospace' || lower.includes('courier')) return 'Courier New'
  return pdfFontFamily
}

function itemFontSize(item: PdfTextItem): number {
  if (item.height && item.height > 0) return item.height
  const a = item.transform[0] || 0
  const d = item.transform[3] || 0
  return Math.max(1, Math.sqrt(a * a + d * d))
}

function itemWidth(item: PdfTextItem, value: string): number {
  if ((item.width ?? 0) > 0) return item.width ?? 0
  return value.length * Math.max(itemFontSize(item), 1) * 0.48
}

interface LineMetrics {
  text: string
  clean: string
  spans: PdfWordSpan[]
  left: number
  right: number
  y: number
  maxHeight: number
  fontSize: number
  fontFamily?: string
  bold: boolean
  italic: boolean
  kind: 'heading' | 'paragraph' | 'list'
  listStyle?: 'bullet' | 'decimal'
  listContentLeft?: number
  headingLevel?: 1 | 2
}

function detectLineAlignment(
  lineLeft: number,
  lineRight: number,
  contentLeft: number,
  contentRight: number,
  isLastLineOfParagraph: boolean,
  isMultiLine: boolean,
): 'left' | 'center' | 'right' | 'justified' {
  const contentWidth = Math.max(40, contentRight - contentLeft)
  const leftMargin = lineLeft - contentLeft
  const rightMargin = contentRight - lineRight
  const lineWidth = lineRight - lineLeft

  if (
    lineWidth < contentWidth * 0.85 &&
    leftMargin > 18 &&
    rightMargin > 18 &&
    Math.abs(leftMargin - rightMargin) <= 22
  ) {
    return 'center'
  }

  if (
    !isMultiLine &&
    lineWidth < contentWidth * 0.65 &&
    leftMargin > contentWidth * 0.35 &&
    Math.abs(rightMargin) <= 18
  ) {
    return 'right'
  }

  if (isMultiLine && !isLastLineOfParagraph && rightMargin <= 24) {
    return 'justified'
  }

  return 'left'
}

export function groupPdfTextItems(
  items: PdfTextItem[],
  pageNumber: number,
  contentBounds?: { left: number; right: number },
): PdfWordBlock[] {
  // Gabungkan item zero-width '\u0000' atau fragmen kontrol bersebelahan pada baris yang sama sebelum filter
  const preMerged: PdfTextItem[] = []
  for (const item of items) {
    const size = itemFontSize(item)
    // Abaikan teks mikro tersembunyi (< 3pt, mis. watermark/bookmark "Chapter 1" 0.96pt)
    if (size < 3) continue
    if (item.str === '\u0000') continue
    const prev = preMerged[preMerged.length - 1]
    if (
      prev &&
      hasControlChars(prev.str) &&
      hasControlChars(item.str) &&
      Math.abs((prev.transform[5] ?? 0) - (item.transform[5] ?? 0)) < 1 &&
      Math.abs((prev.transform[4] ?? 0) - (item.transform[4] ?? 0)) < 1
    ) {
      prev.str += item.str
      prev.width = Math.max(prev.width ?? 0, item.width ?? 0)
      continue
    }
    preMerged.push({ ...item })
  }

  const usable = preMerged.filter(
    (item) => cleanText(item.str) && !isPdfArtifact(item.str),
  )
  if (usable.length === 0) return []

  if (!contentBounds) {
    const xPositions = [...new Set(
      usable.map((item) => item.transform[4] ?? 0).sort((a, b) => a - b),
    )]
    let largestGap = 0
    let columnCut = 0
    for (let index = 1; index < xPositions.length; index += 1) {
      const gap = xPositions[index] - xPositions[index - 1]
      if (gap > largestGap) {
        largestGap = gap
        columnCut = (xPositions[index] + xPositions[index - 1]) / 2
      }
    }
    if (largestGap >= 80) {
      const left = usable.filter((item) => (item.transform[4] ?? 0) < columnCut)
      const right = usable.filter((item) => (item.transform[4] ?? 0) >= columnCut)
      if (left.length > 0 && right.length > 0) {
        return [
          ...groupPdfTextItems(left, pageNumber),
          ...groupPdfTextItems(right, pageNumber),
        ]
      }
    }
  }

  const sortedItems = [...usable].sort((a, b) => {
    const ay = a.transform[5] ?? 0
    const by = b.transform[5] ?? 0
    if (Math.abs(ay - by) > 1.5) return by - ay
    return (a.transform[4] ?? 0) - (b.transform[4] ?? 0)
  })

  const rawLines: PdfTextItem[][] = []
  for (const item of sortedItems) {
    const y = item.transform[5] ?? 0
    const height = Math.max(itemFontSize(item), 1)
    const current = rawLines[rawLines.length - 1]
    if (!current) {
      rawLines.push([item])
      continue
    }
    const currentY = current[0].transform[5] ?? 0
    if (Math.abs(currentY - y) <= Math.max(height, itemFontSize(current[0])) * 0.55) {
      current.push(item)
    } else {
      rawLines.push([item])
    }
  }

  const heights = sortedItems
    .map((item) => itemFontSize(item))
    .filter((height) => height > 0)
    .sort((a, b) => a - b)
  const bodyHeight =
    heights.length > 0 ? heights[Math.floor(heights.length * 0.5)] : 12

  // Hitung jarak baris normal dokumen (median antar baris berdekatan) agar w:line dan w:before akurat
  const consecutiveGaps: number[] = []
  for (let i = 1; i < rawLines.length; i += 1) {
    const gap = Math.abs((rawLines[i - 1][0].transform[5] ?? 0) - (rawLines[i][0].transform[5] ?? 0))
    if (gap >= bodyHeight * 0.9 && gap <= bodyHeight * 2.2) {
      consecutiveGaps.push(gap)
    }
  }
  consecutiveGaps.sort((a, b) => a - b)
  const bodyLineStep =
    consecutiveGaps.length > 0
      ? consecutiveGaps[Math.floor(consecutiveGaps.length * 0.5)]
      : bodyHeight * 1.15
  const defaultLineSpacingTwips = Math.max(
    240,
    Math.min(480, Math.round((bodyLineStep / Math.max(1, bodyHeight * 1.15)) * 240)),
  )

  const bodyLeftCandidates = rawLines
    .map((line) => Math.min(...line.map((item) => item.transform[4] ?? 0)))
    .sort((a, b) => a - b)
  const estimatedPageLeft =
    contentBounds?.left ??
    (bodyLeftCandidates.length > 0
      ? bodyLeftCandidates[Math.floor(bodyLeftCandidates.length * 0.05)]
      : 0)
  const estimatedPageRight =
    contentBounds?.right ??
    Math.max(
      ...rawLines.map((line) =>
        Math.max(...line.map((item) => (item.transform[4] ?? 0) + itemWidth(item, cleanText(item.str)))),
      ),
    )

  const parsedLines: LineMetrics[] = []
  for (const line of rawLines) {
    line.sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0))
    let text = ''
    const spans: PdfWordSpan[] = []
    let previousRight = 0
    let previousTrailingSpace = false
    const left = line[0]?.transform[4] ?? 0
    const lineY = line[0]?.transform[5] ?? 0
    const maxHeight = Math.max(...line.map((item) => itemFontSize(item)))
    const fontSize = maxHeight
    const lineFontFamily = resolveDocxFontFamily(line[0]?.fontFamily)

    for (const item of line) {
      const decoded = decodeCidShiftedText(item.str)
      const hasLeadingSpace = /^\s/.test(decoded)
      const hasTrailingSpace = /\s$/.test(decoded)
      const value = cleanText(decoded)
      if (!value) {
        if (hasLeadingSpace || hasTrailingSpace) previousTrailingSpace = true
        continue
      }
      const x = item.transform[4] ?? 0
      const gap = previousRight > 0 ? x - previousRight : 0
      const width = itemWidth(item, value)
      const size = Math.round(itemFontSize(item) * 10) / 10
      const itemBold = isBoldFont(item.fontName, item.fontFamily)
      const itemItalic = isItalicFont(item.fontName, item.fontFamily)
      const fontFamily = resolveDocxFontFamily(item.fontFamily)

      if (
        text &&
        (previousTrailingSpace ||
          hasLeadingSpace ||
          (gap >= -(size * 0.35) &&
            !/[([{'-]$/.test(text) &&
            !/^[,.;!?%)\]}]/.test(value)))
      ) {
        text += ' '
        spans.push({
          text: ' ',
          bold: itemBold,
          italic: itemItalic,
          fontSize: size,
          fontFamily,
        })
      }
      text += value
      previousTrailingSpace = hasTrailingSpace
      const prevSpan = spans[spans.length - 1]
      if (
        prevSpan &&
        prevSpan.text.trim().length > 0 &&
        prevSpan.bold === itemBold &&
        prevSpan.italic === itemItalic &&
        prevSpan.fontSize === size &&
        prevSpan.fontFamily === fontFamily
      ) {
        prevSpan.text += value
      } else {
        spans.push({
          text: value,
          bold: itemBold,
          italic: itemItalic,
          fontSize: size,
          fontFamily,
        })
      }
      previousRight = Math.max(previousRight, x + width)
    }

    text = cleanText(text)
    if (!text) continue

    const bold = spans.every((span) => !span.text.trim() || span.bold)
    const italic = spans.some((span) => span.italic)

    const lineAlign = detectLineAlignment(
      left,
      previousRight,
      estimatedPageLeft,
      estimatedPageRight,
      true,
      false,
    )

    const numberedSectionPattern =
      /^(?:\d{1,2}\.\d+(?:\.\d+)?\s+.{2,120}|(?:BAB\s+[IVXLCDM\d]+|CHAPTER\s+\d+)(?:\s+.*)?)$/i
    const knownHeadingWords =
      /^(?:PENDAHULUAN|TINJAUAN PUSTAKA|METODOLOGI PENELITIAN|HASIL DAN PEMBAHASAN|KESIMPULAN DAN SARAN|DAFTAR PUSTAKA|Latar Belakang|Rumusan Masalah|Batasan Masalah|Tujuan Penelitian|Manfaat Penelitian|Metodologi Penelitian)$/i

    const startsBullet = /^[•●▪◦]\s*/.test(text) || /^[-*]\s+/.test(text)
    const startsNumber = /^\s*\d{1,3}[.)]\s+/.test(text) && !numberedSectionPattern.test(text)

    const isCenteredShortBold =
      bold && lineAlign === 'center' && text.length < 100
    const isHeading =
      numberedSectionPattern.test(text) ||
      knownHeadingWords.test(text) ||
      isCenteredShortBold ||
      (fontSize > bodyHeight * 1.18 &&
        text.length < 180 &&
        (bold || fontSize > bodyHeight * 1.35))

    const kind: LineMetrics['kind'] =
      startsBullet || startsNumber
        ? 'list'
        : isHeading
          ? 'heading'
          : 'paragraph'

    const headingLevel: 1 | 2 | undefined = isHeading
      ? /^(?:BAB\s+|CHAPTER\s+)/i.test(text) || isCenteredShortBold
        ? 1
        : 2
      : undefined

    const clean =
      kind === 'list'
        ? text
            .replace(/^[•●▪◦]\s*/, '')
            .replace(/^[-*]\s+/, '')
            .replace(/^\d{1,3}[.)]\s+/, '')
            .trim()
        : text

    // Jika baris adalah list, buang token marker awal ('1.', '•', dll) dari spans
    let lineSpans = spans
    let listContentLeft: number | undefined
    if (kind === 'list') {
      const markerMatch = text.match(/^([•●▪◦]|[-*]|\d{1,3}[.)])\s*/)
      const markerLen = markerMatch ? markerMatch[0].length : 0
      if (markerLen > 0) {
        let remainingToDrop = markerLen
        const trimmedSpans: PdfWordSpan[] = []
        for (const span of spans) {
          if (remainingToDrop <= 0) {
            trimmedSpans.push(span)
            continue
          }
          if (span.text.length <= remainingToDrop) {
            remainingToDrop -= span.text.length
          } else {
            trimmedSpans.push({
              ...span,
              text: span.text.slice(remainingToDrop),
            })
            remainingToDrop = 0
          }
        }
        lineSpans = trimmedSpans.filter((span) => span.text.length > 0)
      }
      if (line.length > 1) {
        listContentLeft = line[1].transform[4] ?? left + 14
      } else {
        listContentLeft = left + 14
      }
    }

    parsedLines.push({
      text,
      clean,
      spans: lineSpans,
      left,
      right: previousRight,
      y: lineY,
      maxHeight,
      fontSize: Math.round(fontSize * 10) / 10,
      fontFamily: lineFontFamily,
      bold,
      italic,
      kind,
      listStyle: startsBullet ? 'bullet' : startsNumber ? 'decimal' : undefined,
      listContentLeft,
      headingLevel,
    })
  }

  if (parsedLines.length === 0) return []

  const contentLeft = estimatedPageLeft
  const contentRight = estimatedPageRight
  const contentWidth = Math.max(40, contentRight - contentLeft)

  const blocks: PdfWordBlock[] = []
  let previousLineY: number | null = null
  let previousLineHeight = 0
  let currentLines: LineMetrics[] = []
  let currentBlock: PdfWordBlock | null = null
  let listGroupSeq = 0
  let activeListGroupId: string | undefined

  const finalizeCurrentBlock = () => {
    if (!currentBlock || currentLines.length === 0) return
    const first = currentLines[0]
    const last = currentLines[currentLines.length - 1]
    const isMultiLine = currentLines.length > 1

    if (currentBlock.kind === 'heading') {
      currentBlock.leftIndentPt = 0
      currentBlock.firstLineIndentPt = 0
      if (first.headingLevel === 1) {
        currentBlock.alignment = 'center'
      } else {
        currentBlock.alignment = detectLineAlignment(
          first.left,
          Math.max(...currentLines.map((line) => line.right)),
          contentLeft,
          contentRight,
          true,
          false,
        )
      }
      return
    }

    if (currentBlock.kind === 'list') {
      const markerLeft = first.left
      const wrapLeft =
        isMultiLine
          ? Math.min(...currentLines.slice(1).map((line) => line.left))
          : first.listContentLeft ?? markerLeft + 14
      const hanging = Math.max(10, Math.round(wrapLeft - markerLeft))
      currentBlock.leftIndentPt = Math.max(0, Math.round(wrapLeft - contentLeft))
      currentBlock.hangingIndentPt = hanging
      currentBlock.firstLineIndentPt = 0
      currentBlock.alignment = isMultiLine ? 'justified' : 'left'
      if (isMultiLine && last) {
        const avgGap =
          Math.abs(first.y - last.y) / Math.max(1, currentLines.length - 1)
        const ratio = avgGap / Math.max(1, first.fontSize * 1.15)
        if (ratio >= 0.9 && ratio <= 2.2) {
          currentBlock.lineSpacing = Math.round(ratio * 240)
        }
      }
      return
    }

    const baseLeft = isMultiLine
      ? Math.min(...currentLines.slice(1).map((line) => line.left))
      : first.left

    const leftIndentPt = isMultiLine ? Math.max(0, baseLeft - contentLeft) : 0
    const firstLineIndentPt = isMultiLine
      ? Math.max(0, first.left - baseLeft)
      : Math.max(0, first.left - contentLeft)

    const alignment = detectLineAlignment(
      first.left,
      Math.max(...currentLines.map((line) => line.right)),
      contentLeft,
      contentRight,
      !isMultiLine,
      isMultiLine,
    )

    if (alignment === 'center' || alignment === 'right') {
      currentBlock.leftIndentPt = 0
      currentBlock.firstLineIndentPt = 0
      currentBlock.alignment = alignment
    } else {
      currentBlock.leftIndentPt = leftIndentPt > 4 ? Math.round(leftIndentPt) : 0
      currentBlock.firstLineIndentPt =
        firstLineIndentPt > 4 ? Math.round(firstLineIndentPt) : 0
      currentBlock.alignment =
        isMultiLine &&
        currentLines.slice(0, -1).some((line) => contentRight - line.right <= 28)
          ? 'justified'
          : alignment
    }

    if (last && isMultiLine) {
      const avgGap =
        Math.abs(first.y - last.y) / Math.max(1, currentLines.length - 1)
      const ratio = avgGap / Math.max(1, first.fontSize * 1.15)
      if (ratio >= 0.9 && ratio <= 2.2) {
        currentBlock.lineSpacing = Math.round(ratio * 240)
      }
    }
  }

  for (const line of parsedLines) {
    const lineGap =
      previousLineY === null ? 0 : Math.abs(previousLineY - line.y)
    const isNewParagraphIndent =
      currentBlock !== null &&
      currentLines.length > 0 &&
      line.left - contentLeft >= 14 &&
      (currentLines.length === 1
        ? line.left - currentLines[0].left > 14
        : Math.abs(line.left - currentLines[currentLines.length - 1].left) >= 14)

    const prevLine = currentLines[currentLines.length - 1]
    const prevLineEndedShort =
      prevLine !== undefined &&
      prevLine.right < contentRight - contentWidth * 0.14 &&
      /[.!?:”"')]/.test(prevLine.clean.slice(-1))

    const shouldMergeHeading =
      line.kind === 'heading' &&
      currentBlock !== null &&
      currentBlock.kind === 'heading' &&
      currentBlock.headingLevel === 1 &&
      line.headingLevel === 1 &&
      lineGap > 0 &&
      lineGap < Math.max(previousLineHeight, line.maxHeight) * 2.2

    const shouldContinueList =
      currentBlock !== null &&
      currentBlock.kind === 'list' &&
      line.kind === 'paragraph' &&
      lineGap > 0 &&
      lineGap < Math.max(previousLineHeight, line.maxHeight) * 2.1 &&
      line.left > (currentBlock.x ?? 0) + 4

    const shouldContinueParagraph =
      line.kind === 'paragraph' &&
      currentBlock !== null &&
      currentBlock.kind === 'paragraph' &&
      !isNewParagraphIndent &&
      !prevLineEndedShort &&
      lineGap > 0 &&
      lineGap < Math.max(previousLineHeight, line.maxHeight) * 2.1 &&
      line.text.length > 0

    if ((shouldMergeHeading || shouldContinueList || shouldContinueParagraph) && currentBlock) {
      const joinWithSpace = !currentBlock.text.endsWith('-')
      currentBlock.text = joinWithSpace
        ? `${currentBlock.text} ${line.clean}`
        : `${currentBlock.text}${line.clean}`

      if (shouldMergeHeading) {
        // Pertahankan pemisah baris pada heading multi-baris (mis. BAB I \n PENDAHULUAN)
        currentBlock.lineTexts = currentBlock.lineTexts
          ? [...currentBlock.lineTexts, line.clean]
          : [currentLines[0].clean, line.clean]
        currentBlock.spans = [
          ...(currentBlock.spans ?? []),
          { text: '\n' },
          ...line.spans,
        ]
      } else {
        currentBlock.spans = [
          ...(currentBlock.spans ?? []),
          ...(joinWithSpace ? [{ text: ' ' }] : []),
          ...line.spans,
        ]
      }
      if (line.italic) currentBlock.italic = true
      currentLines.push(line)
    } else {
      finalizeCurrentBlock()
      const indent = indentUnits(line.left)
      const extraGap =
        previousLineY !== null ? lineGap - bodyLineStep : 0
      const spaceBeforePt =
        extraGap > 3
          ? Math.min(24, Math.round(extraGap))
          : undefined

      if (line.kind === 'list') {
        if (!activeListGroupId || currentBlock?.kind !== 'list' || (spaceBeforePt ?? 0) > 8) {
          listGroupSeq += 1
          activeListGroupId = `list-${pageNumber}-${listGroupSeq}`
        }
      } else {
        activeListGroupId = undefined
      }

      const alignment = detectLineAlignment(
        line.left,
        line.right,
        contentLeft,
        contentRight,
        true,
        false,
      )

      const block: PdfWordBlock = {
        text: line.clean,
        kind: line.kind,
        page: pageNumber,
        x: line.left,
        y: line.y,
        indent,
        leftIndentPt:
          alignment === 'left' && line.kind !== 'heading' && line.left - contentLeft > 4
            ? Math.round(line.left - contentLeft)
            : 0,
        spaceBeforePt,
        spaceAfterPt: 0,
        lineSpacing: defaultLineSpacingTwips,
        fontSize: line.fontSize,
        fontFamily: line.fontFamily,
        bold: line.bold,
        italic: line.italic,
        spans: line.spans,
        alignment,
        listStyle: line.listStyle,
        listGroupId: activeListGroupId,
        headingLevel: line.headingLevel,
      }
      blocks.push(block)
      currentBlock = block
      currentLines = [line]
    }

    previousLineY = line.y
    previousLineHeight = line.maxHeight
  }

  finalizeCurrentBlock()
  return blocks
}

export function applyLayoutRegions(
  blocks: PdfWordBlock[],
  regions: LayoutRegion[],
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (blocks.length === 0 || regions.length === 0) return

  const ys = blocks.map((block) => block.y ?? 0)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const rangeY = Math.max(1, maxY - minY)

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    const normalizedTop = (maxY - (block.y ?? maxY)) / rangeY
    const region = regions
      .filter((item) => item.width > 8 && item.height > 8)
      .find((item) => {
        const regionTop = item.y / canvasHeight
        const regionBottom = (item.y + item.height) / canvasHeight
        const blockLeft = (block.x ?? 0) / canvasWidth
        const regionLeft = item.x / canvasWidth
        const regionRight = (item.x + item.width) / canvasWidth
        return (
          normalizedTop >= regionTop - 0.03 &&
          normalizedTop <= regionBottom + 0.03 &&
          (block.x === undefined ||
            (blockLeft >= regionLeft - 0.05 &&
              blockLeft <= regionRight + 0.05))
        )
      })

    if (!region) continue
    if (
      region.label === 'Page-header' ||
      region.label === 'Page-footer' ||
      region.label === 'Abandon'
    ) {
      blocks.splice(index, 1)
      continue
    }
    if (region.label === 'Title' || region.label === 'Section-header') {
      block.kind = 'heading'
      block.fontSize = Math.max(block.fontSize || 12, 14)
      block.bold = true
    } else if (region.label === 'List-item') {
      block.kind = 'list'
    } else if (region.label === 'Caption') {
      block.kind = 'caption'
    } else if (region.label === 'Footnote') {
      block.kind = 'footnote'
    } else if (region.label === 'Formula') {
      block.kind = 'paragraph'
    }
  }
}

function cloneBlock(block: PdfWordBlock, index: number): DocumentBlockIR {
  return {
    ...block,
    id: `block-${block.page}-${index + 1}`,
    spans: block.spans?.map((span) => ({ ...span })),
  }
}

export function analyzeDocumentStructure(
  blocks: PdfWordBlock[],
  regionsByPage: ReadonlyMap<number, LayoutRegion[]> = new Map(),
): DocumentBlockIR[] {
  const analyzed = blocks.map(cloneBlock)
  const pageGroups = new Map<number, DocumentBlockIR[]>()

  for (const block of analyzed) {
    const pageBlocks = pageGroups.get(block.page) ?? []
    pageBlocks.push(block)
    pageGroups.set(block.page, pageBlocks)
  }

  for (const [page, pageBlocks] of pageGroups) {
    const regions = regionsByPage.get(page) ?? []
    if (regions.length === 0) continue
    const alreadyStructured = pageBlocks.some(
      (block) =>
        block.kind === 'table' ||
        block.kind === 'image' ||
        block.kind === 'caption' ||
        block.kind === 'footnote',
    )
    if (alreadyStructured) continue

    const canvasWidth = Math.max(...regions.map((region) => region.x + region.width), 1)
    const canvasHeight = Math.max(...regions.map((region) => region.y + region.height), 1)
    const originalBlocks = pageBlocks.map(({ id: _id, ...block }) => block)
    applyLayoutRegions(originalBlocks, regions, canvasWidth, canvasHeight)
    for (const [index, block] of originalBlocks.entries()) {
      Object.assign(pageBlocks[index], block)
    }
  }

  return analyzed
}

/**
 * Gabungkan paragraf yang terpotong di batas halaman (seperti perilaku iLovePDF),
 * sehingga aliran kalimat di Word tetap utuh dan tidak terpotong paksa oleh pergantian halaman.
 */
function mergeCrossPageParagraphs(
  pages: DocumentPageIR[],
): DocumentPageIR[] {
  if (pages.length <= 1) return pages

  for (let i = 0; i < pages.length - 1; i += 1) {
    const current = pages[i]
    const next = pages[i + 1]
    if (current.blocks.length === 0 || next.blocks.length === 0) continue

    const lastBlock = current.blocks[current.blocks.length - 1]
    const firstNext = next.blocks[0]

    const startsNewMajorSection =
      firstNext.kind === 'heading' &&
      (firstNext.headingLevel === 1 || /^(?:BAB|CHAPTER)\b/i.test(firstNext.text))

    if (current.endsEarly || startsNewMajorSection) {
      firstNext.pageBreakBefore = true
      continue
    }

    const canMergeCrossPage =
      current.width !== undefined &&
      (lastBlock.kind === 'paragraph' || lastBlock.kind === 'list') &&
      firstNext.kind === 'paragraph' &&
      (firstNext.firstLineIndentPt ?? 0) === 0 &&
      !/[.!?]$/.test(lastBlock.text)

    if (canMergeCrossPage) {
      const joinWithSpace = !lastBlock.text.endsWith('-')
      lastBlock.text = joinWithSpace
        ? `${lastBlock.text} ${firstNext.text}`
        : `${lastBlock.text}${firstNext.text}`
      lastBlock.spans = [
        ...(lastBlock.spans ?? []),
        ...(joinWithSpace ? [{ text: ' ' }] : []),
        ...(firstNext.spans ?? [{ text: firstNext.text }]),
      ]
      if (firstNext.italic) lastBlock.italic = true
      next.blocks.shift()
    }
  }

  return pages
}

export function buildDocumentIR(
  blocks: PdfWordBlock[],
  title: string,
  regionsByPage: ReadonlyMap<number, LayoutRegion[]> = new Map(),
  pageMetaByPage: ReadonlyMap<
    number,
    {
      width: number
      height: number
      margins: PageMarginsPt
      pageNumberPlacement?: PageNumberPlacement
      endsEarly?: boolean
    }
  > = new Map(),
): DocumentIR {
  const analyzed = analyzeDocumentStructure(blocks, regionsByPage)
  const pageNumbers = [...new Set(analyzed.map((block) => block.page))].sort(
    (a, b) => a - b,
  )
  const pages: DocumentPageIR[] = pageNumbers.map((number) => {
    const meta = pageMetaByPage.get(number)
    return {
      number,
      width: meta?.width,
      height: meta?.height,
      margins: meta?.margins,
      pageNumberPlacement: meta?.pageNumberPlacement,
      endsEarly: meta?.endsEarly,
      blocks: analyzed.filter((block) => block.page === number),
      layoutRegions: regionsByPage.get(number) ?? [],
    }
  })

  const mergedPages = mergeCrossPageParagraphs(pages)
  const mergedBlocks = mergedPages.flatMap((page) => page.blocks)

  // Hitung font family & font size dominan untuk dokumen
  const fontCounts = new Map<string, number>()
  const sizeCounts = new Map<number, number>()
  for (const block of mergedBlocks) {
    if (block.kind === 'paragraph' || block.kind === 'list') {
      if (block.fontFamily) {
        fontCounts.set(block.fontFamily, (fontCounts.get(block.fontFamily) ?? 0) + block.text.length)
      }
      if (block.fontSize) {
        const rounded = Math.round(block.fontSize)
        sizeCounts.set(rounded, (sizeCounts.get(rounded) ?? 0) + block.text.length)
      }
    }
  }

  let defaultFontFamily: string | undefined
  let bestFontScore = 0
  for (const [font, score] of fontCounts) {
    if (score > bestFontScore) {
      bestFontScore = score
      defaultFontFamily = font
    }
  }

  let defaultFontSizePt: number | undefined
  let bestSizeScore = 0
  for (const [size, score] of sizeCounts) {
    if (score > bestSizeScore) {
      bestSizeScore = score
      defaultFontSizePt = size
    }
  }

  return {
    title,
    defaultFontFamily,
    defaultFontSizePt,
    pages: mergedPages,
    blocks: mergedBlocks,
  }
}

interface PageBoxPt {
  x: number
  top: number
  width: number
  height: number
  label: LayoutRegion['label']
  score: number
  canvasRegion: LayoutRegion
}

function toPageBoxPt(
  region: LayoutRegion,
  canvasWidth: number,
  canvasHeight: number,
  pageWidth: number,
  pageHeight: number,
): PageBoxPt {
  return {
    x: (region.x / canvasWidth) * pageWidth,
    top: (region.y / canvasHeight) * pageHeight,
    width: (region.width / canvasWidth) * pageWidth,
    height: (region.height / canvasHeight) * pageHeight,
    label: region.label,
    score: region.score,
    canvasRegion: region,
  }
}

function itemCenterInPt(
  item: PdfTextItem,
  pageHeight: number,
): { cx: number; cy: number; left: number; top: number; width: number; height: number } {
  const height = itemFontSize(item)
  const width = itemWidth(item, cleanText(item.str))
  const left = item.transform[4] ?? 0
  const baselineY = item.transform[5] ?? 0
  const top = pageHeight - baselineY - height * 0.85
  return {
    cx: left + width / 2,
    cy: top + height / 2,
    left,
    top,
    width,
    height,
  }
}

function pointInBox(cx: number, cy: number, box: PageBoxPt, pad = 4): boolean {
  return (
    cx >= box.x - pad &&
    cx <= box.x + box.width + pad &&
    cy >= box.top - pad &&
    cy <= box.top + box.height + pad
  )
}

function sortBoxesReadingOrder(boxes: PageBoxPt[], pageWidth: number): PageBoxPt[] {
  if (boxes.length <= 1) return boxes
  const midX = pageWidth / 2
  const sortedByY = [...boxes].sort((a, b) => a.top - b.top || a.x - b.x)

  const ordered: PageBoxPt[] = []
  let index = 0
  while (index < sortedByY.length) {
    const current = sortedByY[index]
    const isNarrowLeft = current.x + current.width <= midX + 20
    const isNarrowRight = current.x >= midX - 20

    if (!isNarrowLeft && !isNarrowRight) {
      ordered.push(current)
      index += 1
      continue
    }

    const band: PageBoxPt[] = []
    while (index < sortedByY.length) {
      const candidate = sortedByY[index]
      const fullWidth =
        candidate.x < midX - 25 && candidate.x + candidate.width > midX + 25
      if (fullWidth) break
      band.push(candidate)
      index += 1
    }

    const leftCol = band
      .filter((box) => box.x + box.width / 2 < midX)
      .sort((a, b) => a.top - b.top)
    const rightCol = band
      .filter((box) => box.x + box.width / 2 >= midX)
      .sort((a, b) => a.top - b.top)

    const hasVerticalOverlap =
      leftCol.length > 0 &&
      rightCol.length > 0 &&
      leftCol.some((l) =>
        rightCol.some((r) => {
          const overlapY =
            Math.min(l.top + l.height, r.top + r.height) - Math.max(l.top, r.top)
          const minH = Math.max(1, Math.min(l.height, r.height))
          return overlapY > minH * 0.25
        }),
      )

    if (hasVerticalOverlap) {
      ordered.push(...leftCol, ...rightCol)
    } else {
      ordered.push(...band.sort((a, b) => a.top - b.top || a.x - b.x))
    }
  }
  return ordered
}

function buildTableFromItems(
  items: PdfTextItem[],
  box: PageBoxPt,
  pageNumber: number,
): PdfWordBlock | null {
  const usable = items.filter((item) => cleanText(item.str))
  if (usable.length === 0) return null

  const sorted = [...usable].sort((a, b) => {
    const ay = a.transform[5] ?? 0
    const by = b.transform[5] ?? 0
    if (Math.abs(ay - by) > 3) return by - ay
    return (a.transform[4] ?? 0) - (b.transform[4] ?? 0)
  })

  const rowGroups: PdfTextItem[][] = []
  for (const item of sorted) {
    const y = item.transform[5] ?? 0
    const h = Math.max(itemFontSize(item), 8)
    const current = rowGroups[rowGroups.length - 1]
    if (!current) {
      rowGroups.push([item])
      continue
    }
    const rowY = current[0].transform[5] ?? 0
    if (Math.abs(rowY - y) <= h * 0.65) {
      current.push(item)
    } else {
      rowGroups.push([item])
    }
  }

  const xStarts = sorted.map((item) => item.transform[4] ?? 0).sort((a, b) => a - b)
  const colAnchors: number[] = []
  for (const x of xStarts) {
    const existing = colAnchors.find((anchor) => Math.abs(anchor - x) <= 18)
    if (existing === undefined) colAnchors.push(x)
  }
  colAnchors.sort((a, b) => a - b)
  const colCount = Math.max(1, colAnchors.length)

  // Jika hanya terdeteksi 1 kolom, kemungkinan besar false-positive layout pada paragraf biasa.
  if (colCount < 2 && rowGroups.length < 2) return null

  const rows: PdfTableCell[][] = rowGroups.map((rowItems) => {
    const cells: PdfTextItem[][] = Array.from({ length: colCount }, () => [])
    for (const item of rowItems) {
      const x = item.transform[4] ?? 0
      let bestCol = 0
      let bestDist = Number.POSITIVE_INFINITY
      for (let c = 0; c < colAnchors.length; c += 1) {
        const dist = Math.abs(x - colAnchors[c])
        if (dist < bestDist) {
          bestDist = dist
          bestCol = c
        }
      }
      cells[bestCol].push(item)
    }

    return cells.map((cellItems) => {
      cellItems.sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0))
      const spans: PdfWordSpan[] = []
      let text = ''
      for (const item of cellItems) {
        const val = cleanText(item.str)
        if (!val) continue
        if (text) {
          text += ' '
          spans.push({ text: ' ' })
        }
        text += val
        spans.push({
          text: val,
          bold: isBoldFont(item.fontName, item.fontFamily),
          italic: isItalicFont(item.fontName, item.fontFamily),
          fontSize: Math.round(itemFontSize(item) * 10) / 10,
          fontFamily: resolveDocxFontFamily(item.fontFamily),
        })
      }
      return {
        text: cleanText(text),
        spans: spans.length > 0 ? spans : undefined,
        bold: spans.length > 0 && spans.every((s) => !s.text.trim() || s.bold),
      }
    })
  })

  const colWidthsPt: number[] = []
  for (let c = 0; c < colCount; c += 1) {
    const start = c === 0 ? box.x : colAnchors[c]
    const end = c + 1 < colCount ? colAnchors[c + 1] : box.x + box.width
    colWidthsPt.push(Math.max(40, Math.round(end - start)))
  }

  return {
    text: rows.map((row) => row.map((cell) => cell.text).join(' | ')).join('\n'),
    kind: 'table',
    page: pageNumber,
    x: box.x,
    y: box.top,
    width: box.width,
    height: box.height,
    rows,
    colWidthsPt,
  }
}

async function cropCanvasRegionToPng(
  canvas: HTMLCanvasElement,
  region: { x: number; y: number; width: number; height: number },
): Promise<Uint8Array | null> {
  const sx = Math.max(0, Math.floor(region.x))
  const sy = Math.max(0, Math.floor(region.y))
  const sw = Math.min(canvas.width - sx, Math.ceil(region.width))
  const sh = Math.min(canvas.height - sy, Math.ceil(region.height))
  if (sw < 8 || sh < 8) return null

  const crop = document.createElement('canvas')
  crop.width = sw
  crop.height = sh
  const ctx = crop.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, sw, sh)
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)

  const blob = await new Promise<Blob | null>((resolve) =>
    crop.toBlob((b) => resolve(b), 'image/png'),
  )
  if (!blob) return null
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * Pisahkan nomor halaman di area margin atas/bawah serta artifact watermark,
 * lalu kembalikan item konten utama + lokasi nomor halaman.
 */
function separateRunningPageNumbers(
  items: PdfTextItem[],
  pageWidth: number,
  pageHeight: number,
): {
  bodyItems: PdfTextItem[]
  pageNumberPlacement?: PageNumberPlacement
} {
  const bodyItems: PdfTextItem[] = []
  let pageNumberPlacement: PageNumberPlacement | undefined

  for (const item of items) {
    const text = cleanText(item.str)
    if (!text || isPdfArtifact(text) || itemFontSize(item) < 3) continue
    const pos = itemCenterInPt(item, pageHeight)
    const isTopMargin = pos.top < 58
    const isBottomMargin = pos.top + pos.height > pageHeight - 58

    if ((isTopMargin || isBottomMargin) && /^\d{1,4}$/.test(text)) {
      const ratioX = pos.cx / Math.max(1, pageWidth)
      const alignment: PageNumberPlacement['alignment'] =
        ratioX < 0.33 ? 'left' : ratioX > 0.67 ? 'right' : 'center'
      pageNumberPlacement = {
        position: isTopMargin ? 'header' : 'footer',
        alignment,
      }
      continue
    }

    bodyItems.push(item)
  }

  return { bodyItems, pageNumberPlacement }
}

function estimatePageMargins(
  items: PdfTextItem[],
  pageWidth: number,
  pageHeight: number,
): { margins: PageMarginsPt; endsEarly: boolean } {
  if (items.length === 0) return { margins: { ...DEFAULT_MARGINS_PT }, endsEarly: false }
  const lefts: number[] = []
  const rights: number[] = []
  const tops: number[] = []
  const bottoms: number[] = []

  for (const item of items) {
    const text = cleanText(item.str)
    if (!text) continue
    const pos = itemCenterInPt(item, pageHeight)
    lefts.push(pos.left)
    rights.push(pos.left + pos.width)
    tops.push(pos.top)
    bottoms.push(pos.top + pos.height)
  }
  if (lefts.length === 0) return { margins: { ...DEFAULT_MARGINS_PT }, endsEarly: false }

  lefts.sort((a, b) => a - b)
  rights.sort((a, b) => a - b)
  tops.sort((a, b) => a - b)
  bottoms.sort((a, b) => a - b)

  const clampMargin = (val: number, fallback: number) =>
    Number.isFinite(val) ? Math.max(24, Math.min(180, Math.round(val))) : fallback

  const maxBottom = bottoms[bottoms.length - 1]
  const top = clampMargin(tops[0], DEFAULT_MARGINS_PT.top)
  const rawBottom = clampMargin(pageHeight - maxBottom, DEFAULT_MARGINS_PT.bottom)
  const endsEarly = maxBottom < pageHeight * 0.72
  // Gunakan margin bawah yang ringkas agar Word tidak meluap ke halaman tambahan akibat perbedaan metrik font.
  const bottom = Math.max(24, Math.min(rawBottom, 45))
  const rawRight = clampMargin(pageWidth - rights[rights.length - 1], DEFAULT_MARGINS_PT.right)

  return {
    margins: {
      left: clampMargin(lefts[0], DEFAULT_MARGINS_PT.left),
      right: Math.max(24, rawRight - 6),
      top,
      bottom,
    },
    endsEarly,
  }
}

export function processPdfPageTextItems(
  rawItems: PdfTextItem[],
  pageNumber: number,
  pageWidth = DEFAULT_PAGE_WIDTH_PT,
  pageHeight = DEFAULT_PAGE_HEIGHT_PT,
): {
  blocks: PdfWordBlock[]
  meta: {
    width: number
    height: number
    margins: PageMarginsPt
    pageNumberPlacement?: PageNumberPlacement
    endsEarly?: boolean
  }
} {
  const { bodyItems: items, pageNumberPlacement } = separateRunningPageNumbers(
    rawItems,
    pageWidth,
    pageHeight,
  )
  const { margins, endsEarly } = estimatePageMargins(items, pageWidth, pageHeight)
  const contentBounds = {
    left: margins.left,
    right: pageWidth - margins.right,
  }
  return {
    blocks: groupPdfTextItems(items, pageNumber, contentBounds),
    meta: {
      width: pageWidth,
      height: pageHeight,
      margins,
      pageNumberPlacement,
      endsEarly,
    },
  }
}

export async function extractPdfDocumentIR(
  bytes: Uint8Array,
  onProgress?: (current: number, total: number, label?: string) => void,
  useLayoutModel = true,
  title = 'Dokumen PDF',
): Promise<DocumentIR> {
  const document = await openPdfDocument(bytes)
  const blocks: PdfWordBlock[] = []
  const regionsByPage = new Map<number, LayoutRegion[]>()
  const pageMetaByPage = new Map<
    number,
    {
      width: number
      height: number
      margins: PageMarginsPt
      pageNumberPlacement?: PageNumberPlacement
      endsEarly?: boolean
    }
  >()

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      onProgress?.(pageNumber, document.numPages, 'Mengekstrak teks & tata letak')
      const page = await document.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const pageWidth = viewport.width || DEFAULT_PAGE_WIDTH_PT
      const pageHeight = viewport.height || DEFAULT_PAGE_HEIGHT_PT

      const content = await page.getTextContent()
      const styles = (content.styles ?? {}) as Record<
        string,
        { fontFamily?: string } | undefined
      >
      const rawItems: PdfTextItem[] = content.items.flatMap((item) => {
        if (!('str' in item) || typeof item.str !== 'string') return []
        const textItem = item as unknown as {
          str: string
          transform: number[]
          height: number
          width: number
          fontName?: string
        }
        const fontName = textItem.fontName ? String(textItem.fontName) : undefined
        return [
          {
            str: textItem.str,
            transform: textItem.transform.map((value) => Number(value)),
            height: textItem.height,
            width: textItem.width,
            fontName,
            fontFamily: fontName ? styles[fontName]?.fontFamily : undefined,
          },
        ]
      })

      const { bodyItems: items, pageNumberPlacement } = separateRunningPageNumbers(
        rawItems,
        pageWidth,
        pageHeight,
      )
      const { margins, endsEarly } = estimatePageMargins(items, pageWidth, pageHeight)
      pageMetaByPage.set(pageNumber, {
        width: pageWidth,
        height: pageHeight,
        margins,
        pageNumberPlacement,
        endsEarly,
      })

      const contentBounds = {
        left: margins.left,
        right: pageWidth - margins.right,
      }
      const textLength = items.reduce(
        (sum, item) => sum + cleanText(item.str).length,
        0,
      )

      let canvas: HTMLCanvasElement | null = null
      let regions: LayoutRegion[] = []

      if (useLayoutModel || textLength < 20) {
        try {
          canvas = await renderPdfPage(page, { maxWidth: 2000, maxHeight: 2800 })
        } catch {
          canvas = null
        }
      }

      if (useLayoutModel && canvas) {
        onProgress?.(pageNumber, document.numPages, 'AI layout menganalisis halaman')
        try {
          regions = await detectDocumentLayout(canvas, (progress: LayoutProgress) => {
            const percent = progress.percent
            onProgress?.(
              pageNumber,
              document.numPages,
              percent === null
                ? 'Memuat model layout'
                : `Model layout ${percent}%`,
            )
          })
          regionsByPage.set(pageNumber, regions)
        } catch {
          // Layout model boleh gagal — ekstraksi geometris tetap dipakai.
        }
      }

      if (textLength < 20 && canvas) {
        const png = await cropCanvasRegionToPng(canvas, {
          x: 0,
          y: 0,
          width: canvas.width,
          height: canvas.height,
        })
        if (png) {
          const usableWidth = Math.max(120, pageWidth - margins.left - margins.right)
          const ratio = canvas.height / Math.max(1, canvas.width)
          blocks.push({
            text: `[Halaman ${pageNumber}]`,
            kind: 'image',
            page: pageNumber,
            x: margins.left,
            y: margins.top,
            width: usableWidth,
            height: Math.round(usableWidth * ratio),
            alignment: 'center',
            image: {
              data: png,
              width: usableWidth,
              height: Math.round(usableWidth * ratio),
            },
          })
        }
        continue
      }

      if (regions.length > 0 && canvas) {
        const boxes = sortBoxesReadingOrder(
          regions.map((region) =>
            toPageBoxPt(region, canvas!.width, canvas!.height, pageWidth, pageHeight),
          ),
          pageWidth,
        )

        const consumed = new Set<PdfTextItem>()
        const pendingTextRuns: Array<{ items: PdfTextItem[]; box: PageBoxPt }> = []

        const flushTextRun = () => {
          if (pendingTextRuns.length === 0) return
          const combinedItems = pendingTextRuns.flatMap((entry) => entry.items)
          const minX = Math.min(...pendingTextRuns.map((entry) => entry.box.x))
          const maxR = Math.max(...pendingTextRuns.map((entry) => entry.box.x + entry.box.width))
          const runBounds = {
            left: Math.min(contentBounds.left, minX),
            right: Math.max(contentBounds.right, maxR),
          }
          const grouped = groupPdfTextItems(combinedItems, pageNumber, runBounds)
          for (const block of grouped) {
            const centerTop = pageHeight - (block.y ?? pageHeight) - (block.fontSize ?? 12) * 0.4
            const matchedBox = pendingTextRuns
              .map((entry) => entry.box)
              .find((box) =>
                pointInBox(
                  (block.x ?? box.x) + 4,
                  centerTop,
                  box,
                  6,
                ),
              )
            if (matchedBox) {
              if (matchedBox.label === 'Title' || matchedBox.label === 'Section-header') {
                block.kind = 'heading'
                block.bold = true
                block.fontSize = Math.max(block.fontSize || 12, 12)
              } else if (matchedBox.label === 'Caption') {
                block.kind = 'caption'
              } else if (matchedBox.label === 'Footnote') {
                block.kind = 'footnote'
              } else if (matchedBox.label === 'List-item') {
                block.kind = 'list'
              }
            }
            blocks.push(block)
          }
          pendingTextRuns.length = 0
        }

        for (const box of boxes) {
          const inside = items.filter((item) => {
            if (consumed.has(item)) return false
            const center = itemCenterInPt(item, pageHeight)
            return pointInBox(center.cx, center.cy, box)
          })

          if (
            box.label === 'Abandon' ||
            box.label === 'Page-header' ||
            box.label === 'Page-footer'
          ) {
            for (const item of inside) consumed.add(item)
            continue
          }

          if (box.label === 'Picture' || box.label === 'Formula') {
            // Lindungi teks utama jika Picture hanyalah watermark latar belakang di belakang teks!
            const insideTextLen = inside.reduce(
              (sum, item) => sum + cleanText(item.str).length,
              0,
            )
            const coversWideArea = box.width * box.height > pageWidth * pageHeight * 0.25
            if (box.label === 'Picture' && (insideTextLen > 60 || (coversWideArea && insideTextLen > 20))) {
              continue
            }

            flushTextRun()
            for (const item of inside) consumed.add(item)
            const png = await cropCanvasRegionToPng(canvas, box.canvasRegion)
            if (png) {
              blocks.push({
                text: `[${box.label}]`,
                kind: 'image',
                page: pageNumber,
                x: box.x,
                y: box.top,
                width: Math.round(box.width),
                height: Math.round(box.height),
                alignment: 'center',
                image: {
                  data: png,
                  width: Math.max(24, Math.round(box.width)),
                  height: Math.max(16, Math.round(box.height)),
                },
              })
            }
            continue
          }

          if (box.label === 'Table') {
            const tableBlock = buildTableFromItems(inside, box, pageNumber)
            if (tableBlock) {
              flushTextRun()
              for (const item of inside) consumed.add(item)
              blocks.push(tableBlock)
              continue
            }
            if (inside.length === 0) {
              flushTextRun()
              const png = await cropCanvasRegionToPng(canvas, box.canvasRegion)
              if (png) {
                blocks.push({
                  text: '[Table]',
                  kind: 'image',
                  page: pageNumber,
                  x: box.x,
                  y: box.top,
                  width: Math.round(box.width),
                  height: Math.round(box.height),
                  alignment: 'center',
                  image: {
                    data: png,
                    width: Math.max(40, Math.round(box.width)),
                    height: Math.max(24, Math.round(box.height)),
                  },
                })
              }
            }
            continue
          }

          if (inside.length === 0) continue
          for (const item of inside) consumed.add(item)
          pendingTextRuns.push({ items: inside, box })
        }

        flushTextRun()

        const remaining = items.filter((item) => !consumed.has(item))
        if (remaining.length > 0) {
          blocks.push(...groupPdfTextItems(remaining, pageNumber, contentBounds))
        }
      } else {
        blocks.push(...groupPdfTextItems(items, pageNumber, contentBounds))
      }
    }
  } finally {
    await destroyPdfDocument(document)
  }

  return buildDocumentIR(blocks, title, regionsByPage, pageMetaByPage)
}

export async function extractPdfForWord(
  bytes: Uint8Array,
  onProgress?: (current: number, total: number, label?: string) => void,
  useLayoutModel = true,
): Promise<PdfWordBlock[]> {
  const ir = await extractPdfDocumentIR(bytes, onProgress, useLayoutModel)
  return ir.blocks
}

export function createDocumentIR(
  blocks: PdfWordBlock[],
  title: string,
): DocumentIR {
  return buildDocumentIR(blocks, title)
}

function toDocxAlignment(
  alignment?: PdfWordBlock['alignment'],
): (typeof AlignmentType)[keyof typeof AlignmentType] {
  switch (alignment) {
    case 'center':
      return AlignmentType.CENTER
    case 'right':
      return AlignmentType.RIGHT
    case 'justified':
      return AlignmentType.BOTH
    default:
      return AlignmentType.LEFT
  }
}

function ptToTwips(pt: number): number {
  return Math.round(pt * 20)
}

function ptToPx(pt: number): number {
  return Math.round((pt * 96) / 72)
}

function createRunsFromBlock(
  block: PdfWordBlock,
  defaultSizeHalfPt?: number,
  defaultFontFamily?: string,
): TextRun[] {
  if (block.spans && block.spans.length > 0) {
    return block.spans.map((span) => {
      if (span.text === '\n') {
        return new TextRun({ break: 1 })
      }
      return new TextRun({
        text: span.text,
        bold: span.bold,
        italics: span.italic,
        font: span.fontFamily ?? block.fontFamily ?? defaultFontFamily,
        size: span.fontSize ? Math.round(span.fontSize * 2) : defaultSizeHalfPt,
      })
    })
  }
  return [
    new TextRun({
      text: block.text,
      bold: block.bold,
      italics: block.italic,
      font: block.fontFamily ?? defaultFontFamily,
      size: block.fontSize ? Math.round(block.fontSize * 2) : defaultSizeHalfPt,
    }),
  ]
}

function createDocxTable(
  block: PdfWordBlock,
  defaultFontFamily?: string,
): Table {
  const rows = block.rows ?? []
  const colWidths = block.colWidthsPt ?? []
  const border = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: 'CBD5E1',
  }

  return new Table({
    width: {
      size: colWidths.reduce((sum, w) => sum + ptToTwips(w), 0) || 9000,
      type: WidthType.DXA,
    },
    rows: rows.map(
      (row) =>
        new TableRow({
          children: row.map((cell, colIndex) => {
            const cellWidth = colWidths[colIndex]
              ? ptToTwips(colWidths[colIndex])
              : 1800
            const runs =
              cell.spans && cell.spans.length > 0
                ? cell.spans.map(
                    (span) =>
                      new TextRun({
                        text: span.text,
                        bold: span.bold,
                        italics: span.italic,
                        font: span.fontFamily ?? defaultFontFamily,
                        size: span.fontSize ? Math.round(span.fontSize * 2) : 20,
                      }),
                  )
                : [
                    new TextRun({
                      text: cell.text,
                      bold: cell.bold,
                      font: defaultFontFamily,
                      size: 20,
                    }),
                  ]
            return new TableCell({
              width: { size: cellWidth, type: WidthType.DXA },
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              borders: {
                top: border,
                bottom: border,
                left: border,
                right: border,
              },
              children: [
                new Paragraph({
                  children: runs,
                  alignment: toDocxAlignment(cell.alignment),
                  spacing: { after: 40 },
                }),
              ],
            })
          }),
        }),
    ),
  })
}

function collectNumberingConfigs(
  blocks: DocumentBlockIR[],
  defaultFontFamily?: string,
  defaultFontSizePt?: number,
): INumberingOptions['config'] {
  const seen = new Set<string>()
  const configs: Array<INumberingOptions['config'][number]> = []
  const sizeHalfPt = defaultFontSizePt ? Math.round(defaultFontSizePt * 2) : 24

  for (const block of blocks) {
    if (block.kind !== 'list' || block.listStyle !== 'decimal') continue
    const ref = block.listGroupId || 'decimal-default'
    if (seen.has(ref)) continue
    seen.add(ref)
    configs.push({
      reference: ref,
      levels: [
        {
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.LEFT,
          style: {
            run: {
              font: block.fontFamily ?? defaultFontFamily,
              size: block.fontSize ? Math.round(block.fontSize * 2) : sizeHalfPt,
              bold: false,
            },
            paragraph: {
              indent: {
                left: ptToTwips(block.leftIndentPt ?? 14),
                hanging: ptToTwips(block.hangingIndentPt ?? 14),
              },
            },
          },
        },
      ],
    })
  }
  return configs
}

function createWordChildrenForBlocks(
  blocks: DocumentBlockIR[],
  defaultFontFamily?: string,
  defaultFontSizePt?: number,
): FileChild[] {
  const children: FileChild[] = []
  const defaultHalfPt = defaultFontSizePt ? Math.round(defaultFontSizePt * 2) : undefined

  for (const block of blocks) {
    if (block.kind === 'image' && block.image) {
      children.push(
        new Paragraph({
          alignment: toDocxAlignment(block.alignment ?? 'center'),
          pageBreakBefore: block.pageBreakBefore,
          spacing: { before: 120, after: 120 },
          children: [
            new ImageRun({
              data: block.image.data,
              type: 'png',
              transformation: {
                width: ptToPx(block.image.width),
                height: ptToPx(block.image.height),
              },
            }),
          ],
        }),
      )
      continue
    }

    if (block.kind === 'table' && block.rows && block.rows.length > 0) {
      children.push(createDocxTable(block, defaultFontFamily))
      children.push(new Paragraph({ text: '', spacing: { after: 100 } }))
      continue
    }

    if (block.kind === 'heading') {
      const level =
        block.headingLevel === 1
          ? HeadingLevel.HEADING_1
          : HeadingLevel.HEADING_2
      children.push(
        new Paragraph({
          children: createRunsFromBlock(
            { ...block, bold: true },
            Math.round((block.fontSize || defaultFontSizePt || 12) * 2),
            defaultFontFamily,
          ),
          heading: level,
          pageBreakBefore: block.pageBreakBefore,
          alignment: toDocxAlignment(
            block.alignment ??
              (block.headingLevel === 1 || /^(?:BAB|CHAPTER)\b/i.test(block.text)
                ? 'center'
                : 'left'),
          ),
          spacing: {
            before: block.spaceBeforePt ? ptToTwips(block.spaceBeforePt) : 0,
            after: block.spaceAfterPt ? ptToTwips(block.spaceAfterPt) : 0,
            line: block.lineSpacing ?? 360,
          },
        }),
      )
      continue
    }

    if (block.kind === 'list') {
      const isDecimal = block.listStyle === 'decimal'
      children.push(
        new Paragraph({
          children: createRunsFromBlock(block, defaultHalfPt, defaultFontFamily),
          ...(isDecimal
            ? {
                numbering: {
                  reference: block.listGroupId || 'decimal-default',
                  level: 0,
                },
              }
            : { bullet: { level: 0 } }),
          pageBreakBefore: block.pageBreakBefore,
          alignment: toDocxAlignment(block.alignment ?? 'justified'),
          spacing: {
            before: block.spaceBeforePt ? ptToTwips(block.spaceBeforePt) : 0,
            after: 0,
            line: block.lineSpacing ?? 360,
          },
        }),
      )
      continue
    }

    if (block.kind === 'caption') {
      children.push(
        new Paragraph({
          children: createRunsFromBlock(block, 20, defaultFontFamily),
          pageBreakBefore: block.pageBreakBefore,
          alignment: toDocxAlignment(block.alignment ?? 'center'),
          spacing: { before: 60, after: 120 },
        }),
      )
      continue
    }

    if (block.kind === 'footnote') {
      children.push(
        new Paragraph({
          children: createRunsFromBlock(block, 18, defaultFontFamily),
          pageBreakBefore: block.pageBreakBefore,
          alignment: toDocxAlignment(block.alignment ?? 'left'),
          spacing: { before: 40, after: 60 },
        }),
      )
      continue
    }

    const leftTwips =
      block.leftIndentPt !== undefined
        ? ptToTwips(block.leftIndentPt)
        : block.indent
          ? Math.max(0, block.indent) * 20
          : 0
    const firstLineTwips =
      block.firstLineIndentPt !== undefined
        ? ptToTwips(block.firstLineIndentPt)
        : block.indent
          ? 700
          : 0

    children.push(
      new Paragraph({
        children: createRunsFromBlock(block, defaultHalfPt, defaultFontFamily),
        pageBreakBefore: block.pageBreakBefore,
        indent:
          leftTwips > 0 || firstLineTwips > 0
            ? {
                left: leftTwips > 0 ? leftTwips : undefined,
                firstLine: firstLineTwips > 0 ? firstLineTwips : undefined,
              }
            : undefined,
        alignment: toDocxAlignment(block.alignment ?? 'justified'),
        spacing: {
          before: block.spaceBeforePt ? ptToTwips(block.spaceBeforePt) : 0,
          after: block.spaceAfterPt ? ptToTwips(block.spaceAfterPt) : 0,
          line: block.lineSpacing ?? 360,
        },
      }),
    )
  }

  return children
}

function buildSectionHeadersFooters(
  pages: DocumentPageIR[],
  defaultFontFamily?: string,
): {
  titlePage: boolean
  headers?: ISectionOptions['headers']
  footers?: ISectionOptions['footers']
} {
  const firstPageNum = pages[0]?.pageNumberPlacement
  const restPageNum = pages.slice(1).find((p) => p.pageNumberPlacement)?.pageNumberPlacement
  const hasDifferentFirst = Boolean(
    firstPageNum &&
      restPageNum &&
      (firstPageNum.position !== restPageNum.position ||
        firstPageNum.alignment !== restPageNum.alignment),
  )

  const makePageNumParagraph = (alignment: PageNumberPlacement['alignment']) =>
    new Paragraph({
      alignment: toDocxAlignment(alignment),
      children: [
        new TextRun({
          children: [PageNumber.CURRENT],
          font: defaultFontFamily,
          size: 24,
        }),
      ],
    })

  let firstHeader: Header | undefined
  let defaultHeader: Header | undefined
  let firstFooter: Footer | undefined
  let defaultFooter: Footer | undefined

  if (hasDifferentFirst && firstPageNum && restPageNum) {
    if (firstPageNum.position === 'header') {
      firstHeader = new Header({ children: [makePageNumParagraph(firstPageNum.alignment)] })
    } else {
      firstFooter = new Footer({ children: [makePageNumParagraph(firstPageNum.alignment)] })
    }
    if (restPageNum.position === 'header') {
      defaultHeader = new Header({ children: [makePageNumParagraph(restPageNum.alignment)] })
    } else {
      defaultFooter = new Footer({ children: [makePageNumParagraph(restPageNum.alignment)] })
    }
  } else {
    const placement = restPageNum ?? firstPageNum
    if (placement?.position === 'header') {
      defaultHeader = new Header({ children: [makePageNumParagraph(placement.alignment)] })
    } else if (placement?.position === 'footer') {
      defaultFooter = new Footer({ children: [makePageNumParagraph(placement.alignment)] })
    }
  }

  const headers: ISectionOptions['headers'] | undefined =
    firstHeader || defaultHeader
      ? {
          ...(firstHeader ? { first: firstHeader } : {}),
          ...(defaultHeader ? { default: defaultHeader } : {}),
        }
      : undefined
  const footers: ISectionOptions['footers'] | undefined =
    firstFooter || defaultFooter
      ? {
          ...(firstFooter ? { first: firstFooter } : {}),
          ...(defaultFooter ? { default: defaultFooter } : {}),
        }
      : undefined

  return {
    titlePage: hasDifferentFirst,
    headers,
    footers,
  }
}

export async function createWordBlobFromIR(ir: DocumentIR): Promise<Blob> {
  const defaultFont = ir.defaultFontFamily ?? 'Times New Roman'
  const defaultSizePt = ir.defaultFontSizePt ?? 12

  // Kelompokkan halaman menjadi section hanya jika ukuran/orientasi halaman berubah
  const pageGroups: DocumentPageIR[][] = []
  for (const page of ir.pages) {
    if (page.blocks.length === 0) continue
    const prevGroup = pageGroups[pageGroups.length - 1]
    const prevPage = prevGroup?.[prevGroup.length - 1]
    const sameSize =
      prevPage &&
      Math.abs((prevPage.width ?? DEFAULT_PAGE_WIDTH_PT) - (page.width ?? DEFAULT_PAGE_WIDTH_PT)) < 10 &&
      Math.abs((prevPage.height ?? DEFAULT_PAGE_HEIGHT_PT) - (page.height ?? DEFAULT_PAGE_HEIGHT_PT)) < 10
    if (prevGroup && sameSize) {
      prevGroup.push(page)
    } else {
      pageGroups.push([page])
    }
  }

  const allBlocks =
    pageGroups.length > 0
      ? pageGroups.flatMap((group) => group.flatMap((p) => p.blocks))
      : ir.blocks

  const sections: ISectionOptions[] =
    pageGroups.length > 0
      ? pageGroups.map((group) => {
          const first = group[0]
          const widthPt = first.width ?? DEFAULT_PAGE_WIDTH_PT
          const heightPt = first.height ?? DEFAULT_PAGE_HEIGHT_PT
          const margins = first.margins ?? DEFAULT_MARGINS_PT
          const groupBlocks = group.flatMap((page) => page.blocks)
          const { titlePage, headers, footers } = buildSectionHeadersFooters(
            group,
            defaultFont,
          )
          return {
            properties: {
              titlePage,
              page: {
                size: {
                  width: ptToTwips(widthPt),
                  height: ptToTwips(heightPt),
                  orientation:
                    widthPt > heightPt
                      ? PageOrientation.LANDSCAPE
                      : PageOrientation.PORTRAIT,
                },
                margin: {
                  top: ptToTwips(margins.top),
                  right: ptToTwips(margins.right),
                  bottom: ptToTwips(margins.bottom),
                  left: ptToTwips(margins.left),
                  header: 220,
                  footer: 280,
                },
              },
            },
            headers,
            footers,
            children: createWordChildrenForBlocks(
              groupBlocks,
              defaultFont,
              defaultSizePt,
            ),
          }
        })
      : [
          {
            properties: {
              page: {
                margin: {
                  top: 1440,
                  right: 1440,
                  bottom: 1440,
                  left: 1440,
                },
              },
            },
            children: createWordChildrenForBlocks(
              ir.blocks,
              defaultFont,
              defaultSizePt,
            ),
          },
        ]

  const numberingConfig = collectNumberingConfigs(allBlocks, defaultFont, defaultSizePt)

  const doc = new Document({
    creator: 'LocalKit',
    title: ir.title,
    description: 'Dikonversi secara lokal dari PDF dengan LocalKit.',
    styles: {
      default: {
        document: {
          run: {
            font: defaultFont,
            size: Math.round(defaultSizePt * 2),
          },
        },
        heading1: {
          run: {
            font: defaultFont,
            size: Math.round(defaultSizePt * 2),
            bold: true,
            color: '000000',
          },
        },
        heading2: {
          run: {
            font: defaultFont,
            size: Math.round(defaultSizePt * 2),
            bold: true,
            color: '000000',
          },
        },
      },
    },
    numbering:
      numberingConfig.length > 0 ? { config: numberingConfig } : undefined,
    sections,
  })

  return Packer.toBlob(doc)
}

export async function createWordBlob(
  blocks: PdfWordBlock[],
  title: string,
): Promise<Blob> {
  return createWordBlobFromIR(createDocumentIR(blocks, title))
}
