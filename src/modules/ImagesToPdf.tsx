import { useEffect, useRef, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileImage,
  FilePlus2,
  GripVertical,
  ImagePlus,
  Images,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { Dropzone } from '../components/Dropzone'
import { Segmented, SliderField } from '../components/Controls'
import { buildImagesPdf, type PdfOrientation, type PdfPaperSize } from '../lib/imagesToPdf'
import { decodeImageFile } from '../lib/image'
import { partitionImageFiles } from '../lib/imageFormat'
import {
  cn,
  compactDay,
  downloadBlob,
  errorMessage,
  formatBytes,
} from '../lib/format'

interface ImageItem {
  id: string
  file: File
  url: string
  width: number
  height: number
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `img-${crypto.randomUUID()}`
  }
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

interface ImageCardProps {
  item: ImageItem
  index: number
  total: number
  disabled: boolean
  onRemove: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
}

function ImageCard({ item, index, total, disabled, onRemove, onMove }: ImageCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled })

  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 20 : undefined,
      }}
      className={cn(
        'group overflow-hidden rounded-xl border bg-ink-950/70',
        isDragging
          ? 'border-accent/50 opacity-80 shadow-[0_24px_60px_-20px_rgba(0,0,0,.9)]'
          : 'border-white/[0.075] hover:border-white/[0.14]',
      )}
    >
      <div className="relative aspect-square bg-white">
        <img
          src={item.url}
          alt={item.file.name}
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
          loading="lazy"
        />
        <span className="absolute top-2 left-2 rounded-md border border-white/20 bg-ink-950/80 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold text-white backdrop-blur">
          {index + 1}
        </span>
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          className="absolute right-2 bottom-2 inline-flex size-7 cursor-grab items-center justify-center rounded-md border border-white/15 bg-ink-950/75 text-ink-300 backdrop-blur transition hover:text-white active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Pindahkan ${item.file.name}`}
          title="Drag untuk mengubah urutan"
        >
          <GripVertical size={13} />
        </button>
      </div>

      <div className="space-y-1.5 border-t border-white/[0.055] p-2">
        <p className="truncate text-[10px] text-ink-300" title={item.file.name}>
          {item.file.name}
        </p>
        <p className="font-mono text-[9px] text-ink-500">
          {item.width}×{item.height} · {formatBytes(item.file.size)}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="icon-btn size-7"
            onClick={() => onMove(item.id, -1)}
            disabled={disabled || index === 0}
            aria-label="Pindah ke kiri"
            title="Pindah ke kiri"
          >
            <ChevronLeft size={12} />
          </button>
          <button
            type="button"
            className="icon-btn size-7 hover:!border-danger/40 hover:!text-danger"
            onClick={() => onRemove(item.id)}
            disabled={disabled}
            aria-label={`Hapus ${item.file.name}`}
            title="Hapus gambar"
          >
            <Trash2 size={12} />
          </button>
          <button
            type="button"
            className="icon-btn ml-auto size-7"
            onClick={() => onMove(item.id, 1)}
            disabled={disabled || index === total - 1}
            aria-label="Pindah ke kanan"
            title="Pindah ke kanan"
          >
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </article>
  )
}

