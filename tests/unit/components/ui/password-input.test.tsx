import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { PasswordInput } from "@/components/ui/password-input"

describe("PasswordInput", () => {
  it("toggles password visibility without changing its value", async () => {
    const user = userEvent.setup()
    render(<PasswordInput aria-label="Password" defaultValue="Alin14560" />)

    const input = screen.getByLabelText("Password")
    expect(input).toHaveAttribute("type", "password")

    await user.click(screen.getByRole("button", { name: "Show password" }))
    expect(input).toHaveAttribute("type", "text")
    expect(input).toHaveValue("Alin14560")

    await user.click(screen.getByRole("button", { name: "Hide password" }))
    expect(input).toHaveAttribute("type", "password")
  })
})
