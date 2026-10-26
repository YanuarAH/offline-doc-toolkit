import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Camera, Upload } from 'lucide-react'

interface ImageSourcePickerProps {
  accept?: string
  multiple?: boolean
  disabled?: boolean
  onFiles: (files: File[]) => void
  children: (openPicker: () => void) => ReactNode
}

export function ImageSourcePicker({
  accept = 'image/*',
  multiple = false,
  disabled = false,
  onFiles,
  children,
}: ImageSourcePickerProps) {
  const [open, setOpen] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  function openPicker() {
    if (!disabled) setOpen(true)
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    setOpen(false)
    if (files.length > 0) onFiles(files)
  }

  return (
    <>
      {children(openPicker)}
      {open ? createPortal(
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm"
          onClick={(event) => {
            event.stopPropagation()
            if (event.target === event.currentTarget) setOpen(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="image-source-title"
            className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl border border-white/[0.1] bg-ink-900 p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape') {
                setOpen(false)
              }
            }}
          >
            <h2 id="image-source-title" className="text-sm font-semibold text-white">
              Pilih sumber gambar
            </h2>
            <p className="mt-1 text-[11px] text-ink-400">
              Pilih gambar dari perangkat atau ambil foto baru.
            </p>
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-3 text-left transition hover:border-accent/35 hover:bg-accent/[0.06]"
                onClick={() => {
                  setOpen(false)
                  uploadInputRef.current?.click()
                }}
                autoFocus
              >
                <span className="grid size-9 place-items-center rounded-lg bg-accent/10 text-accent">
                  <Upload size={16} />
                </span>
                <span>
                  <span className="block text-[12px] font-medium text-ink-100">
                    Upload dari perangkat
                  </span>
                  <span className="mt-0.5 block text-[10px] text-ink-500">
                    Pilih file gambar yang sudah tersimpan
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-3 text-left transition hover:border-accent/35 hover:bg-accent/[0.06]"
                onClick={() => {
                  setOpen(false)
                  cameraInputRef.current?.click()
                }}
              >
                <span className="grid size-9 place-items-center rounded-lg bg-accent/10 text-accent">
                  <Camera size={16} />
                </span>
                <span>
                  <span className="block text-[12px] font-medium text-ink-100">
                    Ambil foto dengan kamera
                  </span>
                  <span className="mt-0.5 block text-[10px] text-ink-500">
                    Buka kamera perangkat
                  </span>
                </span>
              </button>
            </div>
            <button
              type="button"
              className="mt-3 w-full rounded-lg px-3 py-2 text-[11px] text-ink-400 transition hover:bg-white/[0.04] hover:text-white"
              onClick={() => setOpen(false)}
            >
              Batal
            </button>
          </section>
        </div>,
        document.body,
      ) : null}
      <input
        ref={uploadInputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={handleFiles}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept={accept}
        capture="environment"
        className="hidden"
        onChange={handleFiles}
      />
    </>
  )
}
