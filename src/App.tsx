import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  ChevronRight,
  Loader2,
  Lock,
  Menu,
  ShieldCheck,
  WifiOff,
} from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { MODULES, getModule, type ModuleId } from './lib/modules'
import { Watermarker } from './modules/Watermarker'
import { BatchCompressor } from './modules/BatchCompressor'
import { cn } from './lib/format'

const PdfStudio = lazy(() =>
  import('./modules/PdfStudio').then((module) => ({ default: module.PdfStudio })),
)

const SignatureStudio = lazy(() =>
  import('./modules/SignatureStudio').then((module) => ({
    default: module.SignatureStudio,
  })),
)

function moduleFromHash(): ModuleId {
  const hash = window.location.hash.replace('#', '')
  const match = MODULES.find((module) => module.id === hash)
  return match ? match.id : 'watermark'
}

function renderModule(id: ModuleId) {
  switch (id) {
    case 'watermark':
      return <Watermarker />
    case 'compressor':
      return <BatchCompressor />
    case 'pdf':
      return <PdfStudio />
    case 'signature':
      return <SignatureStudio />
  }
}

function useNetworkStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const [offlineReady, setOfflineReady] = useState(() => !import.meta.env.PROD)

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    let cancelled = false

    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker
        .getRegistration()
        .then((registration) => {
          if (!cancelled && registration?.active) setOfflineReady(true)
        })
        .catch(() => undefined)

      void navigator.serviceWorker.ready
        .then(() => {
          if (!cancelled) setOfflineReady(true)
        })
        .catch(() => undefined)

      const handleControllerChange = () => setOfflineReady(true)
      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)

      return () => {
        cancelled = true
        window.removeEventListener('online', handleOnline)
        window.removeEventListener('offline', handleOffline)
        navigator.serviceWorker.removeEventListener(
          'controllerchange',
          handleControllerChange,
        )
      }
    }

    return () => {
      cancelled = true
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return { online, offlineReady }
}

function ModuleFallback() {
  return (
    <div className="panel flex min-h-[320px] items-center justify-center gap-3 text-[12px] text-ink-400">
      <Loader2 size={18} className="animate-spin text-accent" />
      Memuat modul PDF…
    </div>
  )
}

export default function App() {
  const [active, setActive] = useState<ModuleId>(moduleFromHash)
  const [mobileOpen, setMobileOpen] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const meta = getModule(active)
  const { online, offlineReady } = useNetworkStatus()

  function selectModule(id: ModuleId) {
    setActive(id)
    window.history.replaceState(null, '', `#${id}`)
  }

  useEffect(() => {
    document.title = `${meta.title} · LocalKit`
    mainRef.current?.scrollTo({ top: 0 })
  }, [meta.title])

  const offlineLabel = !online
    ? 'Mode Offline'
    : offlineReady
      ? 'Offline Ready'
      : 'Menyiapkan offline…'

  return (
    <div className="flex h-dvh overflow-hidden bg-ink-950 text-ink-200">
      <Sidebar
        active={active}
        onSelect={selectModule}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-white/[0.055] bg-ink-950/85 backdrop-blur-xl lg:hidden">
          <div className="flex h-14 items-center gap-3 px-4">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMobileOpen(true)}
              aria-label="Buka menu navigasi"
            >
              <Menu size={16} />
            </button>
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-[#7df0dc] to-accent-strong">
                <ShieldCheck size={14} strokeWidth={2.2} className="text-ink-950" />
              </span>
              <span className="text-[13px] font-semibold tracking-tight text-white">
                LocalKit<span className="text-accent">.</span>
              </span>
            </div>
            <span
              className={cn(
                'pill ml-auto !py-0.5',
                !online && 'border-warn/25 bg-warn/[0.06] text-warn',
              )}
              title={offlineLabel}
            >
              {online && offlineReady ? (
                <WifiOff size={10} className="text-accent/80" />
              ) : online ? (
                <Loader2 size={10} className="animate-spin text-ink-400" />
              ) : (
                <WifiOff size={10} />
              )}
              <span className="max-w-[110px] truncate">{offlineLabel}</span>
            </span>
          </div>
        </header>

        <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1480px] px-4 pt-5 pb-10 sm:px-6 lg:px-8 lg:pt-7">
            <div className="flex flex-wrap items-start justify-between gap-4 pb-6">
              <div className="min-w-0">
                <nav
                  className="flex items-center gap-1.5 text-[9.5px]"
                  aria-label="Breadcrumb"
                >
                  <span className="font-mono tracking-[0.16em] text-ink-500 uppercase">
                    Workspace
                  </span>
                  <ChevronRight size={9} className="text-ink-600" />
                  <span className="font-medium text-accent/90">{meta.tag}</span>
                </nav>
                <h1 className="mt-2 text-[22px] leading-tight font-semibold tracking-tight text-white sm:text-[26px]">
                  {meta.title}
                </h1>
                <p className="text-balance mt-1.5 max-w-2xl text-[11.5px] leading-relaxed text-ink-400">
                  {meta.description}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'pill hidden sm:inline-flex',
                    !online
                      ? 'border-warn/25 bg-warn/[0.06] text-warn'
                      : 'border-accent/20 bg-accent/[0.05] text-accent',
                  )}
                  aria-live="polite"
                  title="Status service worker & koneksi"
                >
                  {online && offlineReady ? (
                    <WifiOff size={11} />
                  ) : online ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <WifiOff size={11} />
                  )}
                  {offlineLabel}
                </span>
                <span className="pill">
                  <Lock size={11} className="text-accent/80" />
                  Local Processing Only
                </span>
              </div>
            </div>

            <div key={active} className="animate-fade-in">
              <Suspense fallback={<ModuleFallback />}>{renderModule(active)}</Suspense>
            </div>

            <footer className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-white/[0.05] pt-4 text-[9.5px] text-ink-600 sm:flex-row">
              <span className="font-mono tracking-wide">
                LocalKit v0.2 · Vite + React + TypeScript
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Lock size={9} />
                File Anda tidak pernah dikirim ke server.
              </span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  )
}
