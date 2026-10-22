import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, Eraser, PenLine } from 'lucide-react'
import { cn } from '../lib/format'

export interface AppliedSignature {
  dataUrl: string
  width: number
  height: number
  name: string
}

interface SignaturePadProps {
  disabled?: boolean
  onApply: (signature: AppliedSignature) => void
}

const CANVAS_WIDTH = 800
const CANVAS_HEIGHT = 400
const BRUSH_SIZE = 5.5
const INK_COLORS = {
  black: { label: 'Hitam', value: '#111827' },
  blue: { label: 'Biru gelap', value: '#1e3a8a' },
} as const
type InkColor = keyof typeof INK_COLORS

interface Point {
  x: number
  y: number
}

function trimTransparentCanvas(canvas: HTMLCanvasElement): {
  dataUrl: string
  width: number
  height: number
} {
  const context = canvas.getContext('2d')
  if (!context) {
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    }
  }

  try {
    const { width, height } = canvas
    const pixels = context.getImageData(0, 0, width, height).data
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        // Alpha > 8 ignores near-transparent anti-aliasing fringe.
        if (pixels[(y * width + x) * 4 + 3] > 8) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      return { dataUrl: canvas.toDataURL('image/png'), width, height }
    }

    const padding = 16
    const sx = Math.max(0, minX - padding)
    const sy = Math.max(0, minY - padding)
    const sw = Math.min(width - sx, maxX - minX + 1 + padding * 2)
    const sh = Math.min(height - sy, maxY - minY + 1 + padding * 2)

    const cropped = document.createElement('canvas')
    cropped.width = sw
    cropped.height = sh
    const croppedContext = cropped.getContext('2d')
    if (!croppedContext) {
      return { dataUrl: canvas.toDataURL('image/png'), width, height }
    }

    croppedContext.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)
    return {
      dataUrl: cropped.toDataURL('image/png'),
      width: sw,
      height: sh,
    }
  } catch {
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    }
  }
}

export function SignaturePad({ disabled = false, onApply }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<Point | null>(null)
  const [ink, setInk] = useState<InkColor>('black')
  const [hasInk, setHasInk] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.imageSmoothingEnabled = true
    context.clearRect(0, 0, canvas.width, canvas.height)
  }, [])

  function pointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * event.currentTarget.width,
      y: ((event.clientY - rect.top) / rect.height) * event.currentTarget.height,
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)

    const point = pointFromEvent(event)
    const context = event.currentTarget.getContext('2d')
    if (!context) return

    drawingRef.current = true
    lastPointRef.current = point
    setHasInk(true)

    context.fillStyle = INK_COLORS[ink].value
    context.beginPath()
    context.arc(point.x, point.y, BRUSH_SIZE / 2, 0, Math.PI * 2)
    context.fill()
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || disabled) return

    event.preventDefault()
    const point = pointFromEvent(event)
    const previous = lastPointRef.current
    const context = event.currentTarget.getContext('2d')
    if (!context || !previous) return

    context.strokeStyle = INK_COLORS[ink].value
    context.lineWidth = BRUSH_SIZE
    context.beginPath()
    context.moveTo(previous.x, previous.y)
    context.lineTo(point.x, point.y)
    context.stroke()
    lastPointRef.current = point
  }

  function finishStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false
    lastPointRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function clearPad() {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    drawingRef.current = false
    lastPointRef.current = null
    context.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
  }

  function applySignature() {
    const canvas = canvasRef.current
    if (!canvas || !hasInk || disabled) return

    const cropped = trimTransparentCanvas(canvas)
    onApply({
      ...cropped,
      name: `tanda-tangan-${Date.now()}.png`,
    })
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/[0.18] bg-white p-2 shadow-[inset_0_1px_0_rgba(255,255,255,.7)]">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          aria-label="Area gambar tanda tangan"
          className={cn(
            'block aspect-[2/1] w-full touch-none rounded-md bg-white',
            disabled ? 'cursor-not-allowed opacity-60' : 'cursor-crosshair',
          )}
          style={{ touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          onLostPointerCapture={finishStroke}
          onContextMenu={(event) => event.preventDefault()}
        />
      </div>

      <p className="flex items-center gap-1.5 text-[9.5px] leading-relaxed text-ink-500">
        <PenLine size={10} className="shrink-0 text-accent/70" />
        Coret dengan mouse atau jari. Area putih transparan saat diterapkan ke PDF.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="btn-quiet !px-2.5 !py-1.5 !text-[10px]"
          onClick={clearPad}
          disabled={disabled || !hasInk}
        >
          <Eraser size={11} />
          Hapus / Clear
        </button>

        <div className="flex items-center gap-1.5" role="group" aria-label="Warna tinta">
          {(Object.keys(INK_COLORS) as InkColor[]).map((color) => {
            const active = ink === color
            return (
              <button
                key={color}
                type="button"
                aria-pressed={active}
                aria-label={`Tinta ${INK_COLORS[color].label}`}
                title={INK_COLORS[color].label}
                disabled={disabled}
                onClick={() => setInk(color)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[9.5px] transition',
                  active
                    ? 'border-accent/40 bg-accent/[0.08] text-ink-100'
                    : 'border-white/[0.08] bg-white/[0.02] text-ink-400 hover:border-white/[0.15]',
                )}
              >
                <span
                  className="size-2.5 rounded-full ring-1 ring-white/20"
                  style={{ backgroundColor: INK_COLORS[color].value }}
                />
                {INK_COLORS[color].label}
              </button>
            )
          })}
        </div>
      </div>

      <button
        type="button"
        className="btn-primary w-full !py-2.5"
        onClick={applySignature}
        disabled={disabled || !hasInk}
      >
        <Check size={13} />
        Terapkan Tanda Tangan ke PDF
      </button>
    </div>
  )
}
