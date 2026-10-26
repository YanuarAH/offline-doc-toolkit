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
  const contrast = (controls.contrast + 100) / 100
  const saturation =
    controls.filter === 'grayscale' || controls.filter === 'document'
      ? 0
      : (controls.saturation + (controls.filter === 'enhanced' ? 14 : 0) + 100) / 100

  for (let i = 0; i < data.length; i += 4) {
    let r = Math.min(255, Math.max(0, data[i] + controls.brightness))
    let g = Math.min(255, Math.max(0, data[i + 1] + controls.brightness))
    let b = Math.min(255, Math.max(0, data[i + 2] + controls.brightness))

    r = Math.min(255, Math.max(0, (r - 128) * contrast + 128))
    g = Math.min(255, Math.max(0, (g - 128) * contrast + 128))
    b = Math.min(255, Math.max(0, (b - 128) * contrast + 128))

    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b
    data[i] = gray + saturation * (r - gray)
    data[i + 1] = gray + saturation * (g - gray)
    data[i + 2] = gray + saturation * (b - gray)
  }

  if (controls.filter === 'enhanced') {
    const histogram = new Uint32Array(256)
    for (let i = 0; i < data.length; i += 4) {
      const luminance = Math.round(
        0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2],
      )
      histogram[luminance] += 1
    }

    const pixelCount = data.length / 4
    const lowTarget = Math.floor(pixelCount * 0.02)
    const highTarget = Math.floor(pixelCount * 0.98)
    let low = 0
    let high = 255
    let cumulative = 0
    for (let value = 0; value < histogram.length; value += 1) {
      cumulative += histogram[value]
      if (cumulative >= lowTarget) {
        low = value
        break
      }
    }
    cumulative = 0
    for (let value = 0; value < histogram.length; value += 1) {
      cumulative += histogram[value]
      if (cumulative >= highTarget) {
        high = value
        break
      }
    }
    if (high - low >= 24) {
      const range = high - low
      for (let i = 0; i < data.length; i += 4) {
        const luminance =
          0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
        const mapped = Math.min(255, Math.max(0, ((luminance - low) / range) * 255))
        const scale = luminance > 1 ? mapped / luminance : 0
        data[i] = Math.min(255, data[i] * scale)
        data[i + 1] = Math.min(255, data[i + 1] * scale)
        data[i + 2] = Math.min(255, data[i + 2] * scale)
      }
    }
  }

  if (controls.filter === 'auto') {
    const histogram = new Uint32Array(256)
    for (let i = 0; i < data.length; i += 4) {
      const luminance = Math.round(
        0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2],
      )
      histogram[luminance] += 1
    }

    const pixelCount = data.length / 4
    const lowTarget = Math.floor(pixelCount * 0.02)
    const highTarget = Math.floor(pixelCount * 0.99)
    let low = 0
    let high = 255
    let cumulative = 0
    for (let value = 0; value < histogram.length; value += 1) {
      cumulative += histogram[value]
      if (cumulative >= lowTarget) {
        low = value
        break
      }
    }
    cumulative = 0
    for (let value = 0; value < histogram.length; value += 1) {
      cumulative += histogram[value]
      if (cumulative >= highTarget) {
        high = value
        break
      }
    }

    if (high - low >= 32) {
      const range = high - low
      for (let i = 0; i < data.length; i += 4) {
        const luminance =
          0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
        const normalized = Math.max(0, Math.min(1, (luminance - low) / range))
        const mapped = 12 + normalized * 236
        const scale = luminance > 1 ? mapped / luminance : 0
        data[i] = Math.min(255, data[i] * scale)
        data[i + 1] = Math.min(255, data[i + 1] * scale)
        data[i + 2] = Math.min(255, data[i + 2] * scale)
      }
    }
  }

  if (controls.filter === 'document') {
    const width = canvas.width
    const height = canvas.height
    const stride = width + 1
    const luminance = new Uint8Array(width * height)
    const integral = new Uint32Array(stride * (height + 1))

    for (let y = 0; y < height; y += 1) {
      let rowTotal = 0
      for (let x = 0; x < width; x += 1) {
        const pixel = (y * width + x) * 4
        const gray = Math.round(
          0.2126 * data[pixel] + 0.7152 * data[pixel + 1] + 0.0722 * data[pixel + 2],
        )
        luminance[y * width + x] = gray
        rowTotal += gray
        integral[(y + 1) * stride + x + 1] =
          integral[y * stride + x + 1] + rowTotal
      }
    }

    const radius = Math.max(12, Math.min(48, Math.round(Math.min(width, height) * 0.025)))
    for (let y = 0; y < height; y += 1) {
      const top = Math.max(0, y - radius)
      const bottom = Math.min(height, y + radius + 1)
      for (let x = 0; x < width; x += 1) {
        const left = Math.max(0, x - radius)
        const right = Math.min(width, x + radius + 1)
        const area = (right - left) * (bottom - top)
        const sum =
          integral[bottom * stride + right] -
          integral[top * stride + right] -
          integral[bottom * stride + left] +
          integral[top * stride + left]
        const mean = sum / area
        const gray = luminance[y * width + x]
        const inkStrength = Math.max(0, Math.min(1, (mean - gray - 4) / 54))
        const softenedInk = inkStrength * inkStrength * (3 - 2 * inkStrength)
        const value = Math.round((1 - softenedInk) * 255)
        const pixel = (y * width + x) * 4
        data[pixel] = value
        data[pixel + 1] = value
        data[pixel + 2] = value
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

  const url = URL.createObjectURL(source)
  const image = new Image()
  image.decoding = 'async'

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Gambar tidak bisa dibuka. Pilih file JPG, PNG, atau WebP.'))
      image.src = url
    })

    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = createCanvas(
      Math.max(1, Math.round(image.naturalWidth * scale)),
      Math.max(1, Math.round(image.naturalHeight * scale)),
    )
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D tidak tersedia di browser ini.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    image.src = ''
    URL.revokeObjectURL(url)
  }
}
