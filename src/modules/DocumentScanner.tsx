import React, { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Lock,
  RotateCcw,
} from 'lucide-react'
import { SourceSelector } from '../components/SourceSelector'
import { SliderField } from '../components/Controls'
import {
  adjustImage,
  cropToCorners,
  loadImageToCanvas,
  type EdgePoints,
  type ScannerControls,
} from '../lib/documentScanner'
import { downloadBlob, sanitizeBaseName } from '../lib/format'

interface ScanState {
  original?: HTMLCanvasElement
  processed?: HTMLCanvasElement
  dataUrl?: string
  filename?: string
  corners?: EdgePoints
  controls: ScannerControls
  mode: 'select' | 'adjust' | 'preview'
  error?: string
}

const DEFAULT_CONTROLS: ScannerControls = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
}

function autoDetectCorners(canvas: HTMLCanvasElement): EdgePoints {
  const margin = Math.min(canvas.width, canvas.height) * 0.05

  return {
    topLeft: [margin, margin],
    topRight: [canvas.width - margin, margin],
    bottomLeft: [margin, canvas.height - margin],
    bottomRight: [canvas.width - margin, canvas.height - margin],
  }
}

function CanvasPreview({
  canvas,
  corners,
  width,
  height,
  onCornerChange,
}: {
  canvas: HTMLCanvasElement
  corners: EdgePoints
  width: number
  height: number
  onCornerChange: (corners: EdgePoints) => void
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const dragCornerRef = React.useRef<string | undefined>(undefined)
  const scaleX = width / canvas.width
  const scaleY = height / canvas.height

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragCornerRef.current || !e.buttons) return
      if (!containerRef.current) return

      const rect = containerRef.current.getBoundingClientRect()
      const x = Math.max(0, Math.min(width, e.clientX - rect.left)) / scaleX
      const y = Math.max(0, Math.min(height, e.clientY - rect.top)) / scaleY

      onCornerChange({
        ...corners,
        [dragCornerRef.current]: [x, y],
      })
    }

    const handleMouseUp = () => {
      dragCornerRef.current = undefined
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [corners, onCornerChange, scaleX, scaleY, width, height])

  return (
    <div
      ref={containerRef}
      className="relative inline-block overflow-hidden rounded-lg border border-white/10 bg-ink-900"
      style={{ width, height }}
    >
      <canvas
        width={canvas.width}
        height={canvas.height}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        }}
        ref={(el) => {
          if (el && canvas) {
            const ctx = el.getContext('2d')
            if (ctx) ctx.drawImage(canvas, 0, 0)
          }
        }}
      />

      {Object.entries(corners).map(([key, pos]) => (
        <div
          key={key}
          onMouseDown={() => {
            dragCornerRef.current = key
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing"
          style={{
            left: `${pos[0]}px`,
            top: `${pos[1]}px`,
          }}
        >
          <div className="flex items-center gap-2">
            <div className="size-5 rounded-full border-2 border-accent bg-accent/20 shadow-lg" />
            <span className="text-[8px] font-bold text-accent">{key.slice(0, 3)}</span>
          </div>
        </div>
      ))}

      <svg
        className="absolute inset-0"
        style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        <line
          x1={`${(corners.topLeft[0] / canvas.width) * 100}%`}
          y1={`${(corners.topLeft[1] / canvas.height) * 100}%`}
          x2={`${(corners.topRight[0] / canvas.width) * 100}%`}
          y2={`${(corners.topRight[1] / canvas.height) * 100}%`}
          stroke="rgb(94, 234, 212)"
          strokeWidth="2"
          opacity="0.5"
        />
        <line
          x1={`${(corners.topRight[0] / canvas.width) * 100}%`}
          y1={`${(corners.topRight[1] / canvas.height) * 100}%`}
          x2={`${(corners.bottomRight[0] / canvas.width) * 100}%`}
          y2={`${(corners.bottomRight[1] / canvas.height) * 100}%`}
          stroke="rgb(94, 234, 212)"
          strokeWidth="2"
          opacity="0.5"
        />
        <line
          x1={`${(corners.bottomRight[0] / canvas.width) * 100}%`}
          y1={`${(corners.bottomRight[1] / canvas.height) * 100}%`}
          x2={`${(corners.bottomLeft[0] / canvas.width) * 100}%`}
          y2={`${(corners.bottomLeft[1] / canvas.height) * 100}%`}
          stroke="rgb(94, 234, 212)"
          strokeWidth="2"
          opacity="0.5"
        />
        <line
          x1={`${(corners.bottomLeft[0] / canvas.width) * 100}%`}
          y1={`${(corners.bottomLeft[1] / canvas.height) * 100}%`}
          x2={`${(corners.topLeft[0] / canvas.width) * 100}%`}
          y2={`${(corners.topLeft[1] / canvas.height) * 100}%`}
          stroke="rgb(94, 234, 212)"
          strokeWidth="2"
          opacity="0.5"
        />
      </svg>
    </div>
  )
}

