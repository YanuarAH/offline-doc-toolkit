import { useEffect, useMemo, useRef, useState } from 'react'
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
  Download,
  FilePlus2,
  FileText,
  GripVertical,
  Layers,
  Loader2,
  Plus,
  RotateCw,
  Scissors,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { Dropzone } from '../components/Dropzone'
import { Segmented } from '../components/Controls'
import {
  destroyPdfDocument,
  openPdfDocument,
  renderPageThumbnail,
  type PDFDocumentProxy,
} from '../lib/pdfjs'
import { buildOrganizedPdf, type OrganizeSourceInput } from '../lib/organizePdf'
import { parsePageRange } from '../lib/pageRange'
import {
  cn,
  compactDay,
  downloadBlob,
  errorMessage,
  formatBytes,
} from '../lib/format'

interface SourceMeta {
  id: string
  name: string
  size: number
  pageCount: number
}

interface OrganizerPage {
  id: string
  sourceId: string
  sourceName: string
  pageIndex: number
  /** Additional rotation chosen by the user (multiples of 90). */
  rotation: number
  baseRotation: number
  thumb: string
}

type RangeMode = 'all' | 'range'

const SOURCE_COLORS = ['#5eead4', '#8b7bff', '#fbbf24', '#fb7185', '#60a5fa', '#34d399']

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function sourceColor(sourceId: string): string {
  let hash = 0
  for (let index = 0; index < sourceId.length; index += 1) {
    hash = (hash * 31 + sourceId.charCodeAt(index)) >>> 0
  }
  return SOURCE_COLORS[hash % SOURCE_COLORS.length]
}

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

interface PageCardProps {
  page: OrganizerPage
  index: number
  total: number
  disabled: boolean
  updating: boolean
  onRotate: (id: string) => void
  onDelete: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
}

function PageCard({
  page,
  index,
  total,
  disabled,
  updating,
  onRotate,
  onDelete,
  onMove,
}: PageCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id, disabled })

  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 20 : undefined,
      }}
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-ink-950/70 transition-shadow',
        isDragging
          ? 'border-accent/50 opacity-80 shadow-[0_24px_60px_-20px_rgba(0,0,0,.9)]'
          : 'border-white/[0.075] hover:border-white/[0.14]',
      )}
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-white">
        <img
          src={page.thumb}
          alt={`Halaman ${index + 1} dari ${page.sourceName}`}
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
          loading="lazy"
        />

        <span className="absolute top-2 left-2 rounded-md border border-white/20 bg-ink-950/80 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold text-white backdrop-blur">
          {index + 1}
        </span>

        <span
          className="absolute top-2 right-2 size-2 rounded-full ring-2 ring-ink-950/60"
          style={{ backgroundColor: sourceColor(page.sourceId) }}
          title={page.sourceName}
        />

        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          className="absolute right-2 bottom-2 inline-flex size-7 cursor-grab items-center justify-center rounded-md border border-white/15 bg-ink-950/75 text-ink-300 backdrop-blur transition hover:text-white active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Pindahkan halaman ${index + 1}`}
          title="Drag untuk mengubah urutan"
        >
          <GripVertical size={13} />
        </button>

        {page.rotation !== 0 ? (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md border border-accent/25 bg-ink-950/80 px-1.5 py-0.5 font-mono text-[9px] text-accent backdrop-blur">
            <RotateCw size={8} />
            {page.rotation}°
          </span>
        ) : null}

        {updating ? (
          <div className="absolute inset-0 grid place-items-center bg-ink-950/55 backdrop-blur-[1px]">
            <Loader2 size={17} className="animate-spin text-accent" />
          </div>
        ) : null}
      </div>

      <div className="space-y-1.5 border-t border-white/[0.055] p-2">
        <p className="truncate text-[9.5px] text-ink-500" title={`${page.sourceName} · hal. ${page.pageIndex + 1}`}>
          {page.sourceName}
          <span className="text-ink-600"> · hal. {page.pageIndex + 1}</span>
        </p>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="icon-btn size-7"
            onClick={() => onMove(page.id, -1)}
            disabled={disabled || index === 0}
            aria-label={`Pindah halaman ${index + 1} ke kiri`}
            title="Pindah ke kiri"
          >
            <ChevronLeft size={12} />
          </button>
          <button
            type="button"
            className="icon-btn size-7 hover:!border-accent/35 hover:!text-accent"
            onClick={() => onRotate(page.id)}
            disabled={disabled || updating}
            aria-label={`Rotasi halaman ${index + 1} 90 derajat`}
            title="Rotate 90°"
          >
            <RotateCw size={12} />
          </button>
          <button
            type="button"
            className="icon-btn size-7 hover:!border-danger/40 hover:!text-danger"
            onClick={() => onDelete(page.id)}
            disabled={disabled}
            aria-label={`Hapus halaman ${index + 1}`}
            title="Hapus halaman"
          >
            <Trash2 size={12} />
          </button>
          <button
            type="button"
            className="icon-btn ml-auto size-7"
            onClick={() => onMove(page.id, 1)}
            disabled={disabled || index === total - 1}
            aria-label={`Pindah halaman ${index + 1} ke kanan`}
            title="Pindah ke kanan"
          >
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </article>
  )
}

