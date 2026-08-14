import { describe, expect, it } from "vitest"
import { isAllowedExternalUrl } from "./external-url"

describe("isAllowedExternalUrl", () => {
  it.each([
    "https://example.com/path",
    "http://localhost:3000/help",
    "mailto:support@example.com",
  ])("allows an explicitly supported external URL: %s", (url) => {
    expect(isAllowedExternalUrl(url)).toBe(true)
  })

  it.each([
    "javascript:alert(document.domain)",
    "file:///C:/Windows/System32/calc.exe",
    "data:text/html,<script>alert(1)</script>",
    "shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
    "not a url",
  ])("rejects a dangerous or malformed external URL: %s", (url) => {
    expect(isAllowedExternalUrl(url)).toBe(false)
  })
})
