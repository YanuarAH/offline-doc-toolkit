/**
 * Deteksi format berdasarkan isi file (magic bytes), bukan MIME/ekstensi.
 *
 * Penting untuk file dari galeri HP: Android sering memberi `file.type` kosong
 * atau nama tanpa ekstensi, sehingga foto HEIC lolos sebagai "bukan gambar".
 */

export type ImageFormat =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'bmp'
  | 'tiff'
  | 'avif'
  | 'heic'
  | 'heif'
  | 'jxl'
  | 'svg'
  | 'unknown'

export const FORMAT_NAME: Record<ImageFormat, string> = {
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  gif: 'GIF',
  bmp: 'BMP',
  tiff: 'TIFF',
  avif: 'AVIF',
  heic: 'HEIC',
  heif: 'HEIF',
  jxl: 'JPEG XL',
  svg: 'SVG',
  unknown: 'tidak dikenal',
}

const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'hevm',
])

const AVIF_BRANDS = new Set(['avif', 'avis'])
const GENERIC_HEIF_BRANDS = new Set(['mif1', 'msf1', 'mif2'])

const IMAGE_EXTENSION = /\.(png|jpe?g|jfif|webp|avif|gif|bmp|hei[cf]|hif|tiff?|jxl)$/i

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return ''
  let text = ''
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(bytes[offset + index])
  }
  return text
}

export function isHeifFormat(format: ImageFormat): boolean {
  return format === 'heic' || format === 'heif' || format === 'avif'
}

/** Format yang paling mungkin dibuka langsung oleh <img>/createImageBitmap. */
export function isProbablyNativeFormat(format: ImageFormat): boolean {
  return format !== 'heic' && format !== 'heif' && format !== 'unknown'
}

export function detectImageFormat(head: Uint8Array): ImageFormat {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'jpeg'
  }
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47
  ) {
    return 'png'
  }
  if (head.length >= 4 && ascii(head, 0, 4) === 'GIF8') return 'gif'
  if (head.length >= 2 && ascii(head, 0, 2) === 'BM') return 'bmp'
  if (head.length >= 4 && (ascii(head, 0, 4) === 'II*\u0000' || ascii(head, 0, 4) === 'MM\u0000*')) {
    return 'tiff'
  }
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0x0a) return 'jxl'
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') {
    return 'webp'
  }

  // ISO-BMFF container: [size][ftyp][major brand][minor version][compatible brands…]
  if (head.length >= 12 && ascii(head, 4, 4) === 'ftyp') {
    const brands: string[] = [ascii(head, 8, 4)]
    for (let offset = 16; offset + 4 <= Math.min(head.length, 512); offset += 4) {
      brands.push(ascii(head, offset, 4))
    }

    if (brands.some((brand) => HEIC_BRANDS.has(brand))) return 'heic'
    if (brands.some((brand) => AVIF_BRANDS.has(brand))) return 'avif'
    if (brands.some((brand) => GENERIC_HEIF_BRANDS.has(brand))) return 'heif'
    if (brands.includes('jxl ')) return 'jxl'
  }

  const text = ascii(head, 0, Math.min(head.length, 256)).trimStart()
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) {
    return 'svg'
  }

  return 'unknown'
}

export function hasImageExtension(name: string): boolean {
  return IMAGE_EXTENSION.test(name)
}

/** Cek cepat tanpa membaca file: dipakai untuk memfilter drop pertama. */
export function looksLikeImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  if (hasImageExtension(file.name)) return true
  // Galeri/kamera di Android kerap mengirim MIME kosong atau octet-stream.
  return file.type === '' || file.type === 'application/octet-stream'
}

export async function readFileHead(file: File, length = 512): Promise<Uint8Array> {
  const slice = file.slice(0, Math.min(length, file.size))
  return new Uint8Array(await slice.arrayBuffer())
}

export async function sniffImageFormat(file: File, head?: Uint8Array): Promise<ImageFormat> {
  if (head && head.length > 0) return detectImageFormat(head)
  try {
    return detectImageFormat(await readFileHead(file))
  } catch {
    return 'unknown'
  }
}

export interface PartitionedFiles {
  images: File[]
  rejected: File[]
}

/**
 * Pisahkan file gambar dari file lain. File dengan MIME/ekstensi yang tidak
 * meyakinkan tetap diperiksa lewat magic bytes agar foto HEIC dari galeri HP
 * tidak ikut terbuang.
 */
export async function partitionImageFiles(files: File[]): Promise<PartitionedFiles> {
  const images: File[] = []
  const rejected: File[] = []

  for (const file of files) {
    if (file.type.startsWith('image/') || hasImageExtension(file.name)) {
      images.push(file)
      continue
    }

    if (!looksLikeImageFile(file)) {
      rejected.push(file)
      continue
    }

    const format = await sniffImageFormat(file)
    if (format === 'unknown') rejected.push(file)
    else images.push(file)
  }

  return { images, rejected }
}

export interface ImageSize {
  width: number
  height: number
}

/**
 * Baca dimensi dari header tanpa mendekode piksel. Dipakai untuk menjelaskan
 * kegagalan decode pada foto beresolusi ekstrem (mis. 108 MP dari kamera HP).
 */
export function readImageSize(head: Uint8Array): ImageSize | null {
  // PNG: IHDR tepat setelah signature 8 byte.
  if (head.length >= 24 && ascii(head, 12, 4) === 'IHDR') {
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }

  // GIF: logical screen descriptor (little endian).
  if (head.length >= 10 && ascii(head, 0, 4) === 'GIF8') {
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }

  // BMP
  if (head.length >= 26 && ascii(head, 0, 2) === 'BM') {
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
    return {
      width: Math.abs(view.getInt32(18, true)),
      height: Math.abs(view.getInt32(22, true)),
    }
  }

  // WebP (VP8X / VP8 / VP8L)
  if (head.length >= 30 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') {
    const chunk = ascii(head, 12, 4)
    if (chunk === 'VP8X') {
      const width = 1 + (head[24] | (head[25] << 8) | (head[26] << 16))
      const height = 1 + (head[27] | (head[28] << 8) | (head[29] << 16))
      return { width, height }
    }
    if (chunk === 'VP8 ') {
      const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      }
    }
    if (chunk === 'VP8L') {
      const bits = head[21] | (head[22] << 8) | (head[23] << 16) | (head[24] << 24)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
  }

  // JPEG: telusuri marker sampai SOFn.
  if (head.length >= 4 && head[0] === 0xff && head[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < head.length) {
      if (head[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = head[offset + 1]
      const length = (head[offset + 2] << 8) | head[offset + 3]
      const isSof =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      if (isSof) {
        return {
          height: (head[offset + 5] << 8) | head[offset + 6],
          width: (head[offset + 7] << 8) | head[offset + 8],
        }
      }
      if (length < 2) break
      offset += 2 + length
    }
  }

  return null
}
