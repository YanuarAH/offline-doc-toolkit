export interface PageRangeResult {
  indices: number[]
  error: string | null
}

/**
 * Parse human-friendly page ranges: "1-3", "1,3,5-7".
 * Returns zero-based indices sorted ascending. Used for split/extract exports.
 */
export function parsePageRange(input: string, totalPages: number): PageRangeResult {
  const value = input.trim()
  if (!value) return { indices: [], error: 'Masukkan range halaman, mis. 1-3.' }
  if (totalPages <= 0) return { indices: [], error: 'Belum ada halaman di workspace.' }

  const selected = new Set<number>()

  for (const rawToken of value.split(',')) {
    const token = rawToken.trim()
    if (!token) continue

    const rangeMatch = /^(\d+)\s*[-–]\s*(\d+)$/.exec(token)
    if (rangeMatch) {
      let start = Number(rangeMatch[1])
      let end = Number(rangeMatch[2])
      if (start > end) [start, end] = [end, start]

      if (start < 1 || end > totalPages) {
        return {
          indices: [],
          error: `Range ${token} di luar batas. Halaman tersedia 1–${totalPages}.`,
        }
      }

      for (let page = start; page <= end; page += 1) selected.add(page - 1)
      continue
    }

    if (/^\d+$/.test(token)) {
      const page = Number(token)
      if (page < 1 || page > totalPages) {
        return {
          indices: [],
          error: `Halaman ${page} tidak ada. Halaman tersedia 1–${totalPages}.`,
        }
      }
      selected.add(page - 1)
      continue
    }

    return {
      indices: [],
      error: `Format "${token}" tidak dikenal. Gunakan contoh 1-3 atau 1,3,5.`,
    }
  }

  if (selected.size === 0) return { indices: [], error: 'Tidak ada halaman yang dipilih.' }

  return {
    indices: [...selected].sort((a, b) => a - b),
    error: null,
  }
}
