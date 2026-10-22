# LocalKit — Local-First Document & Image Toolkit

Swiss army knife untuk dokumen dan gambar yang berjalan **100% di browser**.
Tidak ada backend, tidak ada upload, tidak ada telemetry. File sensitif seperti
foto KTP dan PDF bertanda tangan tetap berada di memori perangkat Anda.

## Modul

| Modul | Status | Keterangan |
| --- | --- | --- |
| **KTP & ID Card Watermarker** | ✅ | Watermark tiled / single stamp, unduh PNG/JPG resolusi asli |
| **Batch Image Compressor** | ✅ | WebP/JPEG/PNG, target KB dengan binary search + auto-downscale, ZIP |
| **PDF Studio** | ✅ | Organizer + compressor Ghostscript WASM 3 level (72/150/300 DPI) |
| **Image-to-PDF & Signature Stamper** | ✅ | Gambar → PDF A4/F4/Fit, stempel tanda tangan rotation-aware |

## Tech stack

- **Vite + React 19 + TypeScript** — tanpa SSR/Next.js agar Canvas, Worker, dan
  `pdfjs-dist` tidak bentrok dengan server rendering.
- **Tailwind CSS v4** + **Lucide React** — dark UI, aksen mint, tanpa font/CDN eksternal.
- **pdfjs-dist 6** — render thumbnail & preview halaman sepenuhnya lokal.
- **pdf-lib** — menyusun ulang halaman, konversi gambar, dan menanam tanda tangan.
- **@dnd-kit/core + sortable** — drag-and-drop urutan halaman/gambar.
- **@jspawn/ghostscript-wasm** — mesin `pdfwrite` asli untuk kompresi PDF 3 level,
  dimuat on-demand dan berjalan di MEMFS browser. Lisensi Ghostscript: AGPL-3.0
  (file LICENSE disalin ke `public/wasm/`).
- **JSZip** — unduhan batch `.zip` pada Modul 2.
- **vite-plugin-pwa** (Workbox) — service worker, manifest, installable, offline.

