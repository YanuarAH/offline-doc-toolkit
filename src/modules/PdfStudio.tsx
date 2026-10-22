import { useState } from 'react'
import { Gauge, Layers } from 'lucide-react'
import { cn } from '../lib/format'
import { PdfOrganizer } from './PdfOrganizer'
import { PdfCompressor } from './PdfCompressor'

type PdfTab = 'organizer' | 'compress'

const TABS = [
  {
    id: 'organizer' as const,
    label: 'Organizer',
    hint: 'Merge, split, rotate & reorder',
    icon: Layers,
  },
  {
    id: 'compress' as const,
    label: 'Compressor',
    hint: 'Ghostscript WASM · 3 level',
    icon: Gauge,
  },
]

export function PdfStudio() {
  const [tab, setTab] = useState<PdfTab>('organizer')

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-2 lg:max-w-[620px]">
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
        {tab === 'organizer' ? <PdfOrganizer /> : <PdfCompressor />}
      </div>
    </div>
  )
}