export function ImagesToPdf() {
  const [items, setItems] = useState<ImageItem[]>([])
  const [paper, setPaper] = useState<PdfPaperSize>('a4')
  const [orientation, setOrientation] = useState<PdfOrientation>('portrait')
  const [margin, setMargin] = useState(12)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [notice, setNotice] = useState<string | null>(null)
  const [exportInfo, setExportInfo] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const urlsRef = useRef<Set<string>>(new Set())
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const urls = urlsRef.current

    return () => {
      mountedRef.current = false
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
    }
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function addFiles(files: File[]) {
    if (loading || exporting) return
    const { images } = await partitionImageFiles(files)
    if (images.length === 0) {
      setNotice('Pilih file gambar (JPG, PNG, WebP, HEIC, atau AVIF).')
      return
    }

    setLoading(true)
    setNotice(null)
    setExportInfo(null)
    const failures: string[] = []
    const additions: ImageItem[] = []

    try {
      for (const file of images) {
        try {
          const decoded = await decodeImageFile(file)
          try {
            const url = URL.createObjectURL(file)
            urlsRef.current.add(url)
            additions.push({
              id: createId(),
              file,
              url,
              width: decoded.width,
              height: decoded.height,
            })
          } finally {
            decoded.release()
          }
        } catch (imageError) {
          failures.push(`${file.name}: ${errorMessage(imageError)}`)
        }
      }
    } finally {
      if (!mountedRef.current) {
        additions.forEach((item) => {
          URL.revokeObjectURL(item.url)
          urlsRef.current.delete(item.url)
        })
      } else {
        if (additions.length > 0) {
          setItems((previous) => [...previous, ...additions])
        }
        setLoading(false)
        if (failures.length > 0) setNotice(failures.join(' · '))
      }
    }
  }

  function removeItem(id: string) {
    if (exporting) return
    const target = items.find((item) => item.id === id)
    if (!target) return

    URL.revokeObjectURL(target.url)
    urlsRef.current.delete(target.url)
    setItems((previous) => previous.filter((item) => item.id !== id))
    setExportInfo(null)
  }

  function clearAll() {
    if (exporting) return
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    urlsRef.current.clear()
    setItems([])
    setNotice(null)
    setExportInfo(null)
  }

  function moveItem(id: string, direction: -1 | 1) {
    if (exporting) return
    setItems((previous) => {
      const index = previous.findIndex((item) => item.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= previous.length) return previous
      return arrayMove(previous, index, target)
    })
    setExportInfo(null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id || exporting) return

    setItems((previous) => {
      const oldIndex = previous.findIndex((item) => item.id === active.id)
      const newIndex = previous.findIndex((item) => item.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return previous
      return arrayMove(previous, oldIndex, newIndex)
    })
    setExportInfo(null)
  }

  async function handleGenerate() {
    if (exporting || loading || items.length === 0) return

    setExporting(true)
    setNotice(null)
    setExportInfo(null)
    setProgress({ done: 0, total: items.length })

    try {
      const bytes = await buildImagesPdf(
        items.map((item) => item.file),
        { paper, orientation, marginMm: margin },
        (done, total) => {
          if (mountedRef.current) setProgress({ done, total })
        },
      )

      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
      const filename = `localkit-images-${compactDay(new Date())}.pdf`
      downloadBlob(blob, filename)
      setExportInfo(`${filename} · ${items.length} halaman · ${formatBytes(blob.size)}`)
    } catch (error) {
      if (mountedRef.current) setNotice(errorMessage(error))
    } finally {
      if (mountedRef.current) {
        setExporting(false)
        setProgress({ done: 0, total: 0 })
      }
    }
  }

  const busy = loading || exporting
  const totalSize = items.reduce((total, item) => total + item.file.size, 0)
  const progressPercent =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="animate-fade-up space-y-5">
      {notice ? (
        <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[11px] text-danger">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>{notice}</span>
          <button
            type="button"
            className="ml-auto text-danger/70 hover:text-danger"
            onClick={() => setNotice(null)}
            aria-label="Tutup pesan"
          >
            <X size={12} />
          </button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="panel bg-noise relative overflow-hidden p-2">
            <div className="pointer-events-none absolute inset-0 grid-lines opacity-30" />
            <div className="relative">
              <Dropzone
                multiple
                icon={ImagePlus}
                onFiles={(files) => void addFiles(files)}
                title="Tarik gambar untuk dijadikan PDF"
                subtitle="Susun banyak foto atau scan menjadi satu dokumen PDF"
                hint="JPG, PNG, WebP, HEIC, AVIF · urutan bisa diatur setelah diunggah"
                busy={loading}
              />
            </div>
          </div>

          <aside className="panel space-y-4 p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/[0.08] text-accent">
                <FileImage size={17} strokeWidth={1.9} />
              </span>
              <div>
                <h2 className="text-[13px] font-semibold text-white">Images to PDF</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
                  Setiap gambar menjadi satu halaman. Pilih ukuran kertas,
                  orientasi, margin, dan urutan halaman sebelum diekspor.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                ['A4', '210×297 mm'],
                ['F4', '210×330 mm'],
                ['Fit', 'Rasio gambar'],
              ].map(([title, hint]) => (
                <div key={title} className="panel-soft px-2 py-2 text-center">
                  <p className="font-mono text-[11px] text-accent">{title}</p>
                  <p className="mt-0.5 text-[8.5px] text-ink-500">{hint}</p>
                </div>
              ))}
            </div>

            <ul className="space-y-2.5">
              {[
                'Gambar dinormalisasi (EXIF) dan diskalakan otomatis',
                'Margin dalam milimeter, presisi saat dicetak',
                'Satu PDF rapi untuk seluruh batch gambar',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-[10.5px] text-ink-300">
                  <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-accent" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-2 rounded-lg border border-white/[0.055] bg-white/[0.02] px-3 py-2">
              <ShieldCheck size={12} className="text-accent/80" />
              <p className="text-[10px] text-ink-500">
                Konversi berjalan lokal dengan pdf-lib.
              </p>
            </div>
          </aside>
        </div>
      ) : (
        <div className="grid gap-5 min-[1200px]:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            <section className="panel flex flex-wrap items-center gap-2 px-3 py-2.5">
              <span className="eyebrow pl-1">Gambar</span>
              <span className="value-badge">{items.length}</span>
              <span className="font-mono text-[9.5px] text-ink-500">
                {formatBytes(totalSize)}
              </span>

              <button
                type="button"
                className="chip ml-auto"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
              >
                <Plus size={11} />
                Tambah gambar
              </button>
              <button
                type="button"
                className="btn-quiet !px-2 !py-1.5 !text-[10px]"
                onClick={clearAll}
                disabled={busy}
              >
                <Trash2 size={11} />
                Bersihkan
              </button>
            </section>

            <section className="panel overflow-hidden">
              <header className="flex items-center justify-between gap-3 border-b border-white/[0.055] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Images size={14} className="text-accent" />
                  <h2 className="text-[12.5px] font-semibold text-white">Urutan halaman</h2>
                </div>
                <span className="hidden text-[10px] text-ink-500 sm:inline">
                  Drag handle untuk mengubah urutan
                </span>
              </header>

              <div className="p-3 sm:p-4">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={items.map((item) => item.id)}
                    strategy={rectSortingStrategy}
                  >
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                      {items.map((item, index) => (
                        <ImageCard
                          key={item.id}
                          item={item}
                          index={index}
                          total={items.length}
                          disabled={busy}
                          onRemove={removeItem}
                          onMove={moveItem}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>

              <footer className="border-t border-white/[0.055] px-4 py-2.5 text-[10px] text-ink-500">
                Halaman PDF mengikuti urutan kartu di atas.
              </footer>
            </section>
          </div>

          <aside className="min-w-0">
            <section className="panel space-y-4 p-4 min-[1200px]:sticky min-[1200px]:top-5">
              <div className="flex items-center gap-2">
                <FilePlus2 size={14} className="text-accent" />
                <h2 className="text-[12.5px] font-semibold text-white">Pengaturan PDF</h2>
              </div>

              <div className="space-y-2">
                <span className="eyebrow">Ukuran kertas</span>
                <Segmented
                  compact
                  value={paper}
                  onChange={setPaper}
                  options={[
                    { value: 'a4', label: 'A4', hint: '210×297' },
                    { value: 'f4', label: 'F4', hint: '210×330' },
                    { value: 'fit', label: 'Fit', hint: 'Rasio gambar' },
                  ]}
                />
              </div>

              <div className="space-y-2">
                <span className="eyebrow">Orientasi</span>
                <Segmented
                  compact
                  value={orientation}
                  onChange={setOrientation}
                  options={[
                    { value: 'portrait', label: 'Portrait', hint: 'Tegak' },
                    { value: 'landscape', label: 'Landscape', hint: 'Mendatar' },
                  ]}
                  className={paper === 'fit' ? 'pointer-events-none opacity-40' : undefined}
                />
                {paper === 'fit' ? (
                  <p className="text-[9px] text-ink-500">
                    Fit-to-image mengikuti orientasi tiap gambar.
                  </p>
                ) : null}
              </div>

              <SliderField
                label="Margin"
                value={margin}
                min={0}
                max={40}
                step={1}
                display={`${margin} mm`}
                onChange={setMargin}
                disabled={exporting}
              />

              <div className="rounded-lg border border-white/[0.055] bg-white/[0.02] px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-ink-400">Total halaman</span>
                  <span className="font-mono text-[11px] text-accent">
                    {items.length}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="text-[10px] text-ink-400">Format</span>
                  <span className="font-mono text-[10px] text-ink-300">
                    {paper === 'fit'
                      ? 'Fit'
                      : `${paper.toUpperCase()} · ${
                          orientation === 'portrait' ? 'P' : 'L'
                        }`}
                  </span>
                </div>
              </div>

              <button
                type="button"
                className="btn-primary w-full !py-3"
                onClick={() => void handleGenerate()}
                disabled={busy || items.length === 0}
              >
                {exporting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Menyusun PDF… {progress.done}/{progress.total}
                  </>
                ) : (
                  <>
                    <FilePlus2 size={14} />
                    Buat PDF ({items.length} halaman)
                  </>
                )}
              </button>

              {exporting ? (
                <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              ) : null}

              {exportInfo ? (
                <p className="flex items-start gap-1.5 text-[10px] leading-relaxed break-all text-accent/90">
                  <CheckCircle2 size={11} className="mt-px shrink-0" />
                  {exportInfo}
                </p>
              ) : (
                <p className="text-center text-[9.5px] text-ink-500">
                  PDF dibuat langsung di browser, tanpa upload.
                </p>
              )}

              <div className="divider" />
              <p className="flex items-center gap-1.5 text-[9.5px] text-ink-500">
                <ShieldCheck size={10} className="text-accent/60" />
                Ukuran gambar besar otomatis diturunkan ke 2400px.
              </p>
            </section>
          </aside>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length > 0) void addFiles(files)
        }}
      />
    </div>
  )
}
