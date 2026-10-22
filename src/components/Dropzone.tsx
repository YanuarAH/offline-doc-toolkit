import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { ImagePlus, Loader2, UploadCloud, type LucideIcon } from 'lucide-react'
import { cn } from '../lib/format'

interface DropzoneProps {
  onFiles: (files: File[]) => void
  title: string
  subtitle: string
  hint?: string
  accept?: string
  multiple?: boolean
  icon?: LucideIcon
  compact?: boolean
  busy?: boolean
}

export function Dropzone({
  onFiles,
  title,
  subtitle,
  hint = 'JPG, PNG, WebP, HEIC, AVIF · maksimal 40 MB per file',
  accept = 'image/*',
  multiple = false,
  icon,
  compact = false,
  busy = false,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const Icon = icon ?? UploadCloud

  const openPicker = () => {
    if (busy) return
    inputRef.current?.click()
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (busy) return

    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return
    onFiles(multiple ? files : files.slice(0, 1))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openPicker()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={title}
      aria-busy={busy}
      onClick={openPicker}
      onKeyDown={handleKeyDown}
      onDragEnter={(event) => {
        event.preventDefault()
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={handleDrop}
      className={cn(
        'group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed text-center transition duration-200',
        compact ? 'min-h-[112px] gap-2 px-5 py-5' : 'min-h-[340px] gap-4 px-6 py-10',
        dragging
          ? 'border-accent/70 bg-accent/[0.06]'
          : 'border-white/[0.12] bg-white/[0.012] hover:border-accent/40 hover:bg-white/[0.025]',
        busy && 'pointer-events-none opacity-70',
      )}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300',
          dragging ? 'opacity-100' : 'group-hover:opacity-60',
        )}
        style={{
          background:
            'radial-gradient(420px 220px at 50% 0%, rgba(94,234,212,.12), transparent 70%)',
        }}
      />

      <span
        className={cn(
          'relative grid shrink-0 place-items-center rounded-2xl border border-white/[0.08] bg-ink-900 text-accent shadow-[0_10px_40px_-18px_rgba(94,234,212,.55)] transition',
          compact ? 'size-9 rounded-xl' : 'size-14',
          dragging && 'scale-105 border-accent/40',
        )}
      >
        {busy ? (
          <Loader2 size={compact ? 15 : 22} className="animate-spin" />
        ) : (
          <Icon size={compact ? 16 : 24} strokeWidth={1.8} />
        )}
      </span>

      <div className="relative space-y-1">
        <p
          className={cn(
            'font-semibold tracking-tight text-ink-100',
            compact ? 'text-[12px]' : 'text-[15px]',
          )}
        >
          {title}
        </p>
        <p className={cn('text-ink-400', compact ? 'text-[10.5px]' : 'text-[12px]')}>
          {subtitle}
        </p>
        {!compact ? <p className="pt-1 font-mono text-[9.5px] text-ink-500">{hint}</p> : null}
      </div>

      {!compact ? (
        <span className="relative mt-1 inline-flex items-center gap-2 rounded-xl border border-accent/25 bg-accent/[0.08] px-3.5 py-2 text-[11.5px] font-semibold text-accent transition group-hover:border-accent/40 group-hover:bg-accent/[0.12]">
          <ImagePlus size={13} />
          Pilih dari perangkat
        </span>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1))
        }}
      />
    </div>
  )
}
