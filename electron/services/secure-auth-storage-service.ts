import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import electron from "electron"

type StoredSecretEnvelope =
  | { format: "encrypted-v1"; data: string }
  | { format: "test-v1"; data: string }

const electronApp = electron.app
const electronSafeStorage = electron.safeStorage
let testRootOverride: string | null = null

function storageRoot(): string {
  if (process.env.NODE_ENV === "test" && testRootOverride) return testRootOverride
  if (!electronApp?.getPath) throw new Error("Secure authentication storage is unavailable")
  return path.join(electronApp.getPath("userData"), "auth")
}

function validateKey(key: string): string {
  const normalized = key.trim()
  if (!normalized || normalized.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new Error("Invalid authentication storage key")
  }
  return normalized
}

function secretPath(key: string): string {
  const digest = createHash("sha256").update(validateKey(key), "utf8").digest("hex")
  return path.join(storageRoot(), `${digest}.session`)
}

function productionEncryptionAvailable(): boolean {
  if (!electronSafeStorage?.isEncryptionAvailable?.()) return false
  const backend = electronSafeStorage.getSelectedStorageBackend?.()
  return backend == null || backend !== "basic_text"
}

function encode(value: string): StoredSecretEnvelope {
  if (Buffer.byteLength(value, "utf8") > 2 * 1024 * 1024) throw new Error("Authentication session is too large")
  if (process.env.NODE_ENV === "test") {
    return { format: "test-v1", data: Buffer.from(value, "utf8").toString("base64") }
  }
  if (!productionEncryptionAvailable()) throw new Error("Operating-system encryption is required to remember this session")
  return { format: "encrypted-v1", data: electronSafeStorage.encryptString(value).toString("base64") }
}

function decode(envelope: StoredSecretEnvelope): string {
  if (envelope.format === "test-v1" && process.env.NODE_ENV === "test") {
    return Buffer.from(envelope.data, "base64").toString("utf8")
  }
  if (envelope.format !== "encrypted-v1" || !productionEncryptionAvailable()) {
    throw new Error("The saved authentication session cannot be decrypted securely")
  }
  return electronSafeStorage.decryptString(Buffer.from(envelope.data, "base64"))
}

export function readSecureAuthValue(key: string): string | null {
  const filename = secretPath(key)
  const backup = `${filename}.bak`
  if (!fs.existsSync(filename) && fs.existsSync(backup)) fs.renameSync(backup, filename)
  if (!fs.existsSync(filename)) return null
  const parsed = JSON.parse(fs.readFileSync(filename, "utf8")) as StoredSecretEnvelope
  return decode(parsed)
}

export function writeSecureAuthValue(key: string, value: string): void {
  const filename = secretPath(key)
  const directory = path.dirname(filename)
  const temporary = path.join(directory, `${path.basename(filename)}.${process.pid}.${Date.now()}.tmp`)
  const backup = `${filename}.bak`
  fs.mkdirSync(directory, { recursive: true })
  let temporaryExists = false
  try {
    const descriptor = fs.openSync(temporary, "wx", 0o600)
    temporaryExists = true
    try {
      fs.writeFileSync(descriptor, JSON.stringify(encode(value)), "utf8")
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
    if (fs.existsSync(backup)) fs.unlinkSync(backup)
    if (fs.existsSync(filename)) fs.renameSync(filename, backup)
    try {
      fs.renameSync(temporary, filename)
      temporaryExists = false
      if (fs.existsSync(backup)) fs.unlinkSync(backup)
    } catch (error) {
      if (!fs.existsSync(filename) && fs.existsSync(backup)) fs.renameSync(backup, filename)
      throw error
    }
  } finally {
    if (temporaryExists && fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

export function removeSecureAuthValue(key: string): void {
  const filename = secretPath(key)
  for (const candidate of [filename, `${filename}.bak`]) {
    if (fs.existsSync(candidate)) fs.unlinkSync(candidate)
  }
}

export function setSecureAuthStorageRootForTests(root: string | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("Authentication storage overrides are restricted to tests")
  testRootOverride = root == null ? null : path.resolve(root)
}
