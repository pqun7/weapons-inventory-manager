interface ManifestDocumentMetadata {
  invoiceNumber: string | null
  manifestNumber: string | null
}

export interface AppGeneratedDocumentIdentifiers {
  invoiceNumber?: string
  manifestNumber?: string
}

/**
 * Supplies deterministic, app-only references when the source document does
 * not contain an invoice or manifest number. The source hash keeps both the
 * SQLite and Supabase workflows consistent without pretending the values came
 * from the uploaded document.
 */
export function ensureAppDocumentIdentifiers<T extends ManifestDocumentMetadata>(
  metadata: T,
  fileHash: string,
): { metadata: T; generated: AppGeneratedDocumentIdentifiers } {
  const suffix = fileHash.slice(0, 16).toUpperCase()
  const generated: AppGeneratedDocumentIdentifiers = {}
  const resolved = { ...metadata }

  if (!metadata.invoiceNumber?.trim()) {
    resolved.invoiceNumber = `APP-INV-${suffix}`
    generated.invoiceNumber = resolved.invoiceNumber
  }
  if (!metadata.manifestNumber?.trim()) {
    resolved.manifestNumber = `APP-MNF-${suffix}`
    generated.manifestNumber = resolved.manifestNumber
  }

  return { metadata: resolved, generated }
}
