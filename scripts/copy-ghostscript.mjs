import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = resolve(root, 'node_modules/@jspawn/ghostscript-wasm')
const targetDir = resolve(root, 'public/wasm')

if (!existsSync(sourceDir)) {
  throw new Error(
    '[ghostscript] Paket @jspawn/ghostscript-wasm tidak ditemukan. Jalankan npm install.',
  )
}

mkdirSync(targetDir, { recursive: true })

for (const file of ['gs.js', 'gs.wasm', 'LICENSE']) {
  const source = resolve(sourceDir, file)
  const target = resolve(targetDir, file)
  if (!existsSync(source)) {
    throw new Error(`[ghostscript] Aset ${file} tidak ditemukan di ${sourceDir}.`)
  }

  const sameSize =
    existsSync(target) && statSync(source).size === statSync(target).size
  if (!sameSize) copyFileSync(source, target)
}

const wasmSize = statSync(resolve(targetDir, 'gs.wasm')).size
console.log(
  `[ghostscript] public/wasm siap (gs.wasm ${(wasmSize / 1024 / 1024).toFixed(1)} MB).`,
)
