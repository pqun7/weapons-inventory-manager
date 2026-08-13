import { parentPort, workerData } from "node:worker_threads"
import { parseSpreadsheetBuffer, parseWordDocumentBuffer } from "./manifest-parser.js"

interface ParserWorkerInput {
  format: "spreadsheet" | "word"
  bytes: Uint8Array
}

try {
  const input = workerData as ParserWorkerInput
  const bytes = new Uint8Array(input.bytes)
  const extraction = input.format === "word"
    ? await parseWordDocumentBuffer(bytes)
    : parseSpreadsheetBuffer(bytes)
  parentPort?.postMessage({ ok: true, extraction })
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : "Unable to read document",
  })
}
