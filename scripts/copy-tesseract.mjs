import { cp, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'

await mkdir('public/tesseract/core', { recursive: true })
await mkdir('public/tessdata', { recursive: true })

await cp('node_modules/tesseract.js/dist/worker.min.js', 'public/tesseract/worker.min.js', {
  force: true,
})

for (const name of [
  'tesseract-core-lstm.wasm',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm',
  'tesseract-core-simd-lstm.wasm.js',
]) {
  const source = `node_modules/tesseract.js-core/${name}`
  if (existsSync(source)) {
    await cp(source, `public/tesseract/core/${name}`, { force: true })
  }
}

console.log('[ocr] Worker dan core Tesseract lokal siap.')
