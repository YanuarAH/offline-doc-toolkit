import { decodeImageFile } from './image'

export interface ScannerControls {
  brightness: number
  contrast: number
  saturation: number
  filter: 'auto' | 'color' | 'enhanced' | 'grayscale' | 'document'
}

export interface EdgePoints {
  topLeft: [number, number]
  topRight: [number, number]
  bottomLeft: [number, number]
  bottomRight: [number, number]
}

export function createFallbackDocumentCorners(width: number, height: number): EdgePoints {
  return {
    topLeft: [0, 0],
    topRight: [width, 0],
    bottomLeft: [0, height],
    bottomRight: [width, height],
  }
}

const MAX_IMAGE_SIDE = 2200
const MAX_OUTPUT_SIDE = 2200

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  if (!canvas.getContext('2d')) throw new Error('Canvas 2D tidak tersedia di browser ini.')
  return canvas
}

function copyCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = createCanvas(source.width, source.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D tidak tersedia di browser ini.')
  context.drawImage(source, 0, 0)
  return canvas
}

// ---------------------------------------------------------------------------
// Background estimation helpers — the core technique used by mobile document
// scanners (Google Drive, CamScanner, Adobe Scan) to remove shadows and
// normalise uneven lighting across a photographed document.
// ---------------------------------------------------------------------------

function clamp(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value)
}

interface BackgroundGrid {
  r: Float32Array
  g: Float32Array
  b: Float32Array
  w: number
  h: number
  blockSize: number
}

/**
 * Estimate per-channel background illumination using block-max + smoothing.
 *
 * The image is divided into a grid of blocks. For each block the brightest
 * pixel per channel is recorded (approximating the paper/background colour).
 * A 3×3 box blur is then applied to the small grid so that the interpolated
 * background varies smoothly across the image.
 */
function computeBackgroundGrid(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): BackgroundGrid {
  const blockSize = Math.max(8, Math.round(Math.min(width, height) * 0.065))
  const gw = Math.ceil(width / blockSize)
  const gh = Math.ceil(height / blockSize)
  const size = gw * gh

  const r = new Float32Array(size)
  const g = new Float32Array(size)
  const b = new Float32Array(size)

  for (let gy = 0; gy < gh; gy++) {
    const startY = gy * blockSize
    const endY = Math.min(startY + blockSize, height)
    for (let gx = 0; gx < gw; gx++) {
      const startX = gx * blockSize
      const endX = Math.min(startX + blockSize, width)
      let maxR = 0, maxG = 0, maxB = 0
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * width + x) * 4
          if (data[idx] > maxR) maxR = data[idx]
          if (data[idx + 1] > maxG) maxG = data[idx + 1]
          if (data[idx + 2] > maxB) maxB = data[idx + 2]
        }
      }
      const gi = gy * gw + gx
      // Floor at 24 to prevent division-by-near-zero later
      r[gi] = Math.max(24, maxR)
      g[gi] = Math.max(24, maxG)
      b[gi] = Math.max(24, maxB)
    }
  }

  return {
    r: smoothGrid(r, gw, gh),
    g: smoothGrid(g, gw, gh),
    b: smoothGrid(b, gw, gh),
    w: gw, h: gh, blockSize,
  }
}

/** 3×3 average blur on the small background grid to reduce block artefacts. */
function smoothGrid(grid: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, count = 0
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          sum += grid[ny * w + nx]
          count++
        }
      }
      out[y * w + x] = sum / count
    }
  }
  return out
}

/** Bilinear interpolation of the background grid at pixel (px, py). */
function sampleBg(
  grid: Float32Array, gw: number, gh: number, bs: number,
  px: number, py: number,
): number {
  const gxf = Math.max(0, Math.min(gw - 1.001, (px + 0.5) / bs - 0.5))
  const gyf = Math.max(0, Math.min(gh - 1.001, (py + 0.5) / bs - 0.5))
  const gx0 = gxf | 0
  const gy0 = gyf | 0
  const fx = gxf - gx0
  const fy = gyf - gy0
  const i = gy0 * gw + gx0
  return (1 - fy) * ((1 - fx) * grid[i] + fx * grid[i + 1]) +
         fy * ((1 - fx) * grid[i + gw] + fx * grid[i + gw + 1])
}

