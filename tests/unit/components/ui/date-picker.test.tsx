import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import React, { type ComponentProps } from "react"
import { DatePicker } from "@/components/ui/date-picker"
import { I18nProvider } from "@/lib/i18n"

function renderPicker(props: Partial<ComponentProps<typeof DatePicker>> = {}) {
  const onChange = vi.fn()
  render(
    <I18nProvider lang="en" onLangChange={() => undefined}>
      <DatePicker value="2026-08-15" onChange={onChange} {...props} />
    </I18nProvider>,
  )
  return onChange
}

describe("DatePicker", () => {
  it("displays an ISO date as a localized Gregorian date", () => {
    renderPicker()
    expect(screen.getByRole("button", { name: "Aug 15, 2026" })).toBeInTheDocument()
  })

  it("clears an optional date from the calendar footer", async () => {
    const user = userEvent.setup()
    const onChange = renderPicker()
    await user.click(screen.getByRole("button", { name: "Aug 15, 2026" }))
    await user.click(screen.getByRole("button", { name: "Clear" }))
    expect(onChange).toHaveBeenCalledWith("")
  })

  it("keeps clear disabled for required dates", async () => {
    const user = userEvent.setup()
    renderPicker({ required: true })
    await user.click(screen.getByRole("button", { name: "Aug 15, 2026" }))
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled()
  })
})
