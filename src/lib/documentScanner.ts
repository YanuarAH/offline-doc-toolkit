export interface ScannedImage {
  canvas: HTMLCanvasElement
  width: number
  height: number
  dataUrl: string
}

export interface ScannerControls {
  brightness: number
  contrast: number
  saturation: number
}

export interface EdgePoints {
  topLeft: [number, number]
  topRight: [number, number]
  bottomLeft: [number, number]
  bottomRight: [number, number]
}

export function adjustImage(
  canvas: HTMLCanvasElement,
  controls: ScannerControls,
): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context not available')

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]

    // Brightness
    r = Math.min(255, Math.max(0, r + controls.brightness))
    g = Math.min(255, Math.max(0, g + controls.brightness))
    b = Math.min(255, Math.max(0, b + controls.brightness))

    // Contrast
    const contrast = (controls.contrast + 100) / 100
    r = Math.min(255, Math.max(0, (r - 128) * contrast + 128))
    g = Math.min(255, Math.max(0, (g - 128) * contrast + 128))
    b = Math.min(255, Math.max(0, (b - 128) * contrast + 128))

    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}

export function perspectiveCorrect(
  canvas: HTMLCanvasElement,
  corners: EdgePoints,
  targetWidth: number,
  targetHeight: number,
): HTMLCanvasElement {
  const tempCanvas = document.createElement('canvas')
  tempCanvas.width = targetWidth
  tempCanvas.height = targetHeight
  const ctx = tempCanvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context not available')

  const sourceCtx = canvas.getContext('2d')
  if (!sourceCtx) throw new Error('Source canvas context not available')

  const imageData = sourceCtx.getImageData(0, 0, canvas.width, canvas.height)

  const [x0, y0] = corners.topLeft
  const [x1, y1] = corners.topRight
  const [x2, y2] = corners.bottomLeft
  const [x3, y3] = corners.bottomRight

  const outputImageData = ctx.createImageData(targetWidth, targetHeight)
  const outputData = outputImageData.data
  const inputData = imageData.data

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const u = x / targetWidth
      const v = y / targetHeight

      const sx =
        (1 - u) * ((1 - v) * x0 + v * x2) + u * ((1 - v) * x1 + v * x3)
      const sy =
        (1 - u) * ((1 - v) * y0 + v * y2) + u * ((1 - v) * y1 + v * y3)

      const sx0 = Math.floor(sx)
      const sy0 = Math.floor(sy)
      const sx1 = Math.min(sx0 + 1, canvas.width - 1)
      const sy1 = Math.min(sy0 + 1, canvas.height - 1)

      const fx = sx - sx0
      const fy = sy - sy0

      const getPixel = (px: number, py: number) => {
        const idx = (py * canvas.width + px) * 4
        return [inputData[idx], inputData[idx + 1], inputData[idx + 2], inputData[idx + 3]]
      }

      const [r00, g00, b00, a00] = getPixel(sx0, sy0)
      const [r10, g10, b10, a10] = getPixel(sx1, sy0)
      const [r01, g01, b01, a01] = getPixel(sx0, sy1)
      const [r11, g11, b11, a11] = getPixel(sx1, sy1)

      const outIdx = (y * targetWidth + x) * 4

      outputData[outIdx] = Math.round(
        (1 - fx) * (1 - fy) * r00 +
          fx * (1 - fy) * r10 +
          (1 - fx) * fy * r01 +
          fx * fy * r11,
      )
      outputData[outIdx + 1] = Math.round(
        (1 - fx) * (1 - fy) * g00 +
          fx * (1 - fy) * g10 +
          (1 - fx) * fy * g01 +
          fx * fy * g11,
      )
      outputData[outIdx + 2] = Math.round(
        (1 - fx) * (1 - fy) * b00 +
          fx * (1 - fy) * b10 +
          (1 - fx) * fy * b01 +
          fx * fy * b11,
      )
      outputData[outIdx + 3] = Math.round(
        (1 - fx) * (1 - fy) * a00 +
          fx * (1 - fy) * a10 +
          (1 - fx) * fy * a01 +
          fx * fy * a11,
      )
    }
  }

  ctx.putImageData(outputImageData, 0, 0)
  return tempCanvas
}

export function cropToCorners(
  canvas: HTMLCanvasElement,
  corners: EdgePoints,
): HTMLCanvasElement {
  const [x0, y0] = corners.topLeft
  const [x1, y1] = corners.topRight
  const [x2, y2] = corners.bottomLeft
  const [x3, y3] = corners.bottomRight

  const minX = Math.min(x0, x1, x2, x3)
  const minY = Math.min(y0, y1, y2, y3)
  const maxX = Math.max(x0, x1, x2, x3)
  const maxY = Math.max(y0, y1, y2, y3)

  const width = Math.ceil(maxX - minX)
  const height = Math.ceil(maxY - minY)

  const sourceCtx = canvas.getContext('2d')
  if (!sourceCtx) throw new Error('Canvas context not available')

  const imageData = sourceCtx.getImageData(minX, minY, width, height)

  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = width
  cropCanvas.height = height

  const targetCtx = cropCanvas.getContext('2d')
  if (!targetCtx) throw new Error('Target canvas context not available')

  targetCtx.putImageData(imageData, 0, 0)

  return perspectiveCorrect(
    cropCanvas,
    {
      topLeft: [x0 - minX, y0 - minY],
      topRight: [x1 - minX, y1 - minY],
      bottomLeft: [x2 - minX, y2 - minY],
      bottomRight: [x3 - minX, y3 - minY],
    },
    width,
    height,
  )
}

export async function loadImageToCanvas(source: File | string): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context not available')

  return new Promise((resolve, reject) => {
    const img = new Image()

    const onLoad = () => {
      canvas.width = img.width
      canvas.height = img.height
      ctx.drawImage(img, 0, 0)
      resolve(canvas)
    }

    const onError = () => {
      reject(new Error('Failed to load image'))
    }

    img.onload = onLoad
    img.onerror = onError

    if (typeof source === 'string') {
      img.src = source
    } else {
      const reader = new FileReader()
      reader.onload = (e) => {
        img.src = (e.target?.result as string) || ''
      }
      reader.onerror = onError
      reader.readAsDataURL(source)
    }
  })
}
