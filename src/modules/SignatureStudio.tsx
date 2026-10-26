import { useState } from 'react'
import { FileImage, PenTool, ScanLine } from 'lucide-react'
import { cn } from '../lib/format'
import { ImagesToPdf } from './ImagesToPdf'
import { SignatureStamper } from './SignatureStamper'
import { DocumentScanner } from './DocumentScanner'

type StudioTab = 'images' | 'scanner' | 'signature'

const TABS = [
  {
    id: 'images' as const,
    label: 'Gambar ke PDF',
    hint: 'Susun gambar menjadi satu PDF',
    icon: FileImage,
  },
  {
    id: 'scanner' as const,
    label: 'Pemindai Dokumen',
    hint: 'Pindai, luruskan & rapikan',
    icon: ScanLine,
  },
  {
    id: 'signature' as const,
    label: 'Tanda Tangan PDF',
    hint: 'Tempel tanda tangan ke halaman PDF',
    icon: PenTool,
  },
]

export function SignatureStudio() {
  const [tab, setTab] = useState<StudioTab>('images')

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-3 lg:max-w-[900px]">
        {TABS.map((item) => {
          const Icon = item.icon
          const active = tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => setTab(item.id)}
              className={cn(
                'flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition',
                active
                  ? 'border-accent/30 bg-accent/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,.05)]'
                  : 'border-white/[0.065] bg-ink-900/60 hover:border-white/[0.12] hover:bg-white/[0.025]',
              )}
            >
              <span
                className={cn(
                  'grid size-9 shrink-0 place-items-center rounded-lg border transition',
                  active
                    ? 'border-accent/25 bg-accent/10 text-accent'
                    : 'border-white/[0.06] bg-white/[0.02] text-ink-400',
                )}
              >
                <Icon size={16} strokeWidth={1.9} />
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    'block text-[12px] font-semibold',
                    active ? 'text-white' : 'text-ink-200',
                  )}
                >
                  {item.label}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-ink-500">
                  {item.hint}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div key={tab} className="animate-fade-in">
        {tab === 'images' ? (
          <ImagesToPdf />
        ) : tab === 'scanner' ? (
          <DocumentScanner />
        ) : (
          <SignatureStamper />
        )}
      </div>
    </div>
  )
}
