export const WORD_MANIFEST_EXTENSIONS = [".doc", ".docx"] as const
export const WORD_MANIFEST_MIME_TYPES = [
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const

export const LOCAL_MANIFEST_EXTENSIONS = [".xlsx", ".xls", ".csv", ...WORD_MANIFEST_EXTENSIONS] as const
export const MANIFEST_EXTENSIONS = [
  ...LOCAL_MANIFEST_EXTENSIONS,
  ".pdf", ".jpg", ".jpeg", ".png", ".webp",
] as const

export const LOCAL_MANIFEST_FILE_ACCEPT = [...LOCAL_MANIFEST_EXTENSIONS, ...WORD_MANIFEST_MIME_TYPES].join(",")
export const MANIFEST_FILE_ACCEPT = [...MANIFEST_EXTENSIONS, ...WORD_MANIFEST_MIME_TYPES].join(",")

export function manifestFileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".")
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : ""
}

export function isLocallySupportedManifestFileName(fileName: string): boolean {
  return (LOCAL_MANIFEST_EXTENSIONS as readonly string[]).includes(manifestFileExtension(fileName))
}
