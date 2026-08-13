import { app, type BrowserWindow, dialog } from "electron"
import log from "electron-log/main"
import electronUpdater, {
  type AppUpdater,
  type ProgressInfo,
  type UpdateDownloadedEvent,
  type UpdateInfo,
} from "electron-updater"

const STARTUP_CHECK_DELAY_MS = 15_000
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

let initialized = false
let checkInProgress = false
let updateDownloaded = false
let updateCheckTimer: NodeJS.Timeout | undefined

function getAutoUpdater(): AppUpdater {
  // electron-updater is CommonJS; destructuring its default import is the
  // supported interop pattern for an ESM main process.
  const { autoUpdater } = electronUpdater
  return autoUpdater
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`
  }
  return String(error)
}

export function initializeAutoUpdater(
  getMainWindow: () => BrowserWindow | null,
): void {
  if (initialized) return
  initialized = true

  log.initialize({ spyRendererConsole: false })
  log.transports.file.level = "info"
  log.transports.file.maxSize = 5 * 1_024 * 1_024

  if (!app.isPackaged) {
    log.info("[updater] Skipping update checks in an unpackaged build")
    return
  }

  const autoUpdater = getAutoUpdater()
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false

  autoUpdater.on("checking-for-update", () => {
    log.info(`[updater] Checking for updates; current version=${app.getVersion()}`)
  })

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    log.info(`[updater] Update available; version=${info.version}`)
  })

  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    log.info(`[updater] Application is current; latest version=${info.version}`)
  })

  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    log.info(
      `[updater] Download ${progress.percent.toFixed(1)}% ` +
        `(${progress.transferred}/${progress.total} bytes at ${progress.bytesPerSecond} B/s)`,
    )
  })

  autoUpdater.on("update-downloaded", (info: UpdateDownloadedEvent) => {
    updateDownloaded = true
    if (updateCheckTimer) clearInterval(updateCheckTimer)
    log.info(`[updater] Update downloaded; version=${info.version}`)

    const owner = getMainWindow()
    const messageBox = {
      type: "info" as const,
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: "Update ready",
      message: `Armory Store ${info.version} is ready to install.`,
      detail: "Restart now to finish installing the update. If you choose Later, it will install when you close the application.",
    }

    const prompt = owner && !owner.isDestroyed()
      ? dialog.showMessageBox(owner, messageBox)
      : dialog.showMessageBox(messageBox)

    void prompt
      .then(({ response }) => {
        if (response === 0) {
          log.info("[updater] User accepted restart and install")
          setImmediate(() => autoUpdater.quitAndInstall(false, true))
        } else {
          log.info("[updater] User postponed installation until application exit")
        }
      })
      .catch((error: unknown) => {
        log.error(`[updater] Failed to display update prompt: ${errorDetails(error)}`)
      })
  })

  autoUpdater.on("error", (error: Error, message?: string) => {
    log.error(`[updater] Update error${message ? `: ${message}` : ""}\n${errorDetails(error)}`)
  })

  const checkForUpdates = async (reason: "startup" | "scheduled"): Promise<void> => {
    if (checkInProgress || updateDownloaded) return
    checkInProgress = true
    log.info(`[updater] Starting ${reason} update check`)
    try {
      await autoUpdater.checkForUpdates()
    } catch (error: unknown) {
      log.error(`[updater] ${reason} update check failed: ${errorDetails(error)}`)
    } finally {
      checkInProgress = false
    }
  }

  setTimeout(() => void checkForUpdates("startup"), STARTUP_CHECK_DELAY_MS)
  updateCheckTimer = setInterval(
    () => void checkForUpdates("scheduled"),
    UPDATE_CHECK_INTERVAL_MS,
  )
}
