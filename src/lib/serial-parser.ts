export type SerialStatus = "valid" | "dbDuplicate" | "localDuplicate"

export interface ParsedSerial {
  serial: string
  status: SerialStatus
}

export function parseSerialInput(raw: string): string[] {
  if (!raw.trim()) return []
  const lines = raw
    .split(/[\n\r,\t;|]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/[\x00-\x1F\x7F]/g, ""))
  return lines
}

export function deduplicateSerials(
  serials: string[],
  existingSerials: Set<string>
): ParsedSerial[] {
  const seen = new Map<string, number>()
  const results: ParsedSerial[] = []

  for (const s of serials) {
    const lower = s.toLowerCase()
    const prevCount = seen.get(lower) ?? 0
    seen.set(lower, prevCount + 1)

    if (existingSerials.has(lower)) {
      results.push({ serial: s, status: "dbDuplicate" })
    } else if (prevCount > 0) {
      results.push({ serial: s, status: "localDuplicate" })
    } else {
      results.push({ serial: s, status: "valid" })
    }
  }

  return results
}

export function getValidUniqueSerials(parsed: ParsedSerial[]): string[] {
  const seen = new Set<string>()
  const valid: string[] = []
  for (const p of parsed) {
    if (p.status === "valid") {
      const lower = p.serial.toLowerCase()
      if (!seen.has(lower)) {
        seen.add(lower)
        valid.push(p.serial)
      }
    }
  }
  return valid
}

export function getSerialStats(parsed: ParsedSerial[]) {
  let valid = 0, dbDup = 0, localDup = 0
  const uniqueValid = new Set<string>()
  for (const p of parsed) {
    if (p.status === "valid") {
      valid++
      uniqueValid.add(p.serial.toLowerCase())
    } else if (p.status === "dbDuplicate") {
      dbDup++
    } else {
      localDup++
    }
  }
  return { valid, dbDup, localDup, uniqueCount: uniqueValid.size }
}
