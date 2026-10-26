import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDirectory = resolve(root, 'node_modules/quadscan')
const targetDirectory = resolve(root, 'public/models/quadscan')
const modelFilename = 'lcnet100_h_e_bifpn_256_fp32.onnx'
const assets = [
  {
    source: 'licenses/DocAligner-LICENSE.txt',
    target: 'DocAligner-LICENSE.txt',
  },
  {
    source: 'LICENSE',
    target: 'Quadscan-LICENSE.txt',
  },
]

if (!existsSync(resolve(sourceDirectory, 'package.json'))) {
  throw new Error('Quadscan tidak ditemukan. Jalankan npm install terlebih dahulu.')
}

mkdirSync(targetDirectory, { recursive: true })
rmSync(resolve(targetDirectory, modelFilename), { force: true })
for (const asset of assets) {
  const source = resolve(sourceDirectory, asset.source)
  const target = resolve(targetDirectory, asset.target)
  if (!existsSync(source)) {
    throw new Error(`Aset Quadscan tidak ditemukan: ${source}`)
  }
  if (!existsSync(target) || statSync(source).size !== statSync(target).size) {
    copyFileSync(source, target)
  }
}

console.log('[quadscan] Lisensi model dan library lokal siap.')
