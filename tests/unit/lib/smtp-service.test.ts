import { afterEach, describe, expect, it } from "vitest"
import { buildAdministratorRecoveryEmail, readSmtpConfig } from "@electron/services/smtp-service"

const keys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_APP_PASSWORD", "SMTP_FROM_EMAIL", "SMTP_FROM_NAME"] as const
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of keys) {
    const value = original[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function configure() {
  process.env.SMTP_HOST = "smtp.gmail.com"
  process.env.SMTP_PORT = "465"
  process.env.SMTP_USER = "security@example.com"
  process.env.SMTP_APP_PASSWORD = "abcd efgh ijkl mnop"
  process.env.SMTP_FROM_EMAIL = "security@example.com"
  process.env.SMTP_FROM_NAME = "Armory Store"
}

describe("Gmail SMTP recovery", () => {
  it("accepts a Google App Password and builds a standards-friendly multipart message", () => {
    configure()
    const config = readSmtpConfig()
    expect(config.password).toBe("abcdefghijklmnop")
    const email = buildAdministratorRecoveryEmail(config, "owner@example.com", "204681", 15)
    expect(email).toContain("From: =?UTF-8?B?")
    expect(email).toContain("To: <owner@example.com>")
    expect(email).toContain("Message-ID:")
    expect(email).toContain("Auto-Submitted: auto-generated")
    expect(email).toContain("Content-Type: multipart/alternative")
    expect(email).toContain("Content-Type: text/plain; charset=UTF-8")
    expect(email).toContain("Content-Type: text/html; charset=UTF-8")
    expect(email).not.toContain(config.password)
  })

  it("rejects sender spoofing and non-Gmail SMTP endpoints", () => {
    configure()
    process.env.SMTP_FROM_EMAIL = "spoof@example.com"
    expect(() => readSmtpConfig()).toThrow(/must match SMTP_USER/)
    process.env.SMTP_FROM_EMAIL = "security@example.com"
    process.env.SMTP_HOST = "smtp.example.com"
    expect(() => readSmtpConfig()).toThrow(/Only Gmail SMTP/)
  })

  it("rejects a normal password instead of a 16-character App Password", () => {
    configure()
    process.env.SMTP_APP_PASSWORD = "ordinary-password"
    expect(() => readSmtpConfig()).toThrow(/16-character Google App Password/)
  })
})
