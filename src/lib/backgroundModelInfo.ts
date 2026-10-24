/**
 * Metadata aset AI Background Remover.
 *
 * Dipisah dari modul model supaya UI dan validasi bisa memakai konstanta ini
 * tanpa ikut menarik ONNX Runtime ke chunk awal.
 */

export const MODEL_PATH = 'models/birefnet512/model.onnx'
export const RUNTIME_WASM_PATH = 'ort/ort-wasm-simd-threaded.wasm'
export const RUNTIME_LOADER_PATH = 'ort/ort-wasm-simd-threaded.mjs'

/** BiRefNet-lite diekspor pada 512×512; gambar diskalakan (bukan dipotong). */
export const MODEL_INPUT_SIZE = 512

export const RUNTIME_MB = 13.6
export const MODEL_MB = 183
export const FIRST_LOAD_MB = Math.round(RUNTIME_MB + MODEL_MB)

export const MODEL_INFO = {
  name: 'BiRefNet-lite 512',
  license: 'MIT',
  source: 'JONNYVERSE/birefnet-lite-512',
} as const

export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`
}

/** True bila bobot model sudah ada di Cache Storage (siap offline). */
export async function isModelCached(): Promise<boolean> {
  if (typeof caches === 'undefined') return false
  try {
    return Boolean(await caches.match(assetUrl(MODEL_PATH)))
  } catch {
    return false
  }
}
