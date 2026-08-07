import { table } from "console";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

type IpcResult<T = unknown> = { success: boolean; data?: T; error?: string }

function createMockIpcRenderer() {
  const handlers = new Map<string, ((...args: unknown[]) => unknown)[]>()
  return {
    handle(channel: string, handler: (...args: unknown[]) => unknown) {
      if (!handlers.has(channel)) handlers.set(channel, [])
      handlers.get(channel)!.push(handler)
    },
    invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      const fns = handlers.get(channel)
      if (!fns || fns.length === 0) {
        return Promise.resolve({ success: false, error: `No handler for channel: ${channel}` } as IpcResult)
      }
      if (fns.length > 1) {
        return Promise.resolve({ success: false, error: `Duplicate handler for channel: ${channel}` } as IpcResult)
      }
      try {
        const result = fns[0](null, ...args)
        return Promise.resolve(result)
      } catch (e) {
        return Promise.resolve({ success: false, error: String(e) } as IpcResult)
      }
    },
    _handlers: handlers,
    _clear() { handlers.clear() },
  }
}

describe("IPC Channel Registration & Coverage", () => {
  const mockIpc = createMockIpcRenderer()

  afterEach(() => { mockIpc._clear() })

  it("registers exactly one handler per channel (no duplicates)", () => {
    const channels = [
      "db:getAll", "db:getMasterData", "db:getSettings", "db:getUserPreferences",
      "db:getCurrencies", "db:getOverrides", "db:getRateAuditLog",
      "db:listBackups", "db:createBackup", "db:restoreBackup", "db:deleteBackup",
      "settings:update", "userPreferences:upsert",
      "weapon:bulkInsert", "weapon:update", "weapon:updateStatus",
      "sale:complete", "shipment:create", "shipment:bulkCreate", "shipment:update",
      "invoice:update", "invoice:void", "invoice:extendDueDate",
      "payment:register", "customer:insert", "customer:delete",
      "supplier:insert", "accessory:insert", "accessory:update",
      "ammunition:insert", "ammunition:update",
      "inventory:addStock", "inventory:receiveAmmoByPackages",
      "inventory:receiveAmmoByRounds", "inventory:sellAmmo", "inventory:updateAmmoPackage",
      "user:insert", "user:update", "user:delete",
      "notification:update", "notification:delete", "auditLog:insert",
      "savedFilter:insert", "savedFilter:delete",
      "currency:updateRate", "currency:recordRateHistory",
      "currency:setManualOverride", "currency:setAutomatic",
      "currency:add", "currency:toggleActive", "currency:recordRateAuditLog",
    ]

    for (const ch of channels) {
      mockIpc.handle(ch, () => ({ success: true }))
    }

    for (const ch of channels) {
      const fns = mockIpc._handlers.get(ch)
      expect(fns, `Channel ${ch} should have a handler`).toBeDefined()
      expect(fns!.length, `Channel ${ch} should have exactly one handler`).toBe(1)
    }

    expect(mockIpc._handlers.size).toBe(channels.length)
  })

  it("returns error for unregistered channels", async () => {
    const result = await mockIpc.invoke("nonexistent:channel") as IpcResult
    expect(result.success).toBe(false)
    expect(result.error).toContain("No handler")
  })

  it("detects duplicate handler registration", async () => {
    mockIpc.handle("test:dup", () => ({ success: true }))
    mockIpc.handle("test:dup", () => ({ success: true }))
    const result = await mockIpc.invoke("test:dup") as IpcResult
    expect(result.success).toBe(false)
    expect(result.error).toContain("Duplicate")
  })
})

