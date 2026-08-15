import { ipcMain } from "electron"
import { z } from "zod"
import {
  SQLITE_MANIFEST_OPERATIONS,
  type ManifestItemPatch,
  type ManifestUploadInput,
  type SqliteManifestOperation,
} from "../../src/lib/shipment-manifest.js"
import { readStorageConfig } from "../services/storage-config-service.js"
import { requireLocalSession } from "../services/local-auth-service.js"
import {
  authorizeManifest,
  bulkUpdateManifestItems,
  cancelManifest,
  confirmManifest,
  confirmScheduledArrival,
  deleteManifestItems,
  deleteManifestReview,
  getManifestReview,
  listManifestReviews,
  processManifestUpload,
  rescheduleManifest,
  updateManifestDetails,
  updateManifestItem,
  updateManifestItems,
} from "../services/shipment-manifest-service.js"

const commandSchema = z.object({
  operation: z.enum(SQLITE_MANIFEST_OPERATIONS),
  args: z.array(z.unknown()).max(4),
}).strict()

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : "The manifest operation failed")
    .replace(/[A-Z]:\\[^\r\n]+/gi, "[local path hidden]")
    .slice(0, 500)
}

function requireSqlite(): void {
  if (readStorageConfig().config?.databaseProvider !== "sqlite") {
    throw new Error("SQLite is not the selected database provider")
  }
}

function stringArg(value: unknown, label: string): string {
  const parsed = z.string().trim().min(1).max(200).safeParse(value)
  if (!parsed.success) throw new Error(`${label} is invalid`)
  return parsed.data
}

function currentUser(): { id: string; name: string } {
  const session = requireLocalSession()
  return { id: session.userId, name: session.name }
}

function execute(
  operation: SqliteManifestOperation,
  args: unknown[],
  progress: (value: unknown) => void,
): unknown | Promise<unknown> {
  const user = currentUser()
  switch (operation) {
    case "upload":
      return processManifestUpload(args[0] as ManifestUploadInput, user, progress)
    case "get":
      authorizeManifest(user, "shipment.review")
      return getManifestReview(stringArg(args[0], "importId"))
    case "list":
      authorizeManifest(user, "shipment.review")
      return listManifestReviews(z.number().int().min(1).max(100).default(20).parse(args[0]))
    case "updateItem":
      return updateManifestItem(stringArg(args[0], "importId"), stringArg(args[1], "itemId"), args[2] as ManifestItemPatch, user)
    case "updateItems":
      return updateManifestItems(stringArg(args[0], "importId"), z.array(z.string().min(1)).max(2_000).parse(args[1]), args[2] as ManifestItemPatch, user)
    case "bulkUpdateItems":
      return bulkUpdateManifestItems(
        stringArg(args[0], "importId"),
        z.array(z.object({ itemId: z.string().min(1), patch: z.record(z.string(), z.unknown()) })).max(2_000).parse(args[1]) as Array<{ itemId: string; patch: ManifestItemPatch }>,
        user,
      )
    case "updateDetails":
      return updateManifestDetails(stringArg(args[0], "importId"), z.record(z.string(), z.unknown()).parse(args[1]), user)
    case "deleteItems":
      return deleteManifestItems(stringArg(args[0], "importId"), z.array(z.string().min(1)).max(2_000).parse(args[1]), user)
    case "deleteReview":
      deleteManifestReview(stringArg(args[0], "importId"), user)
      return undefined
    case "confirm":
      return confirmManifest(z.record(z.string(), z.unknown()).parse(args[0]) as never, user)
    case "confirmArrival":
      return confirmScheduledArrival(stringArg(args[0], "importId"), user)
    case "reschedule":
      return rescheduleManifest(stringArg(args[0], "importId"), stringArg(args[1], "expectedArrivalDate"), stringArg(args[2], "reason"), user)
    case "cancel":
      return cancelManifest(stringArg(args[0], "importId"), stringArg(args[1], "reason"), user)
  }
}

export function registerSqliteManifestHandler(): void {
  ipcMain.removeHandler("sqlite-manifest:invoke")
  ipcMain.handle("sqlite-manifest:invoke", async (event, input: unknown) => {
    try {
      requireSqlite()
      if (Buffer.byteLength(JSON.stringify(input ?? null), "utf8") > 35 * 1024 * 1024) {
        throw new Error("Manifest command payload is too large")
      }
      const command = commandSchema.parse(input)
      const data = await execute(command.operation, command.args, (value) => {
        if (!event.sender.isDestroyed()) event.sender.send("manifest:progress", value)
      })
      return { success: true as const, data }
    } catch (error) {
      return { success: false as const, error: safeError(error) }
    }
  })
}
