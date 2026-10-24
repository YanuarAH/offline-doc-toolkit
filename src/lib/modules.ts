import { Images, Layers, PenTool, Scan, Stamp, type LucideIcon } from 'lucide-react'

export type ModuleId = 'watermark' | 'compressor' | 'background' | 'pdf' | 'signature'

export interface ModuleMeta {
  id: ModuleId
  title: string
  navLabel: string
  navHint: string
  description: string
  icon: LucideIcon
  tag: string
}

export const MODULES: ModuleMeta[] = [
  {
    id: 'watermark',
    title: 'KTP & ID Card Watermarker',
    navLabel: 'Watermarker',
    navHint: 'KTP & dokumen',
    description:
      'Bubuhkan watermark tanggal & kepemilikan pada foto KTP atau dokumen sensitif. Semua rendering terjadi di canvas perangkat Anda.',
    icon: Stamp,
    tag: 'Identity Shield',
  },
  {
    id: 'compressor',
    title: 'Batch Image Compressor',
    navLabel: 'Compressor',
    navHint: 'Target ukuran KB',
    description:
      'Kompres banyak gambar sekaligus ke WebP, JPEG, atau PNG. Tentukan target KB dan biarkan algoritma mencari kualitas terbaik.',
    icon: Images,
    tag: 'Size Optimizer',
  },
  {
    id: 'background',
    title: 'Background Remover',
    navLabel: 'Background Remover',
    navHint: 'Hapus latar foto',
    description:
      'Remove image backgrounds instantly with AI. Your images stay on your device.',
    icon: Scan,
    tag: 'AI Cutout',
  },
  {
    id: 'pdf',
    title: 'PDF Organizer & Compressor',
    navLabel: 'PDF Studio',
    navHint: 'Organize & compress',
    description:
      'Gabungkan, split, putar, dan susun ulang halaman PDF secara visual — atau kompres PDF dengan Ghostscript WASM 3 level (72/150/300 DPI). Semua di browser.',
    icon: Layers,
    tag: 'PDF Studio',
  },
  {
    id: 'signature',
    title: 'Image-to-PDF & Signature Stamper',
    navLabel: 'PDF & Signature',
    navHint: 'Image → PDF & tanda tangan',
    description:
      'Ubah banyak gambar menjadi PDF A4/F4 yang rapi, atau tempel tanda tangan transparan ke halaman PDF dengan posisi dan ukuran yang presisi.',
    icon: PenTool,
    tag: 'Sign & Export',
  },
]

export function getModule(id: ModuleId): ModuleMeta {
  return MODULES.find((module) => module.id === id) ?? MODULES[0]
}
