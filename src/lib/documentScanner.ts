export interface ScannerControls {
  brightness: number
  contrast: number
  saturation: number
  filter: 'color' | 'grayscale' | 'document'
}

export interface EdgePoints {
  topLeft: [number, number]
  topRight: [number, number]
  bottomLeft: [number, number]
  bottomRight: [number, number]
}

const MAX_IMAGE_SIDE = 2200
const MAX_OUTPUT_SIDE = 2200
const DETECTION_SIDE = 480
const HOUGH_ANGLE_STEP = (2 * Math.PI) / 180

interface HoughLine {
  theta: number
  rho: number
  votes: number
}

interface LinePair {
  first: HoughLine
  second: HoughLine
  angle: number
  votes: number
}

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
  const saturation = controls.filter === 'color' ? (controls.saturation + 100) / 100 : 0

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

  if (controls.filter === 'document') {
    const histogram = new Uint32Array(256)
    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])
      histogram[gray] += 1
    }

    const pixelCount = data.length / 4
    let weightedTotal = 0
    for (let value = 0; value < histogram.length; value += 1) {
      weightedTotal += value * histogram[value]
    }
    let backgroundWeight = 0
    let backgroundTotal = 0
    let bestVariance = -1
    let threshold = 180
    for (let value = 0; value < histogram.length; value += 1) {
      backgroundWeight += histogram[value]
      if (backgroundWeight === 0) continue
      const foregroundWeight = pixelCount - backgroundWeight
      if (foregroundWeight === 0) break
      backgroundTotal += value * histogram[value]
      const backgroundMean = backgroundTotal / backgroundWeight
      const foregroundMean = (weightedTotal - backgroundTotal) / foregroundWeight
      const variance =
        backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2
      if (variance > bestVariance) {
        bestVariance = variance
        threshold = value
      }
    }

    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      const value = gray >= threshold ? 255 : 0
      data[i] = value
      data[i + 1] = value
      data[i + 2] = value
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

function lineIntersection(first: HoughLine, second: HoughLine): [number, number] | null {
  const firstCos = Math.cos(first.theta)
  const firstSin = Math.sin(first.theta)
  const secondCos = Math.cos(second.theta)
  const secondSin = Math.sin(second.theta)
  const determinant = firstCos * secondSin - firstSin * secondCos
  if (Math.abs(determinant) < 1e-5) return null
  return [
    (first.rho * secondSin - firstSin * second.rho) / determinant,
    (firstCos * second.rho - first.rho * secondCos) / determinant,
  ]
}

function polygonArea(points: [number, number][]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    area += current[0] * next[1] - next[0] * current[1]
  }
  return Math.abs(area) / 2
}

function isConvex(points: [number, number][]): boolean {
  let direction = 0
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]
    const b = points[(index + 1) % points.length]
    const c = points[(index + 2) % points.length]
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    if (Math.abs(cross) < 1) continue
    const nextDirection = Math.sign(cross)
    if (direction !== 0 && direction !== nextDirection) return false
    direction = nextDirection
  }
  return direction !== 0
}

export interface DocumentDetection {
  corners: EdgePoints
  detected: boolean
}

