import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { AuthScreen } from "@/components/auth-screen"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

describe("AuthScreen", () => {
  it("disables submission while resolving and advances to password sign-in once", async () => {
    const lookup = deferred<{ passwordSet: boolean; loginEmail: string; displayName: string }>()
    const onResolve = vi.fn(() => lookup.promise)
    const user = userEvent.setup()
    render(
      <AuthScreen
        lang="en"
        error={null}
        onResolve={onResolve}
        onSignIn={vi.fn()}
        onCompleteFirstLogin={vi.fn()}
        onRequestPasswordRecovery={vi.fn()}
        onCompletePasswordRecovery={vi.fn()}
        onReturnToDatabaseSetup={vi.fn()}
      />,
    )

    await user.type(screen.getByLabelText("Name or Email"), "audit@example.com")
    const submit = screen.getByRole("button", { name: "Continue" })
    await user.click(submit)
    expect(submit).toBeDisabled()
    await user.click(submit)
    expect(onResolve).toHaveBeenCalledTimes(1)

    lookup.resolve({ passwordSet: true, loginEmail: "audit@example.com", displayName: "Audit User" })
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeEnabled()
  })

  it("shows a concise recovery error and re-enables retry", async () => {
    const onResolve = vi.fn().mockRejectedValue(new Error("Account not found"))
    const user = userEvent.setup()
    render(
      <AuthScreen
        lang="en"
        error={null}
        onResolve={onResolve}
        onSignIn={vi.fn()}
        onCompleteFirstLogin={vi.fn()}
        onRequestPasswordRecovery={vi.fn()}
        onCompletePasswordRecovery={vi.fn()}
        onReturnToDatabaseSetup={vi.fn()}
      />,
    )

    await user.type(screen.getByLabelText("Name or Email"), "missing-user")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Account not found")
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled())
  })

  it("marks the Arabic login surface with the correct language and direction", () => {
    render(
      <AuthScreen
        lang="ar"
        error={null}
        onResolve={vi.fn()}
        onSignIn={vi.fn()}
        onCompleteFirstLogin={vi.fn()}
        onRequestPasswordRecovery={vi.fn()}
        onCompletePasswordRecovery={vi.fn()}
        onReturnToDatabaseSetup={vi.fn()}
      />,
    )
    const main = screen.getByRole("main")
    expect(main).toHaveAttribute("lang", "ar")
    expect(main).toHaveAttribute("dir", "rtl")
  })

  it("returns to database setup from the login screen", async () => {
    const onReturnToDatabaseSetup = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <AuthScreen
        lang="en"
        error={null}
        onResolve={vi.fn()}
        onSignIn={vi.fn()}
        onCompleteFirstLogin={vi.fn()}
        onRequestPasswordRecovery={vi.fn()}
        onCompletePasswordRecovery={vi.fn()}
        onReturnToDatabaseSetup={onReturnToDatabaseSetup}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Back to database setup" }))
    expect(onReturnToDatabaseSetup).toHaveBeenCalledTimes(1)
  })

  it("requests employee recovery and submits the administrator-approved code", async () => {
    const onRequestPasswordRecovery = vi.fn().mockResolvedValue({ requestId: "11111111-1111-4111-8111-111111111111", channel: "admin_approval" })
    const onCompletePasswordRecovery = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <AuthScreen
        lang="en"
        error={null}
        onResolve={vi.fn()}
        onSignIn={vi.fn()}
        onCompleteFirstLogin={vi.fn()}
        onRequestPasswordRecovery={onRequestPasswordRecovery}
        onCompletePasswordRecovery={onCompletePasswordRecovery}
        onReturnToDatabaseSetup={vi.fn()}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Forgot password?" }))
    await user.type(screen.getByLabelText("Name or Email"), "employee")
    await user.click(screen.getByRole("button", { name: "Send recovery request" }))
    expect(await screen.findByText(/sent to the store administrators/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText("Recovery code"), "123456")
    await user.type(screen.getByLabelText("New password"), "SecurePass1")
    await user.type(screen.getByLabelText("Confirm password"), "SecurePass1")
    await user.click(screen.getByRole("button", { name: "Reset password and sign in" }))
    expect(onCompletePasswordRecovery).toHaveBeenCalledWith(expect.objectContaining({ code: "123456", channel: "admin_approval" }))
  })
})
