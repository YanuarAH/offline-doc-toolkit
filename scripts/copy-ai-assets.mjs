/**
 * Menyiapkan aset lokal untuk fitur AI Background Remover.
 *
 * 1. Runtime ONNX Runtime Web (ort-wasm-simd-threaded.*) — disalin dari
 *    node_modules, sehingga versi JS dan wasm selalu sama.
 * 2. Bobot BiRefNet-lite 512 (MIT, ±183 MB) — diunduh sekali dari Hugging Face
 *    lalu disajikan dari origin aplikasi sendiri. File ini TIDAK di-commit
 *    karena melebihi batas 100 MB per file GitHub.
 *
 * Jika unduhan gagal (offline saat build), script hanya memberi peringatan:
 * aplikasi tetap bisa dibuild, dan halaman Background Remover menampilkan
 * pesan "model belum tersedia". Ulangi dengan `npm run model:fetch`.
 */
import {
  existsSync,
  mkdirSync,
  renameSync,
  copyFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const forceModel = process.argv.includes('--force-model')

const ORT_FILES = [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
]

const MODEL = {
  repo: 'JONNYVERSE/birefnet-lite-512',
  path: 'onnx/model.onnx',
  target: 'public/models/birefnet512/model.onnx',
  minBytes: 150_000_000,
}

const ortTargetDir = resolve(root, 'public/ort')

function megabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function copyOrtRuntime() {
  const candidates = [
    resolve(root, 'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist'),
    resolve(root, 'node_modules/onnxruntime-web/dist'),
  ]
  const ortDist = candidates.find(
    (dir) => existsSync(dir) && existsSync(resolve(dir, ORT_FILES[1])),
  )

  if (!ortDist) {
    console.warn(
      '[ai] Runtime onnxruntime-web tidak ditemukan — aset ONNX Runtime dilewati. Jalankan npm install.',
    )
    return
  }

  mkdirSync(ortTargetDir, { recursive: true })

  for (const file of ORT_FILES) {
    const source = resolve(ortDist, file)
    const target = resolve(ortTargetDir, file)
    if (!existsSync(source)) {
      console.warn(`[ai] Runtime ${file} tidak ditemukan di ${ortDist}.`)
      continue
    }
    const upToDate = existsSync(target) && statSync(source).size === statSync(target).size
    if (!upToDate) copyFileSync(source, target)
  }

  const runtimeBytes = ORT_FILES.reduce((total, file) => {
    const target = resolve(ortTargetDir, file)
    return total + (existsSync(target) ? statSync(target).size : 0)
  }, 0)
  if (runtimeBytes > 0) {
    console.log(
      `[ai] public/ort siap (onnxruntime runtime ${megabytes(runtimeBytes)}).`,
    )
  }
}

async function fetchModel() {
  const target = resolve(root, MODEL.target)
  const present = existsSync(target) && statSync(target).size >= MODEL.minBytes && !forceModel

  if (present) {
    console.log(`[ai] Model BiRefNet-lite 512 siap (${megabytes(statSync(target).size)}).`)
    return
  }

  mkdirSync(dirname(target), { recursive: true })
  const url = `https://huggingface.co/${MODEL.repo}/resolve/main/${MODEL.path}`
  console.log(`[ai] Mengunduh ${MODEL.repo}/${MODEL.path} (±183 MB)…`)

  try {
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength < MODEL.minBytes) {
      throw new Error(`file terlalu kecil (${megabytes(buffer.byteLength)})`)
    }
    const partial = `${target}.part`
    writeFileSync(partial, buffer)
    renameSync(partial, target)
    console.log(`[ai] Model siap (${megabytes(buffer.byteLength)}, MIT).`)
  } catch (error) {
    rmSync(`${target}.part`, { force: true })
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(
      `[ai] Gagal mengunduh model: ${reason}. Fitur Background Remover akan menampilkan ` +
        'pesan "model tidak tersedia" sampai aset ini ada. Jalankan `npm run model:fetch` saat online.',
    )
  }
}

copyOrtRuntime()
await fetchModel()
