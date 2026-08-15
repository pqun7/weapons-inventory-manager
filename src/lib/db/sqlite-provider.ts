import type { DatabaseOperationName } from "../database-provider.js"

interface IpcResult<T> {
  success: boolean
  data?: T
  error?: string
}

export async function invokeSqliteOperation<T>(operation: DatabaseOperationName, args: readonly unknown[]): Promise<T> {
  const desktop = globalThis as typeof globalThis & {
    electronAPI?: { database?: { invoke: (input: { operation: DatabaseOperationName; args: unknown[] }) => Promise<IpcResult<unknown>> } }
  }
  const api = desktop.electronAPI?.database
  if (!api) throw new Error("SQLite database access requires the Electron desktop environment")
  const response = await api.invoke({ operation, args: [...args] }) as IpcResult<T>
  if (!response.success) throw new Error(response.error ?? "The SQLite database operation failed")
  return response.data as T
}