## Menjalankan

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build ke dist/
npm run preview  # cek hasil build
npm run lint     # oxlint src
```

## PDF.js offline (tanpa CDN)

Worker diimpor sebagai aset Vite, bukan URL eksternal:

```ts
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
```

Aset pendukung juga disajikan dari origin sendiri di `public/pdfjs/`
(`cmaps`, `standard_fonts`, `wasm`, `iccs`) dan dikonfigurasi lewat
`getDocument({ cMapUrl, standardFontDataUrl, wasmUrl, iccUrl })`. Semuanya masuk
precache Workbox, jadi PDF tetap bisa dibuka dan dirender saat internet mati.

Render memakai `intent: 'print'` agar pdf.js memakai microtask, bukan
`requestAnimationFrame`. Ini membuat thumbnail tetap selesai dirender ketika tab
berada di background atau lingkungan headless.

## Detail Modul 3 — PDF Studio

### Organizer

- Upload satu atau banyak PDF; halaman dari semua file masuk ke satu workspace.
- Setiap halaman dirender menjadi thumbnail 380px di canvas (latar putih).
- Kartu halaman mendukung:
  - **drag handle** untuk reorder (mouse & keyboard sensor),
  - tombol **pindah kiri/kanan** untuk aksesibilitas,
  - **rotate 90°** (thumbnail dirender ulang),
  - **hapus halaman**.
- **Split / extract range**: pilih `1-3`, `1,3,5-7`, dst. Nomor mengacu pada
  urutan visual saat ini. Ekspor hanya halaman terpilih.
- Ekspor memakai `PDFDocument.create()` + `copyPages()`, menerapkan rotasi
  (`base + user`) dan metadata dokumen, lalu mengunduh PDF baru.
- Semua sumber PDF asli disimpan sebagai bytes di memori dan dihancurkan saat
  modul ditutup (`PDFDocumentLoadingTask.destroy()`).

### Compressor — Ghostscript WASM

- **Bukan rasterizer canvas.** Mesin `pdfwrite` Ghostscript di-compile ke WASM;
  teks, vektor, font, dan struktur PDF tetap dipertahankan. Hanya gambar yang
  di-resample/di-reencode sesuai level.
- Aset `gs.js` (±105 KB) dan `gs.wasm` (±16 MB) disalin otomatis ke
  `public/wasm/` oleh `scripts/copy-ghostscript.mjs` lewat lifecycle
  `postinstall`, `predev`, dan `prebuild`.
- Mesin dimuat **lazy** hanya saat tombol Kompres PDF pertama kali ditekan.
  Status “Memuat Mesin Ghostscript WASM...” ditampilkan selama inisialisasi.
- Tiga level, persis seperti iLovePDF:
  - **Extreme Compression** — `/screen` + color/gray/mono 72 DPI.
  - **Recommended Compression** — `/ebook` + color/gray 150 DPI.
  - **Less Compression** — `/printer` (300 DPI).
- Argumen dieksekusi di MEMFS dengan `input.pdf` → `output.pdf`, lalu file
  sementara dihapus di blok `finally`.
- **Size guard**: jika output Ghostscript ≥ input, file asli dikembalikan dan UI
  menampilkan “PDF ini sudah berada pada ukuran paling optimal (teks/vektor
  murni).” Penghematan 0% dan tombol unduh memakai file asli.
- Perbandingan Before/After, persentase penghematan, level/DPI, dan durasi
  proses ditampilkan setelah kompresi.

## Detail Modul 4 — Images to PDF & Signature Stamper

### Images to PDF

- Upload banyak gambar, atur urutan dengan drag-and-drop atau tombol panah.
- Ukuran kertas: **A4** (210×297 mm), **F4** (210×330 mm), atau **Fit-to-Image**.
- Orientasi portrait/landscape untuk A4/F4; Fit mengikuti rasio tiap gambar.
- Margin 0–40 mm, dihitung dalam point PDF.
- Gambar dinormalisasi lewat canvas (EXIF orientation), dibatasi 2400px, lalu
  di-embed sebagai JPEG 0.92. Fit-to-Image memakai skala 200 DPI dengan batas
  240–1200 pt agar halaman tetap wajar.
- Hasil: satu PDF multi-halaman, satu gambar per halaman.

### Signature Stamper

- Upload PDF → pilih halaman lewat dropdown/prev-next.
- Upload tanda tangan **PNG transparan** (JPG juga didukung). Gambar
  dinormalisasi dan dibatasi 1600px; alpha PNG dipertahankan.
- Tanda tangan bisa **digeser langsung** di atas preview, di-resize dari sudut,
  atau diatur lewat slider **X, Y, Lebar, Tinggi** dengan opsi kunci rasio.
- Ekspor memakai pdf-lib `drawImage`. Posisi pusat dikonversi dari koordinat
  tampilan ke PDF user space memakai `PageViewport.convertToPdfPoint()`, lalu
  gambar diputar `-pageRotation` agar tetap tegak pada halaman ber-`/Rotate`.
- Halaman lain tidak diubah; PDF asli tidak di-rasterize.

## PWA & offline

`vite.config.ts` memakai `registerType: 'autoUpdate'` dan Workbox:

```ts
globPatterns: ['**/*.{js,css,html,ico,png,svg,mjs,wasm,ttf,pfb,bcmap,icc}']
```

Pola tersebut mencakup bundle JS, worker `.mjs`, wasm, dan font/CMap pdf.js.
`maximumFileSizeToCacheInBytes` dinaikkan ke **30 MB** agar `gs.wasm` (±16 MB)
ikut di-precache dan kompresor tetap berjalan 100% offline setelah kunjungan
pertama.

`vercel.json` menetapkan `Content-Type: application/wasm` untuk
`/wasm/gs.wasm` agar instantiasi WASM tidak gagal saat deploy.
Ikon installable tersedia dalam 192px, 512px, dan maskable 512px.

Header aplikasi menampilkan status:

- **Offline Ready** — service worker aktif dan aset sudah di-precache.
- **Local Processing Only** — tidak ada pemrosesan di server.
- Saat koneksi mati, label berubah menjadi **Mode Offline**.

## Struktur proyek

```
src/
  App.tsx                      # shell, navigasi, status offline, lazy PDF modules
  components/
    Sidebar.tsx                # 4 modul + privacy card
    Dropzone.tsx               # drag-and-drop single/multi file
    Controls.tsx               # segmented control + slider
  lib/
    image.ts                   # decode EXIF-aware, watermark canvas, toBlob
    compress.ts                # binary search 7 iterasi + downscale 0.85×
    pdfjs.ts                   # worker lokal, render halaman/thumbnail
    organizePdf.ts             # merge/reorder/rotate via pdf-lib
    ghostscript.ts             # loader WASM + 3 preset + size guard
    pageRange.ts               # parser "1-3,5"
    imagesToPdf.ts             # image → PDF A4/F4/Fit
    signPdf.ts                 # stamping rotation-aware
    format.ts                  # bytes, tanggal, download, revoke URL
    modules.ts                 # metadata modul
  modules/
    Watermarker.tsx
    BatchCompressor.tsx
    PdfStudio.tsx              # sub-tab Organizer / Compressor
    PdfOrganizer.tsx
    PdfCompressor.tsx
    SignatureStudio.tsx        # sub-tab
    ImagesToPdf.tsx
    SignatureStamper.tsx
public/
  pdfjs/                       # cmaps, standard_fonts, wasm, iccs (offline)
  wasm/                        # gs.js + gs.wasm (Ghostscript, offline)
  icon-192.png, icon-512.png, icon-maskable-512.png
scripts/
  copy-ghostscript.mjs         # salin aset Ghostscript saat install/build
vercel.json                    # header Content-Type application/wasm
```

## Privasi & pembersihan memori

- Tidak ada request jaringan saat memproses file.
- `URL.revokeObjectURL()` dipanggil untuk setiap blob preview/unduhan; URL
  di-revoke saat item dihapus, diganti, atau modul di-unmount.
- Bitmap hasil decode (`ImageBitmap`) selalu `.close()` setelah dipakai.
- Dokumen pdf.js dihancurkan lewat loading task saat modul ditutup.
- Service worker hanya meng-cache aset aplikasi, bukan file pengguna.

## Batasan

- PDF terenkripsi/password belum didukung (akan menampilkan pesan error).
- Kompresi Ghostscript bisa memakan waktu dan memori untuk PDF berhalaman banyak
  atau bergambar sangat besar; proses berjalan di main thread browser.
- Jika output Ghostscript tidak lebih kecil, file asli dikembalikan (size guard).
- Ghostscript dapat menyesuaikan metadata/struktur internal PDF meskipun teks dan
  vektor tetap dipertahankan.
- Ekspor PDF organizer memakai `copyPages`, sehingga outline/bookmark dan form
  interaktif dari sumber tidak ikut tersalin.
- Signature ditempel satu halaman per ekspor (bisa diulang untuk halaman lain).
- Jumlah halaman dibatasi oleh memori browser; thumbnail disimpan sebagai data URL.
