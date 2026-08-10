import { parentPort, workerData } from "node:worker_threads"
import { parseSpreadsheetBuffer } from "./manifest-parser.js"

try {
  const extraction = parseSpreadsheetBuffer(new Uint8Array(workerData as Uint8Array))
  parentPort?.postMessage({ ok: true, extraction })
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : "Unable to read spreadsheet",
  })
}