// ---------------------------------------------------------------------------
// adjustImage — applies the selected scanner filter + user adjustments
// ---------------------------------------------------------------------------

export function adjustImage(
  source: HTMLCanvasElement,
  controls: ScannerControls,
): HTMLCanvasElement {
  const canvas = copyCanvas(source)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D tidak tersedia di browser ini.')

  if (
    controls.brightness === 0 &&
    controls.contrast === 0 &&
    controls.saturation === 0 &&
    controls.filter === 'color'
  ) {
    return canvas
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  const width = canvas.width
  const height = canvas.height
  const contrastFactor = (controls.contrast + 100) / 100
  const userSaturation = (controls.saturation + 100) / 100

  // ── Asli (color) ────────────────────────────────────────────────────────
  // No background normalisation — just brightness, contrast, and saturation
  // on the original pixel data.
  if (controls.filter === 'color') {
    for (let i = 0; i < data.length; i += 4) {
      let r = Math.min(255, Math.max(0, data[i] + controls.brightness))
      let g = Math.min(255, Math.max(0, data[i + 1] + controls.brightness))
      let b = Math.min(255, Math.max(0, data[i + 2] + controls.brightness))
      r = Math.min(255, Math.max(0, (r - 128) * contrastFactor + 128))
      g = Math.min(255, Math.max(0, (g - 128) * contrastFactor + 128))
      b = Math.min(255, Math.max(0, (b - 128) * contrastFactor + 128))
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b
      data[i]     = clamp(gray + userSaturation * (r - gray))
      data[i + 1] = clamp(gray + userSaturation * (g - gray))
      data[i + 2] = clamp(gray + userSaturation * (b - gray))
    }
    ctx.putImageData(imageData, 0, 0)
    return canvas
  }

  // ── Scanner-style filters ───────────────────────────────────────────────
  // All remaining filters share the same first step: estimate the background
  // illumination from the *original* pixel data so that uneven lighting and
  // shadows are removed before any user adjustments are applied.
  const bg = computeBackgroundGrid(data, width, height)
  const { r: bgR, g: bgG, b: bgB, w: gw, h: gh, blockSize: bs } = bg

  if (controls.filter === 'auto') {
    // ── Otomatis ────────────────────────────────────────────────────────
    // Normalise against estimated background → white paper, clear text,
    // natural colours.  Mimics Google Drive / Lens scanner auto mode.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const bR = sampleBg(bgR, gw, gh, bs, x, y)
        const bG = sampleBg(bgG, gw, gh, bs, x, y)
        const bB = sampleBg(bgB, gw, gh, bs, x, y)

        // Normalise: pixel / background × targetWhite
        let r = (data[i]     / bR) * 240
        let g = (data[i + 1] / bG) * 240
        let b = (data[i + 2] / bB) * 240

        // User brightness & contrast on top of normalised result
        r = (r + controls.brightness - 128) * contrastFactor + 128
        g = (g + controls.brightness - 128) * contrastFactor + 128
        b = (b + controls.brightness - 128) * contrastFactor + 128

        // Saturation
        const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b
        r = gray + userSaturation * (r - gray)
        g = gray + userSaturation * (g - gray)
        b = gray + userSaturation * (b - gray)

        // Soft white clamp: push near-white smoothly towards pure white
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        if (lum > 222) {
          const t = Math.min(1, (lum - 222) / 26)
          const blend = t * t // quadratic ease for a natural roll-off
          r += blend * (255 - r)
          g += blend * (255 - g)
          b += blend * (255 - b)
        }

        data[i]     = clamp(r)
        data[i + 1] = clamp(g)
        data[i + 2] = clamp(b)
      }
    }
  } else if (controls.filter === 'enhanced') {
    // ── Warna cerah ─────────────────────────────────────────────────────
    // Like auto but with boosted saturation for vivid, punchy colours.
    // Great for colourful documents, business cards, and posters.
    const satBoost = 1.3 + controls.saturation / 200
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const bR = sampleBg(bgR, gw, gh, bs, x, y)
        const bG = sampleBg(bgG, gw, gh, bs, x, y)
        const bB = sampleBg(bgB, gw, gh, bs, x, y)

        let r = (data[i]     / bR) * 240
        let g = (data[i + 1] / bG) * 240
        let b = (data[i + 2] / bB) * 240

        r = (r + controls.brightness - 128) * contrastFactor + 128
        g = (g + controls.brightness - 128) * contrastFactor + 128
        b = (b + controls.brightness - 128) * contrastFactor + 128

        // Boosted saturation
        const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b
        r = gray + satBoost * (r - gray)
        g = gray + satBoost * (g - gray)
        b = gray + satBoost * (b - gray)

        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        if (lum > 218) {
          const t = Math.min(1, (lum - 218) / 30)
          const blend = t * t
          r += blend * (255 - r)
          g += blend * (255 - g)
          b += blend * (255 - b)
        }

        data[i]     = clamp(r)
        data[i + 1] = clamp(g)
        data[i + 2] = clamp(b)
      }
    }
  } else if (controls.filter === 'grayscale') {
    // ── Abu-abu ─────────────────────────────────────────────────────────
    // Clean grayscale with background normalisation for even tones.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const pixGray = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
        const bgGray =
          0.2126 * sampleBg(bgR, gw, gh, bs, x, y) +
          0.7152 * sampleBg(bgG, gw, gh, bs, x, y) +
          0.0722 * sampleBg(bgB, gw, gh, bs, x, y)

        let value = (pixGray / bgGray) * 240
        value = (value + controls.brightness - 128) * contrastFactor + 128

        if (value > 224) {
          const t = Math.min(1, (value - 224) / 24)
          value += t * t * (255 - value)
        }

        const v = clamp(value)
        data[i]     = v
        data[i + 1] = v
        data[i + 2] = v
      }
    }
  } else {
    // ── Hitam-putih (document) ──────────────────────────────────────────
    // Two-stage pipeline that produces crisp, photocopy-style B&W output:
    //   1. Background normalisation → eliminates shadows & uneven lighting
    //   2. Adaptive threshold on the normalised image → pure B&W
    // Normalising *before* thresholding is the key insight — it means the
    // adaptive window only needs to handle small local variations rather
    // than fighting large-scale illumination gradients.
    const normalized = new Uint8Array(width * height)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const pixGray = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
        const bgGray =
          0.2126 * sampleBg(bgR, gw, gh, bs, x, y) +
          0.7152 * sampleBg(bgG, gw, gh, bs, x, y) +
          0.0722 * sampleBg(bgB, gw, gh, bs, x, y)

        let value = (pixGray / bgGray) * 240
        value = (value + controls.brightness - 128) * contrastFactor + 128
        normalized[y * width + x] = clamp(value)
      }
    }

    // Integral image for fast local mean computation
    const stride = width + 1
    const integral = new Uint32Array(stride * (height + 1))
    for (let y = 0; y < height; y++) {
      let rowTotal = 0
      for (let x = 0; x < width; x++) {
        rowTotal += normalized[y * width + x]
        integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowTotal
      }
    }

    // Adaptive threshold — tighter radius works well on normalised input
    const radius = Math.max(8, Math.min(32, Math.round(Math.min(width, height) * 0.018)))
    for (let y = 0; y < height; y++) {
      const top = Math.max(0, y - radius)
      const bottom = Math.min(height, y + radius + 1)
      for (let x = 0; x < width; x++) {
        const left = Math.max(0, x - radius)
        const right = Math.min(width, x + radius + 1)
        const area = (right - left) * (bottom - top)
        const sum =
          integral[bottom * stride + right] -
          integral[top * stride + right] -
          integral[bottom * stride + left] +
          integral[top * stride + left]
        const mean = sum / area
        const pixel = normalized[y * width + x]

        // Smoothstep thresholding: ink where pixel is darker than local mean
        const diff = mean - pixel
        const inkStrength = Math.max(0, Math.min(1, (diff - 2) / 36))
        const smoothed = inkStrength * inkStrength * (3 - 2 * inkStrength)
        const value = Math.round((1 - smoothed) * 255)

        const idx = (y * width + x) * 4
        data[idx]     = value
        data[idx + 1] = value
        data[idx + 2] = value
      }
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}