function ControlsPanel({
  controls,
  onControlChange,
  onReset,
}: {
  controls: ScannerControls
  onControlChange: (controls: ScannerControls) => void
  onReset: () => void
}) {
  return (
    <div className="space-y-4 rounded-lg border border-white/10 bg-ink-900/50 p-4">
      <h3 className="text-sm font-semibold text-ink-100">Penyesuaian Dokumen</h3>

      <div className="space-y-3">
        <SliderField
          label="Brightness"
          value={controls.brightness}
          min={-100}
          max={100}
          step={5}
          display={`${controls.brightness}%`}
          onChange={(brightness: number) =>
            onControlChange({ ...controls, brightness })
          }
        />

        <SliderField
          label="Contrast"
          value={controls.contrast}
          min={-100}
          max={100}
          step={5}
          display={`${controls.contrast}%`}
          onChange={(contrast: number) =>
            onControlChange({ ...controls, contrast })
          }
        />

        <SliderField
          label="Saturation"
          value={controls.saturation}
          min={-100}
          max={100}
          step={5}
          display={`${controls.saturation}%`}
          onChange={(saturation: number) =>
            onControlChange({ ...controls, saturation })
          }
        />
      </div>

      <button
        type="button"
        onClick={onReset}
        className="w-full flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-xs font-semibold text-ink-100 hover:bg-ink-700"
      >
        <RotateCcw size={12} />
        Reset Controls
      </button>
    </div>
  )
}