export function PdfOrganizer() {
  const [sources, setSources] = useState<SourceMeta[]>([])
  const [pages, setPages] = useState<OrganizerPage[]>([])
  const [importing, setImporting] = useState(false)
  const [importLabel, setImportLabel] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const [exportInfo, setExportInfo] = useState<string | null>(null)
  const [rangeMode, setRangeMode] = useState<RangeMode>('all')
  const [rangeInput, setRangeInput] = useState('1-3')

  const addInputRef = useRef<HTMLInputElement>(null)
  const docsRef = useRef<Map<string, PDFDocumentProxy>>(new Map())
  const sourcesRef = useRef<Map<string, OrganizeSourceInput>>(new Map())
  const mountedRef = useRef(true)
  const importingRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    const docs = docsRef.current
    const sourceBytes = sourcesRef.current

    return () => {
      mountedRef.current = false
      docs.forEach((document) => void destroyPdfDocument(document))
      docs.clear()
      sourceBytes.clear()
    }
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function handlePdfFiles(files: File[]) {
    if (importingRef.current || exporting) return

    const pdfFiles = files.filter(isPdfFile)
    if (pdfFiles.length === 0) {
      setNotice('Pilih file PDF (ekstensi .pdf).')
      return
    }

    importingRef.current = true
    setImporting(true)
    setNotice(null)
    setExportInfo(null)

    const failures: string[] = []

    try {
      for (const file of pdfFiles) {
        if (!mountedRef.current) return
        if (file.size > 120 * 1024 * 1024) {
          failures.push(`${file.name}: file lebih dari 120 MB`)
          continue
        }

        const sourceId = createId('src')
        let document: PDFDocumentProxy | null = null

        try {
          setImportLabel(`Membaca ${file.name}…`)
          const bytes = new Uint8Array(await file.arrayBuffer())
          document = await openPdfDocument(bytes)
          const pageCount = document.numPages
          if (pageCount === 0) throw new Error('PDF tidak memiliki halaman.')

          const newPages: OrganizerPage[] = []

          for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
            if (!mountedRef.current) {
              await destroyPdfDocument(document)
              return
            }

            setImportLabel(
              `Merender ${file.name} · halaman ${pageNumber}/${pageCount}`,
            )

            const page = await document.getPage(pageNumber)
            const thumb = await renderPageThumbnail(page, page.rotate, 380)
            newPages.push({
              id: createId('page'),
              sourceId,
              sourceName: file.name,
              pageIndex: pageNumber - 1,
              rotation: 0,
              baseRotation: page.rotate,
              thumb,
            })
            page.cleanup()
          }

          if (!mountedRef.current) {
            await destroyPdfDocument(document)
            return
          }

          docsRef.current.set(sourceId, document)
          sourcesRef.current.set(sourceId, { name: file.name, bytes })
          setSources((previous) => [
            ...previous,
            { id: sourceId, name: file.name, size: file.size, pageCount },
          ])
          setPages((previous) => [...previous, ...newPages])
        } catch (importError) {
          if (document) await destroyPdfDocument(document)
          failures.push(`${file.name}: ${errorMessage(importError)}`)
        }
      }
    } finally {
      importingRef.current = false
      if (mountedRef.current) {
        setImporting(false)
        setImportLabel(null)
      }
    }

    if (failures.length > 0) {
      setNotice(failures.join(' · '))
    }
  }

  function removeSource(source: SourceMeta) {
    if (importing || exporting) return
    const document = docsRef.current.get(source.id)
    docsRef.current.delete(source.id)
    sourcesRef.current.delete(source.id)
    void destroyPdfDocument(document)
    setSources((previous) => previous.filter((item) => item.id !== source.id))
    setPages((previous) => previous.filter((page) => page.sourceId !== source.id))
    setExportInfo(null)
  }

  function clearWorkspace() {
    if (importing || exporting) return
    docsRef.current.forEach((document) => void destroyPdfDocument(document))
    docsRef.current.clear()
    sourcesRef.current.clear()
    setSources([])
    setPages([])
    setNotice(null)
    setExportInfo(null)
  }

  function markUpdating(id: string, updating: boolean) {
    setUpdatingIds((previous) => {
      const next = new Set(previous)
      if (updating) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function rotatePage(id: string) {
    if (importing || exporting) return
    const target = pages.find((page) => page.id === id)
    if (!target) return

    const nextRotation = (target.rotation + 90) % 360
    setPages((previous) =>
      previous.map((page) => (page.id === id ? { ...page, rotation: nextRotation } : page)),
    )
    markUpdating(id, true)

    try {
      const document = docsRef.current.get(target.sourceId)
      if (!document) throw new Error('Sumber PDF tidak tersedia. Muat ulang file.')

      const page = await document.getPage(target.pageIndex + 1)
      const thumb = await renderPageThumbnail(
        page,
        (target.baseRotation + nextRotation) % 360,
        380,
      )
      page.cleanup()

      if (mountedRef.current) {
        setPages((previous) =>
          previous.map((item) => (item.id === id ? { ...item, thumb } : item)),
        )
      }
    } catch (rotateError) {
      if (mountedRef.current) setNotice(errorMessage(rotateError))
    } finally {
      if (mountedRef.current) markUpdating(id, false)
    }
  }

  function deletePage(id: string) {
    if (importing || exporting) return
    setPages((previous) => previous.filter((page) => page.id !== id))
    setExportInfo(null)
  }

  function movePage(id: string, direction: -1 | 1) {
    if (importing || exporting) return
    setPages((previous) => {
      const index = previous.findIndex((page) => page.id === id)
      const targetIndex = index + direction
      if (index < 0 || targetIndex < 0 || targetIndex >= previous.length) return previous
      return arrayMove(previous, index, targetIndex)
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id || importing || exporting) return

    setPages((previous) => {
      const oldIndex = previous.findIndex((page) => page.id === active.id)
      const newIndex = previous.findIndex((page) => page.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return previous
      return arrayMove(previous, oldIndex, newIndex)
    })
    setExportInfo(null)
  }

  const range = useMemo(() => {
    if (rangeMode === 'all') {
      return { indices: pages.map((_, index) => index), error: null as string | null }
    }
    return parsePageRange(rangeInput, pages.length)
  }, [pages, rangeInput, rangeMode])

  const selectedPages = range.indices
    .map((index) => pages[index])
    .filter((page): page is OrganizerPage => Boolean(page))

  async function handleExport() {
    if (exporting || importing) return
    if (selectedPages.length === 0) {
      setNotice('Pilih minimal satu halaman untuk diekspor.')
      return
    }

    setExporting(true)
    setNotice(null)
    setExportInfo(null)

    try {
      const bytes = await buildOrganizedPdf(
        sourcesRef.current,
        selectedPages.map((page) => ({
          sourceId: page.sourceId,
          pageIndex: page.pageIndex,
          rotation: page.rotation,
        })),
      )

      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
      const filename = `localkit-pdf-${compactDay(new Date())}.pdf`
      downloadBlob(blob, filename)
      setExportInfo(
        `${filename} · ${selectedPages.length} halaman · ${formatBytes(blob.size)}`,
      )
    } catch (exportError) {
      setNotice(errorMessage(exportError))
    } finally {
      if (mountedRef.current) setExporting(false)
    }
  }

  const busy = importing || exporting
  const hasContent = sources.length > 0 || pages.length > 0

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

      {!hasContent ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="panel bg-noise relative overflow-hidden p-2">
            <div className="pointer-events-none absolute inset-0 grid-lines opacity-30" />
            <div className="relative">
              <Dropzone
                multiple
                accept="application/pdf,.pdf"
                icon={Layers}
                onFiles={(files) => void handlePdfFiles(files)}
                title="Tarik satu atau beberapa PDF ke sini"
                subtitle="Halaman dari semua file digabung menjadi satu workspace"
                hint="PDF · thumbnail dirender lokal dengan pdf.js · tanpa upload"
                busy={importing}
              />
              {importLabel ? (
                <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-lg border border-accent/20 bg-ink-950/90 px-3 py-2 text-[10.5px] text-accent backdrop-blur">
                  <Loader2 size={12} className="animate-spin" />
                  <span className="truncate">{importLabel}</span>
                </div>
              ) : null}
            </div>
          </div>

          <aside className="panel space-y-4 p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/[0.08] text-accent">
                <Layers size={17} strokeWidth={1.9} />
              </span>
              <div>
                <h2 className="text-[13px] font-semibold text-white">Atur Halaman PDF</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
                  Gabungkan beberapa PDF, putar halaman, hapus, lalu susun ulang
                  urutannya secara visual sebelum diekspor.
                </p>
              </div>
            </div>

            <ol className="space-y-3">
              {[
                ['01', 'Impor & render', 'pdf.js menggambar thumbnail setiap halaman di browser.'],
                ['02', 'Susun visual', 'Drag kartu halaman, putar 90°, atau hapus halaman.'],
                ['03', 'Pisahkan & ekspor', 'Ambil semua halaman atau rentang tertentu, lalu susun ulang dengan pdf-lib.'],
              ].map(([step, title, text]) => (
                <li key={step} className="flex gap-3">
                  <span className="mt-0.5 font-mono text-[9.5px] text-accent/70">{step}</span>
                  <div>
                    <p className="text-[11px] font-medium text-ink-200">{title}</p>
                    <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-500">{text}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="flex items-center gap-2 rounded-lg border border-white/[0.055] bg-white/[0.02] px-3 py-2">
              <ShieldCheck size={12} className="text-accent/80" />
              <p className="text-[10px] text-ink-500">
                PDF tidak pernah dikirim keluar perangkat ini.
              </p>
            </div>
          </aside>
        </div>
      ) : (
        <div className="grid gap-5 min-[1200px]:grid-cols-[minmax(0,1fr)_350px]">
          <div className="min-w-0 space-y-4">
            <section className="panel px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="eyebrow pl-1">Sumber</span>
                {sources.map((source) => (
                  <span
                    key={source.id}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.025] py-1 pr-1 pl-2 text-[10px] text-ink-300"
                  >
                    <FileText size={10} className="shrink-0 text-accent/70" />
                    <span className="max-w-[150px] truncate">{source.name}</span>
                    <span className="shrink-0 font-mono text-[9px] text-ink-500">
                      {source.pageCount} hal
                    </span>
                    <button
                      type="button"
                      className="rounded p-0.5 text-ink-500 transition hover:bg-white/10 hover:text-danger"
                      onClick={() => removeSource(source)}
                      disabled={busy}
                      aria-label={`Hapus sumber ${source.name}`}
                    >
                      <X size={9} />
                    </button>
                  </span>
                ))}

                <button
                  type="button"
                  className="chip ml-auto"
                  onClick={() => addInputRef.current?.click()}
                  disabled={busy}
                >
                  <Plus size={11} />
                  Tambah PDF
                </button>
                <button
                  type="button"
                  className="btn-quiet !px-2 !py-1.5 !text-[10px]"
                  onClick={clearWorkspace}
                  disabled={busy}
                >
                  <Trash2 size={11} />
                  Bersihkan
                </button>
              </div>

              {importing && importLabel ? (
                <div className="mt-2 flex items-center gap-2 border-t border-white/[0.05] pt-2 text-[10px] text-accent">
                  <Loader2 size={11} className="animate-spin" />
                  <span className="truncate">{importLabel}</span>
                </div>
              ) : null}
            </section>

            <section className="panel overflow-hidden">
              <header className="flex items-center justify-between gap-3 border-b border-white/[0.055] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Layers size={14} className="text-accent" />
                  <h2 className="text-[12.5px] font-semibold text-white">Halaman</h2>
                  <span className="value-badge">{pages.length}</span>
                </div>
                <span className="hidden text-[10px] text-ink-500 sm:inline">
                  Drag handle untuk mengubah urutan
                </span>
              </header>

              <div className="p-3 sm:p-4">
                {pages.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-white/[0.1] px-4 py-12 text-center">
                    <Layers size={22} className="text-ink-600" />
                    <p className="text-[12px] text-ink-300">Semua halaman sudah dihapus.</p>
                    <button
                      type="button"
                      className="btn-ghost !py-2 !text-[11px]"
                      onClick={() => addInputRef.current?.click()}
                      disabled={busy}
                    >
                      <FilePlus2 size={12} />
                      Tambah PDF lain
                    </button>
                  </div>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={pages.map((page) => page.id)}
                      strategy={rectSortingStrategy}
                    >
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                        {pages.map((page, index) => (
                          <PageCard
                            key={page.id}
                            page={page}
                            index={index}
                            total={pages.length}
                            disabled={busy}
                            updating={updatingIds.has(page.id)}
                            onRotate={(id) => void rotatePage(id)}
                            onDelete={deletePage}
                            onMove={movePage}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </div>

              <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.055] px-4 py-2.5 text-[10px] text-ink-500">
                <span className="inline-flex items-center gap-1.5">
                  <Scissors size={10} className="text-accent/60" />
                  Split dengan memilih range saat ekspor
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 size={10} className="text-accent/60" />
                  Rotasi & urutan diterapkan ke PDF hasil
                </span>
              </footer>
            </section>
          </div>

          <aside className="min-w-0 space-y-4">
            <section className="panel space-y-3.5 p-4 min-[1200px]:sticky min-[1200px]:top-5">
              <div className="flex items-center gap-2">
                <Download size={14} className="text-accent" />
                <h2 className="text-[12.5px] font-semibold text-white">Export PDF</h2>
              </div>

              <div className="space-y-1">
                <p className="font-mono text-[10px] text-ink-500">HALAMAN DIEKSPOR</p>
                <p className="font-mono text-[20px] leading-none text-white">
                  {range.error ? '—' : selectedPages.length}
                  <span className="text-[10px] text-ink-500"> / {pages.length}</span>
                </p>
              </div>

              <Segmented
                compact
                value={rangeMode}
                onChange={setRangeMode}
                options={[
                  { value: 'all', label: 'Semua halaman', hint: 'Gabung & susun ulang' },
                  { value: 'range', label: 'Rentang halaman', hint: 'Pisahkan sebagian' },
                ]}
              />

              {rangeMode === 'range' ? (
                <div className="space-y-1.5">
                  <label htmlFor="pdf-page-range" className="field-label">
                    Range halaman
                  </label>
                  <input
                    id="pdf-page-range"
                    className="input !py-2 font-mono !text-[12px]"
                    value={rangeInput}
                    placeholder="1-3,5"
                    spellCheck={false}
                    onChange={(event) => setRangeInput(event.target.value)}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn('text-[9.5px]', range.error ? 'text-danger' : 'text-ink-500')}>
                      {range.error ?? `${selectedPages.length} halaman dipilih`}
                    </p>
                    <button
                      type="button"
                      className="text-[9.5px] text-accent/80 hover:text-accent"
                      onClick={() => setRangeInput(`1-${Math.min(3, pages.length)}`)}
                    >
                      1–3
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-[10px] leading-relaxed text-ink-500">
                  Semua halaman diekspor sesuai urutan dan rotasi di workspace.
                </p>
              )}

              <button
                type="button"
                className="btn-primary w-full !py-3"
                onClick={() => void handleExport()}
                disabled={busy || Boolean(range.error) || selectedPages.length === 0}
              >
                {exporting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Menyusun PDF…
                  </>
                ) : (
                  <>
                    <Download size={14} />
                    Export PDF
                  </>
                )}
              </button>

              {exportInfo ? (
                <p className="flex items-start gap-1.5 text-[10px] leading-relaxed break-all text-accent/90">
                  <CheckCircle2 size={11} className="mt-px shrink-0" />
                  {exportInfo}
                </p>
              ) : (
                <p className="text-center text-[9.5px] text-ink-500">
                  PDF disusun ulang di browser dengan pdf-lib.
                </p>
              )}

              <div className="divider" />

              <div className="space-y-2 text-[9.5px] text-ink-500">
                <p className="flex items-center gap-1.5">
                  <ShieldCheck size={10} className="text-accent/60" />
                  Tanpa upload · tanpa server
                </p>
                <p className="flex items-center gap-1.5">
                  <FileText size={10} className="text-accent/60" />
                  {sources.length} sumber · {formatBytes(
                    sources.reduce((total, source) => total + source.size, 0),
                  )}
                </p>
              </div>
            </section>

            <section className="panel p-4">
              <p className="eyebrow">Tips memisahkan halaman</p>
              <p className="mt-2 text-[10.5px] leading-relaxed text-ink-500">
                Urutkan halaman terlebih dahulu, lalu pilih range. Nomor range
                mengikuti urutan visual saat ini — bukan nomor halaman asli.
              </p>
            </section>
          </aside>
        </div>
      )}

      <input
        ref={addInputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length > 0) void handlePdfFiles(files)
        }}
      />
    </div>
  )
}
