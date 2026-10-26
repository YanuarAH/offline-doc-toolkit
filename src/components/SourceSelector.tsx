import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  Loader2,
  Upload,
  X,
} from 'lucide-react'

interface SourceSelectorProps {
  onUpload: (files: File[]) => void
  onCameraCapture: (canvas: HTMLCanvasElement) => void
  accept?: string
  multiple?: boolean
  cameraError?: string
}

export function SourceSelector({
  onUpload,
  onCameraCapture,
  accept = 'image/*',
  multiple = false,
  cameraError,
}: SourceSelectorProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'idle' | 'camera'>('idle')
  const [cameraReady, setCameraReady] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (mode !== 'camera') return

    const videoElement = videoRef.current

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1440 },
          },
          audio: false,
        })

        if (videoElement) {
          videoElement.srcObject = stream
          videoElement.onloadedmetadata = () => {
            videoElement?.play()
            setCameraReady(true)
            setError(undefined)
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to access camera'
        setError(errorMsg)
        console.error('Camera error:', err)
      }
    }

    startCamera()

    return () => {
      if (videoElement && videoElement.srcObject) {
        const stream = videoElement.srcObject as MediaStream
        stream.getTracks().forEach((track) => track.stop())
      }
      setCameraReady(false)
    }
  }, [mode])

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    ctx.drawImage(video, 0, 0)

    if (video.srcObject) {
      const stream = video.srcObject as MediaStream
      stream.getTracks().forEach((track) => track.stop())
    }

    onCameraCapture(canvas)
  }

  const handleFilesSelected = (files: File[]) => {
    onUpload(multiple ? files : files.slice(0, 1))
  }

  if (mode === 'idle') {
    return (
      <div className="space-y-3 rounded-lg border border-white/10 bg-ink-900/30 p-4">
        <p className="text-xs font-semibold text-ink-400 mb-3">PILIH SUMBER</p>
        <div className="grid gap-3 grid-cols-2">
          <button
            type="button"
            onClick={() => setMode('camera')}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border border-white/10 bg-ink-800 px-3 py-4 text-xs font-semibold text-ink-100 hover:bg-ink-700 hover:border-accent/30 transition"
          >
            <Camera size={18} className="text-accent" />
            Ambil Foto
          </button>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border border-white/10 bg-ink-800 px-3 py-4 text-xs font-semibold text-ink-100 hover:bg-ink-700 hover:border-accent/30 transition"
          >
            <Upload size={18} className="text-accent" />
            Unggah File
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            if (files.length > 0) handleFilesSelected(files)
          }}
        />

        {cameraError && (
          <div className="flex items-start gap-2 rounded-lg border border-warn/25 bg-warn/[0.06] p-3 text-xs">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
            <span className="text-warn">{cameraError}</span>
          </div>
        )}
      </div>
    )
  }

  if (mode === 'camera') {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-white/10 bg-ink-900 overflow-hidden aspect-video flex items-center justify-center">
          {error ? (
            <div className="flex flex-col items-center gap-2 text-center p-4">
              <AlertTriangle size={32} className="text-warn" />
              <p className="text-sm text-warn">{error}</p>
              <p className="text-xs text-ink-400">Izinkan akses kamera di pengaturan browser</p>
            </div>
          ) : !cameraReady ? (
            <div className="flex items-center gap-2 text-ink-400">
              <Loader2 size={18} className="animate-spin text-accent" />
              <span className="text-sm">Memulai kamera…</span>
            </div>
          ) : (
            <video
              ref={videoRef}
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setMode('idle')}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-ink-800 px-4 py-2 text-xs font-semibold text-ink-100 hover:bg-ink-700 transition"
          >
            <X size={14} />
            Batal
          </button>
          <button
            type="button"
            onClick={handleCapture}
            disabled={!cameraReady}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-accent-strong px-4 py-2 text-xs font-semibold text-ink-950 hover:from-accent-bright hover:to-accent transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Camera size={14} />
            Ambil Foto
          </button>
        </div>
      </div>
    )
  }

  return null
}
