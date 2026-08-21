import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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

import { NotificationCenter } from "@/components/notification-center"
import { I18nProvider } from "@/lib/i18n"
import { NavProvider, useNav } from "@/lib/nav"
import { useStore } from "@/lib/store"

const notification: AppNotification = {
  id: "N1", type: "System", title: "System", message: "Maintenance completed",
  date: "2026-08-17T00:00:00Z", read: false, entityId: null,
}

function CurrentPage() {
  const { currentPage } = useNav()
  return <output>{currentPage}</output>
}

describe("notification center", () => {
  const initialNotifications = useStore.getState().notifications

  afterEach(() => {
    useStore.setState({ notifications: initialNotifications })
    dbMocks.mark.mockReset()
    dbMocks.dismiss.mockReset()
  })

  it("marks visible notifications as read on open, clears them, and opens Audit", async () => {
    const user = userEvent.setup()
    dbMocks.mark.mockResolvedValue(undefined)
    dbMocks.dismiss.mockResolvedValue(undefined)
    useStore.setState({ notifications: [notification], shipments: [] })
    render(
      <I18nProvider lang="en" onLangChange={() => undefined}>
        <NavProvider><NotificationCenter /><CurrentPage /></NavProvider>
      </I18nProvider>,
    )

    await user.click(screen.getByRole("button", { name: "Open notifications" }))
    await waitFor(() => expect(useStore.getState().notifications[0]?.read).toBe(true))
    expect(screen.queryByText(/1 new/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /clear all/i }))
    await waitFor(() => expect(useStore.getState().notifications).toEqual([]))

    await user.click(screen.getByRole("button", { name: /view all/i }))
    expect(screen.getByText("audit")).toBeInTheDocument()
  })
})
