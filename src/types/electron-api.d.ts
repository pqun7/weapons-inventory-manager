import type {
  ManifestExtractionResult,
  ManifestProgress,
  ManifestUploadInput,
} from "../lib/shipment-manifest"

export interface IpcResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface ElectronAPI {
  manifest: {
    parse: (input: ManifestUploadInput) => Promise<IpcResult<ManifestExtractionResult>>
    onProgress: (callback: (progress: ManifestProgress) => void) => () => void
  }
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
