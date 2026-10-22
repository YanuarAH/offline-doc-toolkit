/**
 * libheif-js mengirim dekoder wasm sebagai satu file .mjs tanpa deklarasi tipe.
 * Hanya bagian yang dipakai LocalKit yang dideklarasikan di sini.
 */
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  interface HeifModuleOptions {
    locateFile?: (path: string) => string
    wasmBinary?: ArrayBuffer | Uint8Array
  }

  interface HeifImageHandle {
    get_width(): number
    get_height(): number
    is_primary?(): boolean
    has_alpha_channel?(): boolean
    display(target: ImageData, callback: (data: ImageData | null) => void): void
    free?(): void
  }

  interface HeifDecoderInstance {
    decode(data: Uint8Array): HeifImageHandle[]
  }

  interface LibHeifModule {
    HeifDecoder: new () => HeifDecoderInstance
  }

  const factory: (options?: HeifModuleOptions) => LibHeifModule
  export default factory
}
