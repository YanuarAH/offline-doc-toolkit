import { ChevronRight, Lock, ShieldCheck, X } from 'lucide-react'
import { MODULES, type ModuleId } from '../lib/modules'
import { cn } from '../lib/format'

interface SidebarProps {
  active: ModuleId
  onSelect: (id: ModuleId) => void
  mobileOpen: boolean
  onClose: () => void
}

function SidebarBody({ active, onSelect }: Pick<SidebarProps, 'active' | 'onSelect'>) {
  return (
    <>
      <div className="flex items-center gap-3 px-5 pt-5 pb-6">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#7df0dc] to-accent-strong shadow-[0_10px_30px_-10px_rgba(94,234,212,.65)]">
          <ShieldCheck size={21} strokeWidth={2.2} className="text-ink-950" />
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold tracking-tight text-white">
            LocalKit<span className="text-accent">.</span>
          </p>
          <p className="truncate text-[10.5px] text-ink-500">Document &amp; Image Toolkit</p>
        </div>
      </div>

      <div className="px-3">
        <p className="eyebrow px-2 pb-2">Workspace</p>
        <nav className="space-y-1" aria-label="Modul aplikasi">
          {MODULES.map((module) => {
            const Icon = module.icon
            const isActive = module.id === active
            return (
              <button
                key={module.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onSelect(module.id)}
                className={cn(
                  'group relative flex w-full items-start gap-2.5 rounded-xl border px-2.5 py-2.5 text-left transition duration-150',
                  isActive
                    ? 'border-white/[0.075] bg-white/[0.05]'
                    : 'border-transparent hover:bg-white/[0.025]',
                )}
              >
                {isActive ? (
                  <span className="absolute top-1/2 left-0 h-6 w-[2px] -translate-y-1/2 rounded-r-full bg-accent shadow-[0_0_12px_rgba(94,234,212,.8)]" />
                ) : null}
                <span
                  className={cn(
                    'mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border transition',
                    isActive
                      ? 'border-accent/25 bg-accent/10 text-accent'
                      : 'border-white/[0.055] bg-white/[0.02] text-ink-400 group-hover:text-ink-200',
                  )}
                >
                  <Icon size={15} strokeWidth={1.9} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-1.5">
                    <span
                      className={cn(
                        'truncate text-[12.5px] font-medium',
                        isActive ? 'text-white' : 'text-ink-200',
                      )}
                    >
                      {module.navLabel}
                    </span>
                    <ChevronRight
                      size={11}
                      className={cn(
                        'shrink-0 transition',
                        isActive
                          ? 'text-accent'
                          : 'text-ink-600 group-hover:translate-x-0.5 group-hover:text-ink-400',
                      )}
                    />
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-ink-500">
                    {module.navHint}
                  </span>
                </span>
              </button>
            )
          })}
        </nav>
      </div>

      <div className="mt-auto space-y-3 p-3">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.018] p-3">
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-accent/10 text-accent">
              <Lock size={11} />
            </span>
            <p className="text-[11px] font-semibold text-ink-200">Privasi mutlak</p>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-ink-500">
            Tidak ada server, tidak ada upload. Semua pemrosesan berjalan di perangkat ini.
          </p>
          <div className="mt-3 flex items-center justify-between border-t border-white/[0.055] pt-2.5">
            <span className="flex items-center gap-1.5 font-mono text-[9px] text-ink-500">
              <span className="size-1.5 rounded-full bg-accent live-dot" />
              0 byte diunggah
            </span>
            <span className="font-mono text-[9px] text-ink-600">v0.2</span>
          </div>
        </div>
        <p className="px-2 text-center font-mono text-[9px] tracking-wide text-ink-600">
          local-first · offline-ready · no telemetry
        </p>
      </div>
    </>
  )
}

export function Sidebar({ active, onSelect, mobileOpen, onClose }: SidebarProps) {
  return (
    <>
      <aside className="hidden w-[264px] shrink-0 flex-col overflow-y-auto overscroll-contain border-r border-white/[0.055] bg-ink-925/70 backdrop-blur-xl lg:flex">
        <SidebarBody active={active} onSelect={onSelect} />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="animate-fade-in absolute inset-0 bg-black/65 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
          />
          <aside className="animate-fade-in absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col overflow-y-auto overscroll-contain border-r border-white/[0.08] bg-ink-925 shadow-2xl">
            <button
              type="button"
              className="icon-btn absolute top-5 right-4 z-10"
              onClick={onClose}
              aria-label="Tutup menu"
            >
              <X size={15} />
            </button>
            <SidebarBody
              active={active}
              onSelect={(id) => {
                onSelect(id)
                onClose()
              }}
            />
          </aside>
        </div>
      ) : null}
    </>
  )
}