function distance(a: [number, number], b: [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function solveLinearSystem(matrix: number[][], values: number[]): number[] | null {
  const size = values.length
  const rows = matrix.map((row, index) => [...row, values[index]])

  for (let column = 0; column < size; column += 1) {
    let pivot = column
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row
    }
    if (Math.abs(rows[pivot][column]) < 1e-10) return null
    ;[rows[column], rows[pivot]] = [rows[pivot], rows[column]]

    const divisor = rows[column][column]
    for (let cell = column; cell <= size; cell += 1) {
      rows[column][cell] /= divisor
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue
      const factor = rows[row][column]
      for (let cell = column; cell <= size; cell += 1) {
        rows[row][cell] -= factor * rows[column][cell]
      }
    }
  }

  return rows.map((row) => row[size])
}

function perspectiveTransform(
  corners: EdgePoints,
): ((u: number, v: number) => [number, number]) | null {
  const targetPoints = [
    { u: 0, v: 0, point: corners.topLeft },
    { u: 1, v: 0, point: corners.topRight },
    { u: 1, v: 1, point: corners.bottomRight },
    { u: 0, v: 1, point: corners.bottomLeft },
  ]
  const matrix: number[][] = []
  const values: number[] = []

  for (const { u, v, point: [x, y] } of targetPoints) {
    matrix.push([u, v, 1, 0, 0, 0, -u * x, -v * x])
    values.push(x)
    matrix.push([0, 0, 0, u, v, 1, -u * y, -v * y])
    values.push(y)
  }

  const h = solveLinearSystem(matrix, values)
  if (!h) return null
  return (u, v) => {
    const denominator = h[6] * u + h[7] * v + 1
    if (Math.abs(denominator) < 1e-10) return [0, 0]
    return [
      (h[0] * u + h[1] * v + h[2]) / denominator,
      (h[3] * u + h[4] * v + h[5]) / denominator,
    ]
  }
}

export function perspectiveCorrect(
  canvas: HTMLCanvasElement,
  corners: EdgePoints,
  targetWidth: number,
  targetHeight: number,
): HTMLCanvasElement {
  if (
    !Number.isFinite(targetWidth) ||
    !Number.isFinite(targetHeight) ||
    targetWidth < 1 ||
    targetHeight < 1
  ) {
    throw new Error('Ukuran hasil pemindaian tidak valid.')
  }

  const scale = Math.min(1, MAX_OUTPUT_SIDE / targetWidth, MAX_OUTPUT_SIDE / targetHeight)
  const width = Math.max(1, Math.round(targetWidth * scale))
  const height = Math.max(1, Math.round(targetHeight * scale))
  const output = createCanvas(width, height)
  const outputContext = output.getContext('2d')
  const sourceContext = canvas.getContext('2d')
  if (!outputContext || !sourceContext) {
    throw new Error('Canvas 2D tidak tersedia di browser ini.')
  }

  const source = sourceContext.getImageData(0, 0, canvas.width, canvas.height).data
  const image = outputContext.createImageData(width, height)
  const destination = image.data
  const mapPoint = perspectiveTransform(corners)
  if (!mapPoint) throw new Error('Sudut dokumen tidak membentuk perspektif yang valid.')

  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width
      const [sourceX, sourceY] = mapPoint(u, v)
      const left = Math.max(0, Math.min(canvas.width - 1, Math.floor(sourceX)))
      const top = Math.max(0, Math.min(canvas.height - 1, Math.floor(sourceY)))
      const right = Math.min(left + 1, canvas.width - 1)
      const bottom = Math.min(top + 1, canvas.height - 1)
      const fx = Math.max(0, Math.min(1, sourceX - left))
      const fy = Math.max(0, Math.min(1, sourceY - top))
      const topLeftIndex = (top * canvas.width + left) * 4
      const topRightIndex = (top * canvas.width + right) * 4
      const bottomLeftIndex = (bottom * canvas.width + left) * 4
      const bottomRightIndex = (bottom * canvas.width + right) * 4
      const outputIndex = (y * width + x) * 4

      for (let channel = 0; channel < 4; channel += 1) {
        const topValue =
          source[topLeftIndex + channel] * (1 - fx) +
          source[topRightIndex + channel] * fx
        const bottomValue =
          source[bottomLeftIndex + channel] * (1 - fx) +
          source[bottomRightIndex + channel] * fx
        destination[outputIndex + channel] = Math.round(
          topValue * (1 - fy) + bottomValue * fy,
        )
      }
    }
  }

  outputContext.putImageData(image, 0, 0)
  return output
}

