import { env, InferenceSession, Tensor } from 'onnxruntime-web/webgpu'

export type LayoutLabel =
  | 'Abandon'
  | 'Caption'
  | 'Footnote'
  | 'Formula'
  | 'List-item'
  | 'Page-footer'
  | 'Page-header'
  | 'Picture'
  | 'Section-header'
  | 'Table'
  | 'Text'
  | 'Title'

export interface LayoutRegion {
  label: LayoutLabel
  score: number
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutProgress {
  phase: 'runtime' | 'model'
  percent: number | null
  loaded?: number
  total?: number
}

const MODEL_PATH = `${import.meta.env.BASE_URL}models/doclayout-yolo/model.onnx`
const INPUT_SIZE = 1024
const CONFIDENCE_THRESHOLD = 0.25
const NMS_IOU_THRESHOLD = 0.45

/**
 * DocLayout-YOLO DocStructBench class mapping (index 0..9).
 */
const DOCSTRUCT_LABELS: LayoutLabel[] = [
  'Title', // 0: title
  'Text', // 1: plain text
  'Abandon', // 2: abandon (headers, footers, page numbers)
  'Picture', // 3: figure
  'Caption', // 4: figure_caption
  'Table', // 5: table
  'Caption', // 6: table_caption
  'Footnote', // 7: table_footnote
  'Formula', // 8: isolate_formula
  'Caption', // 9: formula_caption
]

let sessionPromise: Promise<InferenceSession> | null = null

function prepareRuntime() {
  const canThread = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1
  env.wasm.numThreads = canThread ? Math.min(4, cores) : 1
  env.wasm.wasmPaths = `${import.meta.env.BASE_URL}ort/`
}

async function fetchWithProgress(
  url: string,
  onProgress: (progress: LayoutProgress) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Model layout tidak tersedia: ${response.status}`)

  const total = Number(response.headers.get('content-length') || 0)
  if (!response.body) return response.arrayBuffer()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    loaded += value.byteLength
    onProgress({
      phase: 'model',
      percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null,
      loaded,
      total: total || undefined,
    })
  }
  const bytes = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes.buffer
}

async function createLayoutSession(model: ArrayBuffer): Promise<InferenceSession> {
  const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator
  if (hasWebGpu) {
    try {
      return await InferenceSession.create(model, {
        executionProviders: ['webgpu', 'wasm'],
        graphOptimizationLevel: 'all',
      })
    } catch {
      // Fallback ke WASM jika adapter WebGPU gagal diinisialisasi.
    }
  }
  return InferenceSession.create(model, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
}

export async function loadDocumentLayoutModel(
  onProgress: (progress: LayoutProgress) => void = () => undefined,
): Promise<InferenceSession> {
  if (sessionPromise) return sessionPromise
  sessionPromise = (async () => {
    prepareRuntime()
    onProgress({ phase: 'runtime', percent: 100 })
    const model = await fetchWithProgress(MODEL_PATH, onProgress)
    const session = await createLayoutSession(model)
    onProgress({ phase: 'model', percent: 100 })
    return session
  })().catch((error) => {
    sessionPromise = null
    throw error
  })
  return sessionPromise
}

export function canvasToLayoutTensor(canvas: HTMLCanvasElement): {
  tensor: Tensor
  scale: number
  offsetX: number
  offsetY: number
} {
  const work = document.createElement('canvas')
  work.width = INPUT_SIZE
  work.height = INPUT_SIZE
  const context = work.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas 2D tidak tersedia.')

  // DocLayout-YOLO letterbox padding color: (114, 114, 114)
  context.fillStyle = '#727272'
  context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE)

  const scale = Math.min(INPUT_SIZE / canvas.width, INPUT_SIZE / canvas.height)
  const width = Math.round(canvas.width * scale)
  const height = Math.round(canvas.height * scale)
  const offsetX = Math.floor((INPUT_SIZE - width) / 2)
  const offsetY = Math.floor((INPUT_SIZE - height) / 2)
  context.drawImage(canvas, offsetX, offsetY, width, height)

  const image = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data
  const pixels = INPUT_SIZE * INPUT_SIZE
  const data = new Float32Array(pixels * 3)

  // Model mengharapkan urutan channel BGR ternormalisasi [0, 1] (sesuai inference.py OpenCV).
  for (let index = 0; index < pixels; index += 1) {
    const rgba = index * 4
    data[index] = image[rgba + 2] / 255
    data[pixels + index] = image[rgba + 1] / 255
    data[pixels * 2 + index] = image[rgba] / 255
  }

  return {
    tensor: new Tensor('float32', data, [1, 3, INPUT_SIZE, INPUT_SIZE]),
    scale,
    offsetX,
    offsetY,
  }
}

function intersectionOverUnion(a: LayoutRegion, b: LayoutRegion): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  if (inter <= 0) return 0
  const union = a.width * a.height + b.width * b.height - inter
  return union > 0 ? inter / union : 0
}

function applyNms(regions: LayoutRegion[], iouThreshold: number): LayoutRegion[] {
  const sorted = [...regions].sort((a, b) => b.score - a.score)
  const kept: LayoutRegion[] = []
  for (const candidate of sorted) {
    const suppressed = kept.some(
      (existing) => intersectionOverUnion(existing, candidate) > iouThreshold,
    )
    if (!suppressed) kept.push(candidate)
  }
  return kept
}

export async function detectDocumentLayout(
  canvas: HTMLCanvasElement,
  onProgress: (progress: LayoutProgress) => void = () => undefined,
): Promise<LayoutRegion[]> {
  const session = await loadDocumentLayoutModel(onProgress)
  const prepared = canvasToLayoutTensor(canvas)
  const inputName = session.inputNames[0] ?? 'images'
  const results = await session.run({ [inputName]: prepared.tensor })
  const outputName = session.outputNames[0] ?? 'output0'
  const output = results[outputName]
  if (!output) return []

  const dimensions = output.dims
  const values = output.data as Float32Array
  const regions: LayoutRegion[] = []

  if (dimensions.length === 3) {
    const predictionCount = dimensions[1]
    const stride = dimensions[2]
    for (let index = 0; index < predictionCount; index += 1) {
      const offset = index * stride
      const xmin = values[offset]
      const ymin = values[offset + 1]
      const xmax = values[offset + 2]
      const ymax = values[offset + 3]
      const score = values[offset + 4]
      const labelId = values[offset + 5]
      if (score < CONFIDENCE_THRESHOLD) continue
      const label = DOCSTRUCT_LABELS[Math.round(labelId)]
      if (!label) continue

      const x1 = Math.max(0, (xmin - prepared.offsetX) / prepared.scale)
      const y1 = Math.max(0, (ymin - prepared.offsetY) / prepared.scale)
      const x2 = Math.min(canvas.width, (xmax - prepared.offsetX) / prepared.scale)
      const y2 = Math.min(canvas.height, (ymax - prepared.offsetY) / prepared.scale)
      const width = x2 - x1
      const height = y2 - y1
      if (width <= 8 || height <= 8) continue

      regions.push({
        label,
        score,
        x: x1,
        y: y1,
        width,
        height,
      })
    }
  }

  return applyNms(regions, NMS_IOU_THRESHOLD).sort((a, b) => a.y - b.y || a.x - b.x)
}
