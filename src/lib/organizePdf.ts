import { PDFDocument, degrees } from 'pdf-lib'

export interface OrganizePageInput {
  sourceId: string
  pageIndex: number
  /** Additional clockwise rotation chosen by the user. */
  rotation: number
}

export interface OrganizeSourceInput {
  name: string
  bytes: Uint8Array
}

export async function buildOrganizedPdf(
  sources: Map<string, OrganizeSourceInput>,
  pages: OrganizePageInput[],
): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error('Belum ada halaman untuk diekspor.')

  const output = await PDFDocument.create()
  const loaded = new Map<string, PDFDocument>()

  try {
    for (const [sourceId, source] of sources) {
      if (!pages.some((page) => page.sourceId === sourceId)) continue
      try {
        loaded.set(sourceId, await PDFDocument.load(source.bytes))
      } catch {
        throw new Error(
          `Gagal membaca "${source.name}". Pastikan file PDF valid dan tidak terkunci password.`,
        )
      }
    }

    for (const page of pages) {
      const sourceDocument = loaded.get(page.sourceId)
      if (!sourceDocument) continue

      const [copiedPage] = await output.copyPages(sourceDocument, [page.pageIndex])
      const baseRotation = copiedPage.getRotation().angle
      const finalRotation = (((baseRotation + page.rotation) % 360) + 360) % 360
      copiedPage.setRotation(degrees(finalRotation))
      output.addPage(copiedPage)
    }

    if (output.getPageCount() === 0) throw new Error('Tidak ada halaman valid untuk diekspor.')

    output.setTitle('LocalKit — Organized PDF')
    output.setSubject('Disusun ulang secara lokal dengan LocalKit')
    output.setCreator('LocalKit (client-side)')
    output.setProducer('LocalKit · pdf-lib')

    return await output.save()
  } finally {
    loaded.clear()
  }
}