export function cropToCorners(
  canvas: HTMLCanvasElement,
  corners: EdgePoints,
): HTMLCanvasElement {
  const { topLeft, topRight, bottomLeft, bottomRight } = corners
  const points = [topLeft, topRight, bottomLeft, bottomRight]
  if (
    points.some(
      ([x, y]) =>
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        x > canvas.width ||
        y > canvas.height,
    )
  ) {
    throw new Error('Pojok dokumen harus berada di dalam gambar.')
  }

  const width = Math.round(
    Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight)),
  )
  const height = Math.round(
    Math.max(distance(topLeft, bottomLeft), distance(topRight, bottomRight)),
  )
  if (width < 2 || height < 2) {
    throw new Error('Area dokumen terlalu kecil. Atur kembali keempat pojok.')
  }

  return perspectiveCorrect(canvas, corners, width, height)
}

export function rotateCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const output = createCanvas(canvas.height, canvas.width)
  const ctx = output.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D tidak tersedia di browser ini.')
  ctx.translate(output.width / 2, output.height / 2)
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
  return output
}

export function rotateCornersClockwise(
  corners: EdgePoints,
  _oldW: number,
  oldH: number,
): EdgePoints {
  // 90deg clockwise: newX = oldH - y, newY = x
  return {
    topLeft: [oldH - corners.bottomLeft[1], corners.bottomLeft[0]],
    topRight: [oldH - corners.topLeft[1], corners.topLeft[0]],
    bottomRight: [oldH - corners.topRight[1], corners.topRight[0]],
    bottomLeft: [oldH - corners.bottomRight[1], corners.bottomRight[0]],
  }
}

export async function loadImageToCanvas(
  source: File | HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  if (source instanceof HTMLCanvasElement) {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(source.width, source.height))
    const canvas = createCanvas(
      Math.max(1, Math.round(source.width * scale)),
      Math.max(1, Math.round(source.height * scale)),
    )
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D tidak tersedia di browser ini.')
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    return canvas
  }

  const decoded = await decodeImageFile(source)
  try {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(decoded.width, decoded.height))
    const canvas = createCanvas(
      Math.max(1, Math.round(decoded.width * scale)),
      Math.max(1, Math.round(decoded.height * scale)),
    )
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D tidak tersedia di browser ini.')
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    decoded.release()
  }
}
