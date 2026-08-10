export function cleanMasterDataLabel(value: string, field = "Master-data value"): string {
  const label = value.normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim()
  if (!label) throw new Error(`${field} is required`)
  if (label.length > 120) throw new Error(`${field} is too long`)
  return label
}

export function masterDataKey(value: string): string {
  return value.normalize("NFKD").toLocaleLowerCase("en").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "")
}

export function findCanonicalMasterId(rows: Array<{ id: string; label: string }>, label: string): string | null {
  const key = masterDataKey(label)
  return rows.find((row) => masterDataKey(row.label) === key)?.id ?? null
}