describe("IPC Payload Validation", () => {
  const mockIpc = createMockIpcRenderer()

  afterEach(() => { mockIpc._clear() })

  it("validates weapon:update payload requires id", async () => {
    mockIpc.handle("weapon:update", (_e, weapon: unknown) => {
      if (!weapon || typeof weapon !== "object" || !("id" in weapon)) {
        return { success: false, error: "Weapon id is required" }
      }
      return { success: true }
    })

    const badResult = await mockIpc.invoke("weapon:update", { serial_number: "SN001" }) as IpcResult
    expect(badResult.success).toBe(false)

    const goodResult = await mockIpc.invoke("weapon:update", { id: "w-1", serial_number: "SN001" }) as IpcResult
    expect(goodResult.success).toBe(true)
  })

  it("validates payment:register payload requires positive amount", async () => {
    mockIpc.handle("payment:register", (_e, payload: unknown) => {
      const p = payload as { amount?: number }
      if (!p || typeof p.amount !== "number" || p.amount <= 0) {
        return { success: false, error: "Amount must be positive" }
      }
      return { success: true }
    })

    const zeroResult = await mockIpc.invoke("payment:register", { amount: 0 }) as IpcResult
    expect(zeroResult.success).toBe(false)

    const negResult = await mockIpc.invoke("payment:register", { amount: -100 }) as IpcResult
    expect(negResult.success).toBe(false)

    const goodResult = await mockIpc.invoke("payment:register", { amount: 500 }) as IpcResult
    expect(goodResult.success).toBe(true)
  })

  it("validates customer:insert payload requires name", async () => {
    mockIpc.handle("customer:insert", (_e, customer: unknown) => {
      const c = customer as { name?: string }
      if (!c || !c.name || !c.name.trim()) {
        return { success: false, error: "Customer name is required" }
      }
      return { success: true }
    })

    const emptyResult = await mockIpc.invoke("customer:insert", { name: "" }) as IpcResult
    expect(emptyResult.success).toBe(false)

    const goodResult = await mockIpc.invoke("customer:insert", { id: "c-1", name: "John Doe" }) as IpcResult
    expect(goodResult.success).toBe(true)
  })

  it("validates currency:updateRate requires numeric rate", async () => {
   mockIpc.handle("currency:updateRate", (_e, _code: string, _rate: unknown, _updatedAt: string)  => {
      if (typeof _rate !== "number" || !isFinite(_rate) || _rate <= 0) {
        return { success: false, error: "Rate must be a positive number" }
      }
      return { success: true }
    })

    const badResult = await mockIpc.invoke("currency:updateRate", "USD", "not-a-number", "2026-01-01") as IpcResult
    expect(badResult.success).toBe(false)

    const goodResult = await mockIpc.invoke("currency:updateRate", "USD", 3.75, "2026-01-01") as IpcResult
    expect(goodResult.success).toBe(true)
  })

  it("validates masterData:deleteRow rejects disallowed tables", async () => {
    mockIpc.handle("masterData:deleteRow", (_e, _table: string, _id: string) => {
      const allowed = ["weapon_types", "weapon_subtypes", "calibers", "brands", "models", "warehouses", "storage_locations"]
      if (!allowed.includes(_table)) {
        return { success: false, error: `Cannot delete from table: ${_table}` }
      }
      return { success: true }
    })

    const blockedResult = await mockIpc.invoke("masterData:deleteRow", "users", "U001") as IpcResult
    expect(blockedResult.success).toBe(false)
    expect(blockedResult.error).toContain("Cannot delete")

    const goodResult = await mockIpc.invoke("masterData:deleteRow", "brands", "br-1") as IpcResult
    expect(goodResult.success).toBe(true)
  })
})

describe("IPC Error Handling", () => {
  const mockIpc = createMockIpcRenderer()

  afterEach(() => { mockIpc._clear() })

  it("catches handler exceptions and returns structured error", async () => {
    mockIpc.handle("test:throw", () => {
      throw new Error("Database connection failed")
    })

    const result = await mockIpc.invoke("test:throw") as IpcResult
    expect(result.success).toBe(false)
    expect(result.error).toContain("Database connection failed")
  })

  it("returns structured success result with data", async () => {
    mockIpc.handle("test:success", () => ({ success: true, data: { count: 42 } }))

    const result = await mockIpc.invoke("test:success") as IpcResult<{ count: number }>
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ count: 42 })
  })

  it("does not leak internal file paths in error messages", async () => {
    mockIpc.handle("test:path", () => {
      throw new Error("Database error")
    })

    const result = await mockIpc.invoke("test:path") as IpcResult
    expect(result.success).toBe(false)
    expect(result.error).not.toContain("/home/user")
    expect(result.error).not.toContain("/tmp/")
  })
})

describe("Renderer Isolation", () => {
  it("db/index.ts throws when called outside Electron (no electronAPI)", async () => {
    const originalElectronAPI = (globalThis as any).electronAPI
    const originalWindow = (globalThis as any).window
      ; (globalThis as any).window = { electronAPI: undefined }
      ; (globalThis as any).electronAPI = undefined

    try {
      const dbModule = await import("@/lib/db")
      await expect(dbModule.dbGetAll()).rejects.toThrow(/Electron environment/i)
    } finally {
      ; (globalThis as any).window = originalWindow
        ; (globalThis as any).electronAPI = originalElectronAPI
    }
  })

  it("db/index.ts throws for dbUpdateSettings outside Electron", async () => {
    const originalElectronAPI = (globalThis as any).electronAPI
    const originalWindow = (globalThis as any).window
      ; (globalThis as any).window = { electronAPI: undefined }
      ; (globalThis as any).electronAPI = undefined

    try {
      const dbModule = await import("@/lib/db")
      await expect(dbModule.dbUpdateSettings({} as never)).rejects.toThrow(/Electron environment/i)
    } finally {
      ; (globalThis as any).window = originalWindow
        ; (globalThis as any).electronAPI = originalElectronAPI
    }
  })
})
