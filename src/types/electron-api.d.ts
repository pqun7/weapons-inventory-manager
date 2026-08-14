import type {
  ManifestExtractionResult,
  ManifestProgress,
  ManifestUploadInput,
} from "../lib/shipment-manifest"
import type {
  InitializeStoreInput,
  StoreConnectionConfiguration,
  StoreSetupProgressStage,
  StoreSetupResult,
} from "../lib/store-connection"

export interface IpcResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface ElectronAPI {
  storeConnection: {
    get: () => Promise<IpcResult<{ connection: StoreConnectionConfiguration; connectionCode: string } | null>>
    join: (input: { connectionCode: string }) => Promise<IpcResult<{ connection: StoreConnectionConfiguration; connectionCode: string }>>
    initialize: (input: InitializeStoreInput) => Promise<IpcResult<StoreSetupResult>>
    clear: () => Promise<IpcResult<void>>
    onSetupProgress: (callback: (stage: StoreSetupProgressStage) => void) => () => void
  }
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
