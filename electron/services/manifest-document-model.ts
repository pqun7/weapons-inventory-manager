export type ManifestDocumentFormat = "xlsx" | "xls" | "csv" | "docx" | "doc" | "pdf" | "image" | "unknown"

export interface DocumentLocation {
  sheet?: string
  page?: number
  section?: string
  table?: number
  row?: number
  column?: string
  paragraph?: number
}

export interface DocumentEvidence {
  originalText: string
  normalizedText: string
  method: "spreadsheet-cell" | "docx-xml" | "legacy-word-text" | "ocr" | "vision" | "ai"
  confidence: number
  location: DocumentLocation
}

export interface DocumentCell {
  column: string
  originalText: string
  normalizedText: string
  columnSpan?: number
  verticalMerge?: "restart" | "continue"
  evidence: DocumentEvidence
}

export interface DocumentRow {
  row: number
  cells: DocumentCell[]
}

export interface DocumentTable {
  id: string
  name: string
  sheet?: string
  hidden?: boolean
  rows: DocumentRow[]
  mergedRanges?: string[]
}

export interface DocumentParagraph {
  text: string
  normalizedText: string
  location: DocumentLocation
  style?: string
  evidence: DocumentEvidence
}

export interface DocumentImage {
  id: string
  fileName: string
  mimeType: string
  byteLength: number
  relationshipIds: string[]
  contextText?: string
  /** Transient extraction payload used by the vision pipeline; never persisted to review records. */
  dataBase64?: string
}

export interface NormalizedManifestDocument {
  format: ManifestDocumentFormat
  tables: DocumentTable[]
  paragraphs: DocumentParagraph[]
  headers: DocumentParagraph[]
  footers: DocumentParagraph[]
  textboxes: DocumentParagraph[]
  images: DocumentImage[]
  warnings: string[]
  structureQuality: "structured" | "legacy-text" | "plain-text"
  requiresVisualAnalysis: boolean
}

