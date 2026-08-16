import path from "node:path"
import type { ManifestUploadInput } from "../../src/lib/shipment-manifest.js"
import { ALLOWED_MANIFEST_EXTENSIONS, MAX_MANIFEST_FILE_SIZE } from "./manifest-parser.js"

export interface ValidatedManifestUpload {
  /** The parser format inferred from the file contents, not just the file name. */
  extension: string
  mimeType: string
  bytes: Uint8Array
}

function startsWith(bytes: Uint8Array, ...signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

function containsAscii(bytes: Uint8Array, marker: string): boolean {
  const needle = Buffer.from(marker, "ascii")
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(needle)
}

function canonicalOfficeFormat(extension: string, bytes: Uint8Array): string | null {
  const ole = startsWith(bytes, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)
  const zip = startsWith(bytes, 0x50, 0x4b)

  if (extension === ".doc" || extension === ".docx") {
    if (ole) return ".doc"
    // Word sometimes saves an OOXML package while retaining a legacy .doc file
    // name. Treat the package contents as authoritative so both providers parse
    // the same valid document.
    if (zip && containsAscii(bytes, "word/document.xml")) return ".docx"
    return null
  }

  if (extension === ".xls" || extension === ".xlsx") {
    if (ole) return ".xls"
    if (zip && containsAscii(bytes, "xl/workbook.xml")) return ".xlsx"
    return null
  }

  return extension
}

function canonicalMimeType(extension: string): string {
  return ({
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".csv": "text/csv",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  } as Record<string, string>)[extension] ?? "application/octet-stream"
}

export function validateManifestUpload(input: ManifestUploadInput): ValidatedManifestUpload {
  if (typeof input?.fileName !== "string" || !input.fileName.trim() || /[\\/\0]/.test(input.fileName)) {
    throw new Error("Invalid manifest file name")
  }

  const fileName = path.basename(input.fileName)
  const declaredExtension = path.extname(fileName).toLowerCase()
  if (!ALLOWED_MANIFEST_EXTENSIONS.has(declaredExtension)) throw new Error("Unsupported manifest file type")

  const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes)
  if (bytes.byteLength <= 0) throw new Error("The uploaded file is empty")
  if (bytes.byteLength > MAX_MANIFEST_FILE_SIZE) throw new Error("The manifest exceeds the 30 MB size limit")

  const officeExtension = canonicalOfficeFormat(declaredExtension, bytes)
  const firstChunk = bytes.slice(0, Math.min(bytes.byteLength, 4096))
  const signatureMatches = officeExtension != null && ({
    ".pdf": startsWith(bytes, 0x25, 0x50, 0x44, 0x46),
    ".jpg": startsWith(bytes, 0xff, 0xd8, 0xff),
    ".jpeg": startsWith(bytes, 0xff, 0xd8, 0xff),
    ".png": startsWith(bytes, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    ".webp": startsWith(bytes, 0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50,
    ".csv": startsWith(bytes, 0xff, 0xfe) || startsWith(bytes, 0xfe, 0xff) || !firstChunk.some((value) => value === 0),
    ".doc": true,
    ".docx": true,
    ".xls": true,
    ".xlsx": true,
  } as Record<string, boolean>)[declaredExtension]

  if (!signatureMatches) throw new Error("The file content does not match its extension")

  const extension = officeExtension ?? declaredExtension
  return { extension, mimeType: canonicalMimeType(extension), bytes }
}