export function DocumentScanner() {
  const [state, setState] = useState<ScanState>({
    controls: DEFAULT_CONTROLS,
    mode: 'select',
  })

  const handleSourceSelected = async (source: File | HTMLCanvasElement) => {
    try {
      const canvas =
        source instanceof File ? await loadImageToCanvas(source) : source

      const corners = autoDetectCorners(canvas)
      const filename =
        source instanceof File ? source.name : 'camera-capture.jpg'

      setState((prev) => ({
        ...prev,
        original: canvas,
        corners,
        filename,
        mode: 'adjust',
        error: undefined,
      }))
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to load image',
      }))
    }
  }

  const handleControlChange = (controls: ScannerControls) => {
    if (!state.original) return

    setState((prev) => ({
      ...prev,
      controls,
    }))

    const canvas = state.original.cloneNode() as HTMLCanvasElement
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(state.original, 0, 0)
      const adjusted = adjustImage(canvas, controls)
      setState((prev) => ({
        ...prev,
        processed: adjusted,
        dataUrl: adjusted.toDataURL('image/png'),
      }))
    }
  }

  const handleCornerChange = (corners: EdgePoints) => {
    setState((prev) => ({
      ...prev,
      corners,
    }))
  }

  const handleReset = () => {
    setState((prev) => ({
      ...prev,
      controls: DEFAULT_CONTROLS,
    }))
  }

  const handleApplyCrop = () => {
    if (!state.original || !state.corners) return

    try {
      const cropped = cropToCorners(state.original, state.corners)
      const adjusted = adjustImage(
        cropped.cloneNode() as HTMLCanvasElement,
        state.controls
      )

      setState((prev) => ({
        ...prev,
        processed: adjusted,
        dataUrl: adjusted.toDataURL('image/png'),
        mode: 'preview',
      }))
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to process document',
      }))
    }
  }

  const handleDownload = () => {
    if (!state.dataUrl || !state.filename) return

    const basename = sanitizeBaseName(state.filename)
    const blob = new Blob(
      [
        Uint8Array.from(
          atob(state.dataUrl.split(',')[1] || ''),
          (c) => c.charCodeAt(0)
        ),
      ],
      { type: 'image/png' }
    )
    downloadBlob(blob, `${basename.split('.')[0]}-scanned.png`)
  }

  const handleScanNew = () => {
    setState({
      controls: DEFAULT_CONTROLS,
      mode: 'select',
    })
  }

  if (state.mode === 'select') {
    return (
      <div className="panel space-y-6">
        <SourceSelector
          onUpload={(files: File[]) => {
            if (files[0]) handleSourceSelected(files[0])
          }}
          onCameraCapture={handleSourceSelected}
          accept="image/jpeg,image/png,image/webp,image/heic"
        />

        <div className="space-y-2 rounded-lg border border-white/10 bg-ink-900/30 p-4 text-[12px] text-ink-400">
          <p className="font-semibold text-ink-200">Alur Scanner:</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>Ambil foto atau unggah dokumen</li>
            <li>Sesuaikan sudut empat pojok dokumen</li>
            <li>Atur brightness, contrast, saturation</li>
            <li>Download dokumen terkoreksi sebagai PNG</li>
            <li>Semua pemrosesan offline di perangkat Anda</li>
          </ul>
        </div>

        {state.error && (
          <div className="flex items-start gap-3 rounded-lg border border-warn/25 bg-warn/[0.06] p-4">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
            <p className="text-sm text-warn">{state.error}</p>
          </div>
        )}
      </div>
    )
  }

  if (state.mode === 'adjust' || state.mode === 'preview') {
    const displayCanvas =
      state.mode === 'preview' && state.processed
        ? state.processed
        : state.original

    return (
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-lg border border-white/10 bg-ink-900/30 p-4">
              <p className="mb-3 text-xs font-semibold text-ink-400">
                PREVIEW DOKUMEN
              </p>
              {displayCanvas && state.corners && (
                <CanvasPreview
                  canvas={displayCanvas}
                  corners={state.corners}
                  width={Math.min(500, window.innerWidth - 40)}
                  height={400}
                  onCornerChange={handleCornerChange}
                />
              )}
            </div>

            {state.mode === 'adjust' && (
              <button
                type="button"
                onClick={handleApplyCrop}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent-strong px-4 py-3 text-sm font-semibold text-ink-950 hover:from-accent-bright hover:to-accent transition"
              >
                <CheckCircle2 size={16} />
                Terapkan Koreksi
              </button>
            )}
          </div>

          <div className="space-y-4">
            {state.mode === 'adjust' && (
              <ControlsPanel
                controls={state.controls}
                onControlChange={handleControlChange}
                onReset={handleReset}
              />
            )}

            {state.mode === 'preview' && (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleDownload}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent-strong px-4 py-3 text-sm font-semibold text-ink-950 hover:from-accent-bright hover:to-accent transition"
                >
                  <Download size={16} />
                  Download PNG
                </button>

                <button
                  type="button"
                  onClick={handleScanNew}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-ink-800 px-4 py-3 text-sm font-semibold text-ink-100 hover:bg-ink-700 transition"
                >
                  <RotateCcw size={16} />
                  Scan Dokumen Lain
                </button>
              </div>
            )}

            <div className="space-y-2 rounded-lg border border-white/10 bg-ink-900/30 p-3 text-[11px] text-ink-400">
              <p className="font-semibold text-ink-200">Tips:</p>
              <ul className="space-y-1">
                <li>• Gunakan pencahayaan yang terang</li>
                <li>• Posisikan dokumen lurus ke kamera</li>
                <li>• Sesuaikan pojok jika perlu koreksi perspektif</li>
              </ul>
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-accent/25 bg-accent/[0.06] px-3 py-2 text-[11px] text-accent">
              <Lock size={11} />
              Pemrosesan lokal · Tidak ada upload
            </div>
          </div>
        </div>

        {state.error && (
          <div className="flex items-start gap-3 rounded-lg border border-warn/25 bg-warn/[0.06] p-4">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
            <p className="text-sm text-warn">{state.error}</p>
          </div>
        )}
      </div>
    )
  }
}
