export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, exponent)
  const digits = exponent === 0 ? 0 : decimals
  return `${value.toFixed(digits)} ${units[exponent]}`
}

export function savingsPercent(before: number, after: number): number {
  if (before <= 0) return 0
  return ((before - after) / before) * 100
}

export function formatDateID(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

export function isoDay(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function compactDay(date: Date): string {
  return isoDay(date).replaceAll('-', '')
}

export function sanitizeBaseName(name: string): string {
  const withoutExtension = name.replace(/\.[^.]+$/, '')
  const safe = withoutExtension
    .normalize('NFKD')
    .replace(/[^\w\-. ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80)
  return safe.length > 0 ? safe : 'file'
}

/**
 * Single place for browser downloads. The object URL is always revoked once the
 * browser has had time to start the download — no blob URLs are left dangling.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Terjadi kesalahan yang tidak diketahui.'
}
