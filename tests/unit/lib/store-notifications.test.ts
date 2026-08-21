import { afterEach, describe, expect, it, vi } from "vitest"
import type { AppNotification } from "@/lib/types"

const dbMocks = vi.hoisted(() => ({
  mark: vi.fn<(ids: string[]) => Promise<void>>(),
  dismiss: vi.fn<(ids: string[]) => Promise<void>>(),
}))

vi.mock("@/lib/db", () => ({
  dbMarkNotificationsRead: dbMocks.mark,
  dbDismissNotifications: dbMocks.dismiss,
}))

import { useStore } from "@/lib/store"

const notifications: AppNotification[] = [
  { id: "N1", type: "System", title: "One", message: "One", date: "2026-08-17", read: false, entityId: null },
  { id: "N2", type: "LowStock", title: "Two", message: "Two", date: "2026-08-17", read: true, entityId: "A1" },
]

describe("notification store actions", () => {
  const initialNotifications = useStore.getState().notifications

  afterEach(() => {
    useStore.setState({ notifications: initialNotifications })
    dbMocks.mark.mockReset()
    dbMocks.dismiss.mockReset()
  })

  it("hides the unread count optimistically without refreshing the full database", async () => {
    dbMocks.mark.mockResolvedValue(undefined)
    useStore.setState({ notifications })

    const pending = useStore.getState().markAllNotificationsRead()

    expect(useStore.getState().notifications.every((notification) => notification.read)).toBe(true)
    await expect(pending).resolves.toEqual({ success: true })
    expect(dbMocks.mark).toHaveBeenCalledWith(["N1"])
  })

  it("clears the notification window optimistically using per-user dismissal", async () => {
    dbMocks.dismiss.mockResolvedValue(undefined)
    useStore.setState({ notifications })

    const pending = useStore.getState().clearNotifications()

    expect(useStore.getState().notifications).toEqual([])
    await expect(pending).resolves.toEqual({ success: true })
    expect(dbMocks.dismiss).toHaveBeenCalledWith(["N1", "N2"])
  })

  it("restores notifications if persistence fails", async () => {
    dbMocks.dismiss.mockRejectedValue(new Error("offline"))
    useStore.setState({ notifications })

    await expect(useStore.getState().clearNotifications()).resolves.toEqual({ success: false, error: "offline" })
    expect(useStore.getState().notifications).toEqual(notifications)
  })
})
