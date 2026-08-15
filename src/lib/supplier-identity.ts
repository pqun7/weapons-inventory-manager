const LEGAL_SUFFIX = /\b(?:(?:CO(?:MPANY)?\.?,?\s*)?L\.?T\.?D\.?|L\.?L\.?C\.?|INC\.?|CORP(?:ORATION)?\.?|CO\.?|COMPANY|PLC|GMBH|S\.?A\.?R\.?L\.?|S\.?A\.?)\b/i
const ADDRESS_CUE = /\s+(?:P\.?\s*O\.?\s*BOX|STREET|ST\.?|ROAD|RD\.?|AVENUE|AVE\.?|BUILDING|BLDG\.?|INDUSTRIAL|ZIP|POSTAL|TEL(?:EPHONE)?|PHONE|EMAIL|VAT|TAX\s*ID)\b/i

export function extractSupplierLegalName(value: string | null | undefined): string | null {
  if (!value) return null
  const firstLine = value.normalize("NFKC").split(/\r?\n|\t|\s{3,}/, 1)[0].trim()
  if (!firstLine) return null
  const suffix = LEGAL_SUFFIX.exec(firstLine)
  let result = suffix ? firstLine.slice(0, suffix.index + suffix[0].length) : firstLine
  const address = ADDRESS_CUE.exec(result)
  if (address) result = result.slice(0, address.index)
  result = result.replace(/^[\s:;,.-]+|[\s:;,.-]+$/g, "").replace(/\s+/g, " ")
  return result || null
}

export function canonicalSupplierName(value: string | null | undefined): string {
  const legalName = extractSupplierLegalName(value) ?? ""
  return legalName
    .toLocaleLowerCase("en")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
}
