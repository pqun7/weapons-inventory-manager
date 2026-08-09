import React from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { I18nProvider } from "@/lib/i18n"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

function renderDialog(language: "en" | "ar" = "en") {
  render(
    <I18nProvider lang={language} onLangChange={() => undefined}>
      <Dialog open>
        <DialogContent>
          <DialogTitle>Large amount</DialogTitle>
          <div className="tabular-nums">987,654,321,000.00 جنيه سوداني</div>
        </DialogContent>
      </Dialog>
    </I18nProvider>,
  )
}

describe("responsive dialog layout", () => {
  it("uses content-aware width with viewport limits and vertical scrolling", () => {
    renderDialog()
    const dialog = screen.getByRole("dialog")
    expect(dialog.className).toContain("w-fit")
    expect(dialog.className).toContain("max-w-[calc(100vw-1rem)]")
    expect(dialog.className).toContain("max-h-[calc(100dvh-1rem)]")
    expect(dialog.className).toContain("overflow-y-auto")
    expect(screen.getByText(/987,654,321,000\.00/).className).toContain("tabular-nums")
  })

  it("localizes the close action for Arabic users", () => {
    renderDialog("ar")
    expect(screen.getByText("إغلاق النافذة")).toBeInTheDocument()
    expect(document.documentElement.dir).toBe("rtl")
  })
})