export function detectDocumentCorners(canvas: HTMLCanvasElement): DocumentDetection {
  const scale = Math.min(1, DETECTION_SIDE / Math.max(canvas.width, canvas.height))
  const width = Math.max(3, Math.round(canvas.width * scale))
  const height = Math.max(3, Math.round(canvas.height * scale))
  const sample = createCanvas(width, height)
  const sampleContext = sample.getContext('2d', { willReadFrequently: true })
  if (!sampleContext) throw new Error('Canvas 2D tidak tersedia untuk deteksi dokumen.')
  sampleContext.drawImage(canvas, 0, 0, width, height)
  const pixels = sampleContext.getImageData(0, 0, width, height).data
  const gray = new Uint8Array(width * height)
  for (let i = 0; i < gray.length; i += 1) {
    const offset = i * 4
    gray[i] = Math.round(
      pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722,
    )
  }

  const thetaCount = 180 / 2
  const rhoOffset = Math.ceil(Math.hypot(width, height))
  const rhoCount = rhoOffset * 2 + 1
  const accumulator = new Uint32Array(thetaCount * rhoCount)

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      const gx =
        -gray[index - width - 1] -
        2 * gray[index - 1] -
        gray[index + width - 1] +
        gray[index - width + 1] +
        2 * gray[index + 1] +
        gray[index + width + 1]
      const gy =
        -gray[index - width - 1] -
        2 * gray[index - width] -
        gray[index - width + 1] +
        gray[index + width - 1] +
        2 * gray[index + width] +
        gray[index + width + 1]
      const magnitude = Math.abs(gx) + Math.abs(gy)
      if (magnitude < 140) continue

      let centerAngle = Math.atan2(gy, gx)
      if (centerAngle < 0) centerAngle += Math.PI
      const centerTheta = Math.round(centerAngle / HOUGH_ANGLE_STEP)
      for (let offset = -5; offset <= 5; offset += 1) {
        let thetaIndex = centerTheta + offset
        let rho = x * Math.cos(thetaIndex * HOUGH_ANGLE_STEP) +
          y * Math.sin(thetaIndex * HOUGH_ANGLE_STEP)
        if (thetaIndex < 0) {
          thetaIndex += thetaCount
          rho = -rho
        } else if (thetaIndex >= thetaCount) {
          thetaIndex -= thetaCount
          rho = -rho
        }
        const rhoIndex = Math.round(rho) + rhoOffset
        if (rhoIndex >= 0 && rhoIndex < rhoCount) {
          accumulator[thetaIndex * rhoCount + rhoIndex] += 1
        }
      }
    }
  }

  const fallbackMargin = Math.min(width, height) * 0.04
  const fallback: EdgePoints = {
    topLeft: [fallbackMargin, fallbackMargin],
    topRight: [width - fallbackMargin, fallbackMargin],
    bottomLeft: [fallbackMargin, height - fallbackMargin],
    bottomRight: [width - fallbackMargin, height - fallbackMargin],
  }

  const peaks: HoughLine[] = []
  const minimumVotes = Math.max(7, Math.round(Math.min(width, height) * 0.055))
  for (let thetaIndex = 0; thetaIndex < thetaCount; thetaIndex += 1) {
    for (let rhoIndex = 0; rhoIndex < rhoCount; rhoIndex += 1) {
      const votes = accumulator[thetaIndex * rhoCount + rhoIndex]
      if (votes < minimumVotes) continue

      let isPeak = true
      for (let thetaOffset = -2; thetaOffset <= 2 && isPeak; thetaOffset += 1) {
        let neighborTheta = thetaIndex + thetaOffset
        let rhoSign = 1
        if (neighborTheta < 0) {
          neighborTheta += thetaCount
          rhoSign = -1
        } else if (neighborTheta >= thetaCount) {
          neighborTheta -= thetaCount
          rhoSign = -1
        }
        const neighborRho = rhoSign === 1 ? rhoIndex : rhoCount - 1 - rhoIndex
        for (let rhoOffsetIndex = -8; rhoOffsetIndex <= 8; rhoOffsetIndex += 1) {
          const candidateRho = neighborRho + rhoOffsetIndex
          if (
            candidateRho >= 0 &&
            candidateRho < rhoCount &&
            accumulator[neighborTheta * rhoCount + candidateRho] > votes
          ) {
            isPeak = false
            break
          }
        }
      }
      if (!isPeak) continue

      let theta = thetaIndex * HOUGH_ANGLE_STEP
      let rho = rhoIndex - rhoOffset
      if (theta >= Math.PI / 2) {
        theta -= Math.PI
        rho = -rho
      }
      peaks.push({ theta, rho, votes })
    }
  }

  peaks.sort((first, second) => second.votes - first.votes)
  const lines: HoughLine[] = []
  for (const peak of peaks) {
    const duplicate = lines.some((line) => {
      const angleDifference = Math.abs(line.theta - peak.theta)
      const sameDirection = angleDifference < 0.06
      const oppositeDirection = Math.abs(angleDifference - Math.PI) < 0.06
      const rhoDifference = Math.abs(line.rho - peak.rho)
      const flippedRhoDifference = Math.abs(line.rho + peak.rho)
      return (
        (sameDirection && rhoDifference < 12) ||
        (oppositeDirection && flippedRhoDifference < 12)
      )
    })
    if (!duplicate) lines.push(peak)
    if (lines.length >= 32) break
  }

  const linePairs: LinePair[] = []
  for (let first = 0; first < lines.length; first += 1) {
    for (let second = first + 1; second < lines.length; second += 1) {
      const lineA = lines[first]
      const lineB = lines[second]
      const angleDifference = Math.abs(lineA.theta - lineB.theta)
      if (angleDifference > 0.13) continue
      if (Math.abs(lineA.rho - lineB.rho) < Math.min(width, height) * 0.16) continue
      linePairs.push({
        first: lineA,
        second: lineB,
        angle: (lineA.theta + lineB.theta) / 2,
        votes: lineA.votes + lineB.votes,
      })
    }
  }

  let bestCorners: EdgePoints | null = null
  let bestScore = 0
  const imageArea = width * height
  for (let first = 0; first < linePairs.length; first += 1) {
    for (let second = first + 1; second < linePairs.length; second += 1) {
      const pairA = linePairs[first]
      const pairB = linePairs[second]
      const sharedLines = [
        pairA.first,
        pairA.second,
        pairB.first,
        pairB.second,
      ].some((line, index, all) => all.indexOf(line) !== index)
      if (sharedLines) continue

      const angle = Math.abs(pairA.angle - pairB.angle)
      if (angle < 1.0 || angle > 2.14) continue

      const intersections = [
        lineIntersection(pairA.first, pairB.first),
        lineIntersection(pairA.second, pairB.first),
        lineIntersection(pairA.second, pairB.second),
        lineIntersection(pairA.first, pairB.second),
      ]
      if (intersections.some((point) => point === null)) continue
      const points = intersections as [number, number][]
      const margin = Math.min(width, height) * 0.035
      if (
        points.some(
          ([x, y]) =>
            x < -margin || y < -margin || x > width + margin || y > height + margin,
        )
      ) {
        continue
      }
      const area = polygonArea(points)
      const areaRatio = area / imageArea
      if (areaRatio < 0.12 || areaRatio > 0.96 || !isConvex(points)) continue

      const topLeft = points.reduce((best, point) =>
        point[0] + point[1] < best[0] + best[1] ? point : best,
      )
      const bottomRight = points.reduce((best, point) =>
        point[0] + point[1] > best[0] + best[1] ? point : best,
      )
      const topRight = points.reduce((best, point) =>
        point[0] - point[1] > best[0] - best[1] ? point : best,
      )
      const bottomLeft = points.reduce((best, point) =>
        point[0] - point[1] < best[0] - best[1] ? point : best,
      )
      const candidate: EdgePoints = { topLeft, topRight, bottomLeft, bottomRight }
      const aspectRatio =
        Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight)) /
        Math.max(distance(topLeft, bottomLeft), distance(topRight, bottomRight))
      if (aspectRatio < 0.28 || aspectRatio > 3.6) continue

      const score = (pairA.votes + pairB.votes) * Math.sqrt(areaRatio)
      if (score > bestScore) {
        bestScore = score
        bestCorners = candidate
      }
    }
  }

  if (!bestCorners) {
    return {
      corners: scaleCorners(fallback, canvas.width / width, canvas.height / height),
      detected: false,
    }
  }
  return {
    corners: scaleCorners(bestCorners, canvas.width / width, canvas.height / height),
    detected: true,
  }
}

function scaleCorners(corners: EdgePoints, scaleX: number, scaleY: number): EdgePoints {
  return {
    topLeft: [corners.topLeft[0] * scaleX, corners.topLeft[1] * scaleY],
    topRight: [corners.topRight[0] * scaleX, corners.topRight[1] * scaleY],
    bottomLeft: [corners.bottomLeft[0] * scaleX, corners.bottomLeft[1] * scaleY],
    bottomRight: [corners.bottomRight[0] * scaleX, corners.bottomRight[1] * scaleY],
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
