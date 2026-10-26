import { Images, Layers, PenTool, Scan, Stamp, type LucideIcon } from 'lucide-react'

export type ModuleId =
  | 'watermark'
  | 'compressor'
  | 'background'
  | 'pdf'
  | 'signature'

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
    title: 'Watermark Foto',
    navLabel: 'Watermarker',
    navHint: 'Foto & gambar',
    description:
      'Tambahkan watermark teks pada foto atau gambar untuk menandai kepemilikan, status, atau tujuan penggunaan. Semua rendering terjadi di perangkat Anda.',
    icon: Stamp,
    tag: 'Image Watermark',
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
    title: 'Pengatur & Kompresor PDF',
    navLabel: 'PDF Studio',
    navHint: 'Atur halaman & perkecil ukuran',
    description:
      'Gabungkan, pisahkan, putar, dan susun ulang halaman PDF — atau perkecil ukuran PDF dengan Ghostscript WASM dalam 3 tingkat (72/150/300 DPI). Semua di browser.',
    icon: Layers,
    tag: 'PDF Studio',
  },
  {
    id: 'signature',
    title: 'PDF, Scanner & Tanda Tangan',
    navLabel: 'PDF & Pemindai',
    navHint: 'Gambar ke PDF & tanda tangan',
    description:
      'Ubah gambar menjadi PDF A4/F4, pindai dan luruskan dokumen, atau tempel tanda tangan ke halaman PDF. Semua diproses di perangkat.',
    icon: PenTool,
    tag: 'Sign & Export',
  },
]

export function getModule(id: ModuleId): ModuleMeta {
  return MODULES.find((module) => module.id === id) ?? MODULES[0]
}
