/**
 * Penghapus background berbasis AI — lapisan model (ONNX Runtime Web).
 *
 * Satu model untuk semua subjek: **BiRefNet-lite** (MIT) pada resolusi 512×512.
 * Model ini memisahkan objek utama — orang, produk, makanan, hewan — tanpa
 * perlu pemilihan mode.
 *
 * Aset disajikan dari origin aplikasi sendiri:
 *   /models/birefnet512/model.onnx   bobot fp32 ±183 MB (disiapkan saat install)
 *   /ort/…                     runtime ONNX Runtime Web ±13,6 MB
 *
 * Tidak ada permintaan ke CDN atau API eksternal, dan gambar pengguna tidak
 * pernah dikirim ke mana pun: piksel hanya hidup di memori tab ini.
 */
import { env, InferenceSession, Tensor } from 'onnxruntime-web/webgpu'
import {
  MODEL_INPUT_SIZE,
  MODEL_PATH,
  RUNTIME_LOADER_PATH,
  RUNTIME_WASM_PATH,
  assetUrl,
} from './backgroundModelInfo'

export interface PrepareProgress {
  stage: 'preparing'
  phase: 'runtime' | 'model'
  percent: number | null
  loaded?: number
  total?: number
}

export interface ProcessingProgress {
  stage: 'processing'
}

export type ModelProgress = PrepareProgress | ProcessingProgress

export interface NativeResult {
  blob: Blob
  width: number
  height: number
}

export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelUnavailableError'
  }
}

const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

let runtimePromise: Promise<void> | null = null
let sessionPromise: Promise<InferenceSession> | null = null

/**
 * Cek ketersediaan aset tanpa mematahkan mode offline:
 * kalau sudah ada di cache, tidak menyentuh jaringan sama sekali. Kalau belum,
 * ambil 1 byte dengan GET — bukan HEAD, karena route Workbox hanya GET.
 */
async function assertAsset(url: string, label: string): Promise<void> {
  if (typeof caches !== 'undefined') {
    try {
      if (await caches.match(url)) return
    } catch {
      // Cache API tidak bisa dibaca (mode privat) — lanjut ke pengecekan jaringan.
    }
  }

  let response: Response
  try {
    response = await fetch(url, { headers: { Range: 'bytes=0-0' } })
  } catch {
    throw new ModelUnavailableError(`Aset ${label} tidak bisa dibaca dari penyimpanan lokal.`)
  }

  const type = response.headers.get('content-type') ?? ''
  if (!response.ok || type.includes('text/html')) {
    throw new ModelUnavailableError(`Aset ${label} belum tersedia di build ini.`)
  }
}

async function readWithProgress(
  url: string,
  onChunk: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new ModelUnavailableError('Aset AI belum tersedia di build ini.')
  }

  const declared = Number(response.headers.get('content-length') ?? '')
  const total = Number.isFinite(declared) && declared > 0 ? declared : 0
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    loaded += value.byteLength
    onChunk(loaded, total)
  }

  const bytes = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}

/**
 * Siapkan wasm ONNX Runtime sekali per tab.
 *
 * Runtime dikirim sebagai byte (wasmBinary) dan loader-nya dimuat lewat blob
 * URL. Keduanya perlu: Vite menambahkan `?import` pada dynamic import ke /public
 * sehingga loader tidak bisa diimpor langsung saat `npm run dev`.
 */
function prepareRuntime(onProgress: (progress: ModelProgress) => void): Promise<void> {
  if (runtimePromise) return runtimePromise

  runtimePromise = (async () => {
    const wasm = env.wasm
    if (!wasm) throw new ModelUnavailableError('Runtime ONNX tidak tersedia di browser ini.')

    // Multi-thread hanya aktif bila halaman cross-origin isolated (COOP/COEP).
    wasm.numThreads =
      typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
        ? Math.min(4, Math.max(1, navigator.hardwareConcurrency || 1))
        : 1

    await assertAsset(assetUrl(RUNTIME_WASM_PATH), 'runtime ONNX Runtime')

    const bytes = await readWithProgress(assetUrl(RUNTIME_WASM_PATH), (loaded, total) => {
      onProgress({
        stage: 'preparing',
        phase: 'runtime',
        percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null,
        loaded,
        total: total || undefined,
      })
    })

    const loader = await (await fetch(assetUrl(RUNTIME_LOADER_PATH))).text()
    const loaderUrl = URL.createObjectURL(new Blob([loader], { type: 'text/javascript' }))

    wasm.wasmBinary = bytes as unknown as typeof wasm.wasmBinary
    wasm.wasmPaths = {
      mjs: loaderUrl,
      wasm: assetUrl(RUNTIME_WASM_PATH),
    }

    onProgress({ stage: 'preparing', phase: 'runtime', percent: 100 })
  })().catch((error) => {
    runtimePromise = null
    throw error
  })

  return runtimePromise
}

async function loadSession(
  onProgress: (progress: ModelProgress) => void,
): Promise<InferenceSession> {
  if (sessionPromise) return sessionPromise

  sessionPromise = (async () => {
    await prepareRuntime(onProgress)
    await assertAsset(assetUrl(MODEL_PATH), 'model U2Net')

    const bytes = await readWithProgress(assetUrl(MODEL_PATH), (loaded, total) => {
      onProgress({
        stage: 'preparing',
        phase: 'model',
        percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null,
        loaded,
        total: total || undefined,
      })
    })

    const session = await InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })

    onProgress({ stage: 'preparing', phase: 'model', percent: 100 })
    return session
  })().catch((error) => {
    // Jangan simpan kegagalan permanen: pengguna bisa mencoba lagi tanpa reload.
    sessionPromise = null
    throw error
  })

  return sessionPromise
}

function describeFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const message = raw.toLowerCase()

  if (message.includes('out of memory') || message.includes('allocation failed') || message.includes('oom')) {
    return 'Memori perangkat tidak cukup untuk gambar ini. Coba gambar dengan resolusi lebih kecil.'
  }
  if (message.includes('no available backend') || message.includes('wasm') || message.includes('webassembly')) {
    return 'Runtime AI gagal dijalankan di browser ini. Muat ulang halaman, atau coba browser lain (Chrome/Edge terbaru).'
  }
  if (message.includes('fetch') || message.includes('network') || message.includes('404')) {
    return 'Aset model AI gagal dimuat. Pastikan halaman dimuat ulang saat koneksi stabil, lalu coba lagi.'
  }

  return 'Gagal menghapus background. Coba lagi, atau gunakan gambar lain yang lebih kecil.'
}

/** Masukan U2Net: RGB 320×320, normalisasi ImageNet, layout NCHW. */
function toTensor(bitmap: ImageBitmap): Tensor {
  const canvas = document.createElement('canvas')
  canvas.width = MODEL_INPUT_SIZE
  canvas.height = MODEL_INPUT_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D tidak tersedia di browser ini.')

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)

  const { data } = context.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)
  const pixels = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE
  const input = new Float32Array(3 * pixels)

  for (let index = 0; index < pixels; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      input[channel * pixels + index] =
        (data[index * 4 + channel] / 255 - MEAN[channel]) / STD[channel]
    }
  }

  return new Tensor('float32', input, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE])
}

/**
 * Ubah peta salience menjadi alpha seukuran gambar.
 *
 * Mask digambar sebagai kanal alpha saja (RGB hitam) lalu dipakai dengan
 * `destination-in`, sehingga hanya alpha yang dikalikan — hasilnya PNG dengan
 * latar benar-benar transparan, bukan latar putih.
 */
async function compositeWithMask(
  bitmap: ImageBitmap,
  mask: Float32Array,
  width: number,
  height: number,
): Promise<Blob> {
  let min = Infinity
  let max = -Infinity
  for (const value of mask) {
    if (value < min) min = value
    if (value > max) max = value
  }
  const range = max - min || 1

  const maskData = new ImageData(width, height)
  for (let index = 0; index < mask.length; index += 1) {
    maskData.data[index * 4 + 3] = Math.round(((mask[index] - min) / range) * 255)
  }

  const smallMask = document.createElement('canvas')
  smallMask.width = width
  smallMask.height = height
  const smallContext = smallMask.getContext('2d')
  if (!smallContext) throw new Error('Canvas 2D tidak tersedia di browser ini.')
  smallContext.putImageData(maskData, 0, 0)

  const fullMask = document.createElement('canvas')
  fullMask.width = bitmap.width
  fullMask.height = bitmap.height
  const fullMaskContext = fullMask.getContext('2d')
  if (!fullMaskContext) throw new Error('Canvas 2D tidak tersedia di browser ini.')
  fullMaskContext.imageSmoothingEnabled = true
  fullMaskContext.imageSmoothingQuality = 'high'
  fullMaskContext.drawImage(smallMask, 0, 0, bitmap.width, bitmap.height)

  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D tidak tersedia di browser ini.')

  context.drawImage(bitmap, 0, 0)
  context.globalCompositeOperation = 'destination-in'
  context.drawImage(fullMask, 0, 0)
  context.globalCompositeOperation = 'source-over'

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Browser gagal menyimpan PNG. Coba gambar dengan ukuran lebih kecil.'))
    }, 'image/png')
  })
}

export async function removeBackgroundNative(
  file: File,
  onProgress: (progress: ModelProgress) => void,
): Promise<NativeResult> {
  try {
    const session = await loadSession(onProgress)
    onProgress({ stage: 'processing' })

    // Beri kesempatan browser menggambar overlay "Removing background…"
    // sebelum wasm memblokir main thread selama inferensi. rAF tidak fire di
    // tab background, jadi selalu ada timeout pengaman agar tidak menggantung.
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 60)
      requestAnimationFrame(() => {
        window.clearTimeout(timer)
        resolve()
      })
    })

    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    try {
      const tensor = toTensor(bitmap)
      const output = await session.run({ [session.inputNames[0]]: tensor })
      const result = output[session.outputNames[0]]
      const dims = result.dims
      const maskWidth = dims[dims.length - 1]
      const maskHeight = dims[dims.length - 2]

      // BiRefNet mengeluarkan logits; alpha butuh sigmoid (0..1).
      const logits = result.data as Float32Array
      const mask = new Float32Array(logits.length)
      for (let index = 0; index < logits.length; index += 1) {
        mask[index] = 1 / (1 + Math.exp(-logits[index]))
      }

      const blob = await compositeWithMask(bitmap, mask, maskWidth, maskHeight)
      return { blob, width: bitmap.width, height: bitmap.height }
    } finally {
      bitmap.close()
    }
  } catch (error) {
    if (error instanceof ModelUnavailableError) throw error
    throw new Error(describeFailure(error))
  }
}
